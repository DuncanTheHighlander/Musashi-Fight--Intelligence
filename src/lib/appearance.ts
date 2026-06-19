/**
 * Appearance-based fighter identity tracking.
 *
 * Why this exists:
 *   Pose-only tracking fails during full occlusion (fighter fully behind other).
 *   Position is identical, velocity reverses, body proportions are too similar.
 *   Appearance (color of gloves, shorts, gear) is orthogonal — survives crossing.
 *
 * What this does:
 *   1. Samples an HSV histogram from each fighter's torso quadrilateral
 *      (shoulder/hip landmarks define the region — avoids glove/background noise)
 *   2. Stores a "fingerprint" per fighter slot (A, B), EMA-updated each frame
 *   3. Each frame, scores candidate poses against stored fingerprints
 *   4. When motion-based assignment is ambiguous OR appearance strongly
 *      disagrees with motion, appearance wins
 *
 * What this does NOT do:
 *   - Solve identical-uniform sparring (same gloves, same shirt). For that
 *     we'd need ReID embeddings or mask propagation. Out of scope for now.
 *   - Track more than 2 fighters. Slot model is hardcoded A/B.
 *
 * Cost:
 *   ~1-2ms per frame. No new dependencies. No models. No network.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { POSE_LANDMARKS } from '@/lib/kinematics'

// ─── Two-region RGB color profile (torso + shorts) ───────────────────────────
// Ported from skeleton-test — discriminates fighters when shirts match but trunks differ.

export type NormalizedRgb = { r: number; g: number; b: number }
export type ColorProfile = { torso: NormalizedRgb; legs: NormalizedRgb | null }

const TORSO_CORNERS = [11, 12, 23, 24] as const
const LEG_CORNERS = [23, 24, 25, 26] as const
const TORSO_COLOR_WEIGHT = 0.6
const LEGS_COLOR_WEIGHT = 0.4

export function cloneColorProfile(c: ColorProfile): ColorProfile {
  return {
    torso: { ...c.torso },
    legs: c.legs ? { ...c.legs } : null,
  }
}

function rgbDist(a: NormalizedRgb, b: NormalizedRgb): number {
  return Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
}

export function colorProfileDist(a: ColorProfile, b: ColorProfile): number {
  const torsoD = rgbDist(a.torso, b.torso)
  if (a.legs && b.legs) {
    return TORSO_COLOR_WEIGHT * torsoD + LEGS_COLOR_WEIGHT * rgbDist(a.legs, b.legs)
  }
  return torsoD
}

export function colorOnlyCostAgainst(
  candidate: { color: ColorProfile | null },
  reference: ColorProfile
): number {
  if (!candidate.color) return Infinity
  return colorProfileDist(candidate.color, reference)
}

export function colorRef(
  slot: { color: ColorProfile | null; anchorColor: ColorProfile | null } | null,
  useAnchor: boolean
): ColorProfile | null {
  if (!slot) return null
  if (useAnchor && slot.anchorColor) return slot.anchorColor
  return slot.color ?? slot.anchorColor
}

export function blendColorProfile(
  previous: ColorProfile | null,
  next: ColorProfile | null,
  alpha: number
): ColorProfile | null {
  if (!next) return previous
  if (!previous) return next
  const torso: NormalizedRgb = {
    r: (1 - alpha) * previous.torso.r + alpha * next.torso.r,
    g: (1 - alpha) * previous.torso.g + alpha * next.torso.g,
    b: (1 - alpha) * previous.torso.b + alpha * next.torso.b,
  }
  let legs: NormalizedRgb | null
  if (previous.legs && next.legs) {
    legs = {
      r: (1 - alpha) * previous.legs.r + alpha * next.legs.r,
      g: (1 - alpha) * previous.legs.g + alpha * next.legs.g,
      b: (1 - alpha) * previous.legs.b + alpha * next.legs.b,
    }
  } else {
    legs = next.legs ?? previous.legs
  }
  return { torso, legs }
}

function sampleRegion(
  video: HTMLVideoElement,
  lms: NormalizedLandmark[],
  cornerIndices: readonly number[],
  sampler: HTMLCanvasElement,
  insetX: number,
  insetY: number,
  visibilityThreshold: number,
  minCorners: number
): NormalizedRgb | null {
  const corners: NormalizedLandmark[] = []
  for (const i of cornerIndices) {
    const lm = lms[i]
    if (lm && (lm.visibility ?? 1) >= visibilityThreshold) corners.push(lm)
  }
  if (corners.length < minCorners) return null

  let minX = 1
  let maxX = 0
  let minY = 1
  let maxY = 0
  for (const c of corners) {
    if (c.x < minX) minX = c.x
    if (c.x > maxX) maxX = c.x
    if (c.y < minY) minY = c.y
    if (c.y > maxY) maxY = c.y
  }
  const w = maxX - minX
  const h = maxY - minY
  if (w <= 0 || h <= 0) return null

  minX += w * insetX
  maxX -= w * insetX
  minY += h * insetY
  maxY -= h * insetY
  if (maxX <= minX || maxY <= minY) return null

  if (sampler.width !== 160) sampler.width = 160
  if (sampler.height !== 90) sampler.height = 90
  const ctx = sampler.getContext('2d', { willReadFrequently: true })
  if (!ctx || !video.videoWidth || !video.videoHeight) return null
  try {
    ctx.drawImage(video, 0, 0, sampler.width, sampler.height)
  } catch {
    return null
  }

  const px = Math.max(0, Math.floor(minX * sampler.width))
  const py = Math.max(0, Math.floor(minY * sampler.height))
  const pw = Math.max(1, Math.min(sampler.width - px, Math.floor((maxX - minX) * sampler.width)))
  const ph = Math.max(1, Math.min(sampler.height - py, Math.floor((maxY - minY) * sampler.height)))

  let data: Uint8ClampedArray
  try {
    data = ctx.getImageData(px, py, pw, ph).data
  } catch {
    return null
  }

  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
    n++
  }
  if (n === 0) return null
  return { r: r / n / 255, g: g / n / 255, b: b / n / 255 }
}

/** Two-region color profile: torso (shoulders→hips) and legs (hips→knees). */
export function sampleColorProfile(
  video: HTMLVideoElement,
  lms: NormalizedLandmark[],
  sampler: HTMLCanvasElement
): ColorProfile | null {
  const torso = sampleRegion(video, lms, TORSO_CORNERS, sampler, 0.2, 0.15, 0.4, 3)
  if (!torso) return null
  const legs = sampleRegion(video, lms, LEG_CORNERS, sampler, 0.15, 0.1, 0.35, 3)
  return { torso, legs }
}

// ─── Tuning constants ────────────────────────────────────────────────────────
// All thresholds are intentionally exposed and named so they can be revisited
// against real clips without spelunking through the algorithm.

/** Histogram bin counts. 12×8×4 = 384-dim vector. Coarser than typical CV
 * tutorials (which use 16×16×16) because we want robustness to lighting,
 * not pixel-level precision. Hue is the strongest discriminator → most bins. */
const HUE_BINS = 12
const SAT_BINS = 8
const VAL_BINS = 4
const HIST_SIZE = HUE_BINS * SAT_BINS * VAL_BINS

/** EMA update rate for stored fingerprint when current match is high-confidence.
 * Low value = slow drift = robust to lighting changes, but slow to adapt if
 * a fighter loses a glove. 0.05 means ~20 frames to fully replace. */
const EMA_ALPHA = 0.05

/** Bhattacharyya distance threshold below which we consider a candidate
 * to be "clearly" the matching fighter. Below this we EMA-update.
 * Empirical — tune against real clips. */
const HIGH_CONFIDENCE_THRESHOLD = 0.35

/** Minimum mean visibility of the four torso landmarks (LSh, RSh, LHip, RHip)
 * required to even attempt sampling. Below this the quadrilateral is
 * unreliable — fall back to bbox sampling or skip this frame. */
const TORSO_VISIBILITY_FLOOR = 0.18

/** Minimum number of pixels we need inside the torso region to trust
 * the histogram. Tiny regions are noise. */
const MIN_PIXELS_FOR_HISTOGRAM = 80

/** Snapshot bank: several full histograms per fighter captured from
 * high-confidence, non-overlapping frames. The EMA fingerprint drifts with
 * lighting; the bank preserves pre-cross appearance so re-acquisition after
 * a long occlusion can match against what the fighter looked like BEFORE
 * the crossing, not a possibly-contaminated running average. */
const BANK_MAX_SNAPSHOTS = 5
/** Minimum spacing between bank snapshots so the bank spans seconds of
 * appearance variation rather than five near-identical consecutive frames. */
const BANK_MIN_GAP_MS = 700

// ─── Types ───────────────────────────────────────────────────────────────────

export type Histogram = Float32Array  // length === HIST_SIZE, sums to 1.0

export type AppearanceSlot = 'A' | 'B'

export interface AppearanceFingerprint {
  histogram: Histogram
  /** Number of frames this fingerprint has been updated. Used to gate
   * confidence — a single-frame fingerprint is less trustworthy. */
  sampleCount: number
  /** Last wall time we successfully matched and updated. */
  lastUpdateMs: number
  /** Snapshot bank: raw histograms from clean (non-crossing) frames. */
  bank: Histogram[]
  /** Wall time of the most recent bank snapshot. */
  lastBankMs: number
}

export interface AppearanceScores {
  /** Bhattacharyya distance: 0 = identical, 1 = totally different.
   * Null if we couldn't sample the candidate (low visibility, off-frame). */
  candidateToA: (number | null)[]
  candidateToB: (number | null)[]
}

export interface AppearanceTracker {
  /** Sample histograms for an array of candidate poses against the current frame.
   * Returns one Histogram per candidate (null if sampling failed). */
  sample(canvas: HTMLCanvasElement, video: HTMLVideoElement, poses: NormalizedLandmark[][]): (Histogram | null)[]

  /** Score each candidate against the stored A and B fingerprints. */
  score(candidateHists: (Histogram | null)[]): AppearanceScores

  /** Capture or update fingerprints after assignment is finalized.
   * Pass the index in `candidateHists` that was assigned to A and B
   * (or null if a slot was unassigned this frame).
   * `opts.allowLearn: false` skips ALL fingerprint/bank updates — pass it
   * while fighters overlap, when histograms sample mixed/occluded pixels
   * that would contaminate the stored identity. Scoring keeps working. */
  commit(
    candidateHists: (Histogram | null)[],
    assignedAIndex: number | null,
    assignedBIndex: number | null,
    wallNowMs: number,
    opts?: { allowLearn?: boolean }
  ): void

  /** Has both fingerprints captured at least once. Until true, appearance
   * cannot override motion. */
  isReady(): boolean

  /** Did appearance strongly disagree with the motion-based assignment
   * on the most recent score()? Returns the suggested assignment if so,
   * or null if appearance agrees / has no opinion. */
  suggestSwap(
    scores: AppearanceScores,
    motionAssignedAIndex: number | null,
    motionAssignedBIndex: number | null
  ): { aIndex: number | null; bIndex: number | null } | null

  /** Reset all state (new video, etc). */
  reset(): void

  /** Diagnostics for logging / UI. */
  debugSnapshot(): {
    hasA: boolean
    hasB: boolean
    samplesA: number
    samplesB: number
    bankA: number
    bankB: number
  }
}

// ─── Sampling ────────────────────────────────────────────────────────────────

/**
 * Compute the torso quadrilateral in pixel coordinates from pose landmarks.
 * Returns null if visibility is too low to trust the region.
 *
 * The quadrilateral is the polygon: LSh → RSh → RHip → LHip.
 * We use it (not the full bbox) because:
 *   - excludes head (varies with skin tone, less stable than gear)
 *   - excludes arms/gloves (occlude during punches)
 *   - excludes legs (often cropped or motion-blurred)
 *   - the torso shows shorts color + shirt color, the most stable visual ID
 */
function getTorsoQuadPixels(
  pose: NormalizedLandmark[],
  videoWidth: number,
  videoHeight: number
): { x: number; y: number }[] | null {
  const lSh = pose[POSE_LANDMARKS.LEFT_SHOULDER]
  const rSh = pose[POSE_LANDMARKS.RIGHT_SHOULDER]
  const lHip = pose[POSE_LANDMARKS.LEFT_HIP]
  const rHip = pose[POSE_LANDMARKS.RIGHT_HIP]
  if (!lSh || !rSh || !lHip || !rHip) return null

  const meanVis =
    ((lSh.visibility ?? 0) + (rSh.visibility ?? 0) + (lHip.visibility ?? 0) + (rHip.visibility ?? 0)) / 4
  if (meanVis < TORSO_VISIBILITY_FLOOR) return null

  // Order matters for point-in-polygon: clockwise around the torso
  return [
    { x: lSh.x * videoWidth, y: lSh.y * videoHeight },
    { x: rSh.x * videoWidth, y: rSh.y * videoHeight },
    { x: rHip.x * videoWidth, y: rHip.y * videoHeight },
    { x: lHip.x * videoWidth, y: lHip.y * videoHeight },
  ]
}

/** Bounding box of a quadrilateral, clamped to canvas. */
function quadBBox(
  quad: { x: number; y: number }[],
  videoWidth: number,
  videoHeight: number
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const p of quad) {
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x > maxX) maxX = p.x
    if (p.y > maxY) maxY = p.y
  }
  minX = Math.max(0, Math.floor(minX))
  minY = Math.max(0, Math.floor(minY))
  maxX = Math.min(videoWidth - 1, Math.ceil(maxX))
  maxY = Math.min(videoHeight - 1, Math.ceil(maxY))
  if (maxX <= minX || maxY <= minY) return null
  return { minX, minY, maxX, maxY }
}

/** Standard point-in-convex-polygon test. The torso quad is convex
 * (assuming a roughly upright fighter); inverted poses are rare and
 * a slightly wrong region is acceptable since we only need a histogram. */
function pointInQuad(x: number, y: number, quad: { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const xi = quad[i].x
    const yi = quad[i].y
    const xj = quad[j].x
    const yj = quad[j].y
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi
    if (intersect) inside = !inside
  }
  return inside
}

/** RGB to HSV conversion. r, g, b in [0, 255]. Returns h ∈ [0,360), s ∈ [0,1], v ∈ [0,1]. */
function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rN = r / 255
  const gN = g / 255
  const bN = b / 255
  const max = Math.max(rN, gN, bN)
  const min = Math.min(rN, gN, bN)
  const d = max - min
  let h = 0
  if (d > 1e-6) {
    if (max === rN) h = 60 * (((gN - bN) / d) % 6)
    else if (max === gN) h = 60 * ((bN - rN) / d + 2)
    else h = 60 * ((rN - gN) / d + 4)
  }
  if (h < 0) h += 360
  const s = max === 0 ? 0 : d / max
  const v = max
  return { h, s, v }
}

/**
 * Sample HSV histogram from the torso quadrilateral region of a frame.
 * Returns a normalized histogram (sums to 1) or null if sampling failed.
 *
 * Implementation notes:
 *   - We draw the video frame into the supplied canvas at native resolution.
 *     Caller is responsible for keeping the canvas alive (avoid per-frame
 *     allocation). One scratch canvas shared across all calls is fine.
 *   - We only iterate over pixels inside the bounding box of the quad,
 *     then filter by point-in-polygon. This is faster than masking the
 *     full frame for typical torso sizes (~50×100 px).
 */
export function sampleHistogram(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  pose: NormalizedLandmark[]
): Histogram | null {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return null

  const quad = getTorsoQuadPixels(pose, w, h)
  if (!quad) return null

  const bbox = quadBBox(quad, w, h)
  if (!bbox) return null

  const regionW = bbox.maxX - bbox.minX + 1
  const regionH = bbox.maxY - bbox.minY + 1
  if (regionW * regionH < MIN_PIXELS_FOR_HISTOGRAM) return null

  // Resize canvas only when necessary — avoid clearing on every call.
  if (canvas.width !== regionW || canvas.height !== regionH) {
    canvas.width = regionW
    canvas.height = regionH
  }
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  // Crop the video frame directly into the scratch canvas
  try {
    ctx.drawImage(video, bbox.minX, bbox.minY, regionW, regionH, 0, 0, regionW, regionH)
  } catch {
    // Tainted canvas (cross-origin video) — caller must handle this case
    return null
  }

  let imageData: ImageData
  try {
    imageData = ctx.getImageData(0, 0, regionW, regionH)
  } catch {
    return null
  }

  // Translate quad coordinates into the cropped canvas space
  const localQuad = quad.map((p) => ({ x: p.x - bbox.minX, y: p.y - bbox.minY }))

  const hist = new Float32Array(HIST_SIZE)
  let sampleCount = 0
  const data = imageData.data

  for (let y = 0; y < regionH; y++) {
    for (let x = 0; x < regionW; x++) {
      if (!pointInQuad(x + 0.5, y + 0.5, localQuad)) continue

      const idx = (y * regionW + x) * 4
      const { h: hue, s: sat, v: val } = rgbToHsv(data[idx], data[idx + 1], data[idx + 2])

      const hBin = Math.min(HUE_BINS - 1, Math.floor((hue / 360) * HUE_BINS))
      const sBin = Math.min(SAT_BINS - 1, Math.floor(sat * SAT_BINS))
      const vBin = Math.min(VAL_BINS - 1, Math.floor(val * VAL_BINS))

      hist[hBin * SAT_BINS * VAL_BINS + sBin * VAL_BINS + vBin] += 1
      sampleCount++
    }
  }

  if (sampleCount < MIN_PIXELS_FOR_HISTOGRAM) return null

  // Normalize to a probability distribution
  for (let i = 0; i < HIST_SIZE; i++) hist[i] /= sampleCount
  return hist
}

// ─── Distance ────────────────────────────────────────────────────────────────

/**
 * Bhattacharyya distance between two normalized histograms.
 * Returns a value in [0, 1]: 0 = identical, 1 = no overlap.
 *
 * We use Bhattacharyya rather than chi-squared or L2 because:
 *   - it's the standard for histogram comparison (OpenCV default)
 *   - it's bounded, which makes thresholding intuitive
 *   - it handles sparse histograms (typical for small torso regions) gracefully
 */
export function bhattacharyyaDistance(a: Histogram, b: Histogram): number {
  if (a.length !== b.length) return 1
  let bc = 0
  for (let i = 0; i < a.length; i++) bc += Math.sqrt(a[i] * b[i])
  // bc ∈ [0, 1]; distance = sqrt(1 - bc) ∈ [0, 1]
  return Math.sqrt(Math.max(0, 1 - bc))
}

// ─── Tracker ─────────────────────────────────────────────────────────────────

/** EMA-blend two histograms in place. result stored in `target`. */
function emaUpdate(target: Histogram, observed: Histogram, alpha: number): void {
  const a = Math.min(1, Math.max(0, alpha))
  for (let i = 0; i < target.length; i++) {
    target[i] = (1 - a) * target[i] + a * observed[i]
  }
}

export function createAppearanceTracker(): AppearanceTracker {
  let fingerprintA: AppearanceFingerprint | null = null
  let fingerprintB: AppearanceFingerprint | null = null

  // One scratch canvas shared across all sample() calls. Avoids per-frame
  // DOM allocation. Created lazily because we may be on the server.
  let scratchCanvas: HTMLCanvasElement | null = null
  const getScratch = (): HTMLCanvasElement => {
    if (scratchCanvas) return scratchCanvas
    if (typeof document === 'undefined') {
      // Should never happen — appearance only runs in the browser
      throw new Error('Appearance tracker requires browser environment')
    }
    scratchCanvas = document.createElement('canvas')
    return scratchCanvas
  }

  return {
    sample(_canvas, video, poses) {
      const scratch = getScratch()
      return poses.map((p) => sampleHistogram(scratch, video, p))
    },

    score(candidateHists) {
      // Distance = best match against the EMA fingerprint OR any bank snapshot.
      // The bank preserves pre-cross appearance, so a fighter reappearing after
      // a long occlusion still matches even if the EMA drifted or lighting
      // changed mid-clip.
      const scoreAgainst = (fp: AppearanceFingerprint | null) =>
        candidateHists.map((h) => {
          if (!h || !fp) return null
          let best = bhattacharyyaDistance(h, fp.histogram)
          for (const snapshot of fp.bank) {
            const d = bhattacharyyaDistance(h, snapshot)
            if (d < best) best = d
          }
          return best
        })
      return {
        candidateToA: scoreAgainst(fingerprintA),
        candidateToB: scoreAgainst(fingerprintB),
      }
    },

    commit(candidateHists, assignedAIndex, assignedBIndex, wallNowMs, opts) {
      // While fighters overlap, candidate histograms sample mixed pixels —
      // learning from them poisons the identity. Scoring stays available.
      if (opts?.allowLearn === false) return

      const newFingerprint = (h: Histogram): AppearanceFingerprint => ({
        histogram: h.slice() as Histogram,
        sampleCount: 1,
        lastUpdateMs: wallNowMs,
        bank: [h.slice() as Histogram],
        lastBankMs: wallNowMs,
      })

      const maybeBankSnapshot = (fp: AppearanceFingerprint, observed: Histogram) => {
        if (wallNowMs - fp.lastBankMs < BANK_MIN_GAP_MS) return
        fp.bank.push(observed.slice() as Histogram)
        if (fp.bank.length > BANK_MAX_SNAPSHOTS) fp.bank.shift()
        fp.lastBankMs = wallNowMs
      }

      const updateSlot = (
        current: AppearanceFingerprint | null,
        observed: Histogram | null
      ): AppearanceFingerprint | null => {
        if (!observed) return current
        if (!current) {
          // First capture for this slot
          return newFingerprint(observed)
        }
        // Only EMA-update when the current observation is reasonably close to
        // the stored fingerprint. Otherwise we'd drift toward the wrong fighter
        // if motion-based assignment was wrong this frame.
        const dist = bhattacharyyaDistance(current.histogram, observed)
        if (dist > HIGH_CONFIDENCE_THRESHOLD) return current
        emaUpdate(current.histogram, observed, EMA_ALPHA)
        maybeBankSnapshot(current, observed)
        return { ...current, sampleCount: current.sampleCount + 1, lastUpdateMs: wallNowMs }
      }

      // First-ever capture: if neither slot is set yet, accept whatever we got
      // even if confidence is low. Without bootstrap we never start.
      if (!fingerprintA && !fingerprintB) {
        if (assignedAIndex !== null) {
          const h = candidateHists[assignedAIndex]
          if (h) fingerprintA = newFingerprint(h)
        }
        if (assignedBIndex !== null) {
          const h = candidateHists[assignedBIndex]
          if (h) fingerprintB = newFingerprint(h)
        }
        return
      }

      fingerprintA = updateSlot(fingerprintA, assignedAIndex !== null ? candidateHists[assignedAIndex] : null)
      fingerprintB = updateSlot(fingerprintB, assignedBIndex !== null ? candidateHists[assignedBIndex] : null)
    },

    isReady() {
      return !!fingerprintA && !!fingerprintB
    },

    suggestSwap(scores, motionA, motionB) {
      if (!fingerprintA || !fingerprintB) return null
      if (motionA === null || motionB === null) return null
      if (motionA === motionB) return null

      const distMotionA = scores.candidateToA[motionA]
      const distMotionB = scores.candidateToB[motionB]
      const distSwapA = scores.candidateToA[motionB]
      const distSwapB = scores.candidateToB[motionA]

      const APPEARANCE_OVERRIDE_MARGIN = 0.10
      const APPEARANCE_PARTIAL_MATCH_THRESHOLD = 0.30
      const APPEARANCE_PARTIAL_MARGIN = 0.24

      const preferredSlot = (candidateIndex: number): AppearanceSlot | null => {
        const distA = scores.candidateToA[candidateIndex]
        const distB = scores.candidateToB[candidateIndex]
        if (distA === null || distB === null) return null
        if (distA < APPEARANCE_PARTIAL_MATCH_THRESHOLD && distB - distA > APPEARANCE_PARTIAL_MARGIN) return 'A'
        if (distB < APPEARANCE_PARTIAL_MATCH_THRESHOLD && distA - distB > APPEARANCE_PARTIAL_MARGIN) return 'B'
        return null
      }

      const motionAPrefers = preferredSlot(motionA)
      const motionBPrefers = preferredSlot(motionB)
      if (
        (motionAPrefers === 'B' && (motionBPrefers === 'A' || motionBPrefers === null)) ||
        (motionBPrefers === 'A' && (motionAPrefers === 'B' || motionAPrefers === null))
      ) {
        return { aIndex: motionB, bIndex: motionA }
      }

      // Need all four scores to make a full two-body confidence call.
      if (
        distMotionA === null ||
        distMotionB === null ||
        distSwapA === null ||
        distSwapB === null
      ) {
        return null
      }

      const motionTotal = distMotionA + distMotionB
      const swapTotal = distSwapA + distSwapB

      // Only override motion when appearance STRONGLY disagrees.
      // 0.15 absolute margin = "appearance is meaningfully better even
      // accounting for noise and lighting." Empirical — tune against clips.
      if (motionTotal - swapTotal > APPEARANCE_OVERRIDE_MARGIN) {
        return { aIndex: motionB, bIndex: motionA }
      }
      return null
    },

    reset() {
      fingerprintA = null
      fingerprintB = null
    },

    debugSnapshot() {
      return {
        hasA: !!fingerprintA,
        hasB: !!fingerprintB,
        samplesA: fingerprintA?.sampleCount ?? 0,
        samplesB: fingerprintB?.sampleCount ?? 0,
        bankA: fingerprintA?.bank.length ?? 0,
        bankB: fingerprintB?.bank.length ?? 0,
      }
    },
  }
}
