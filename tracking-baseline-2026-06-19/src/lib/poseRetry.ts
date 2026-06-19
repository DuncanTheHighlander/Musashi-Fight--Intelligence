/**
 * Shared crop-and-retry pose detection utilities.
 *
 * Used by both the home page coach tab and the fight page to reliably
 * detect a second fighter when MediaPipe's primary numPoses:2 pass
 * only finds one person (common in combat footage with occlusion).
 */

import { PoseLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import { POSE_LANDMARKS } from '@/lib/kinematics'

const FULL_MODEL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'

/**
 * Create an IMAGE-mode PoseLandmarker with low thresholds, used for
 * crop-and-retry detection of the second fighter.
 */
/**
 * Create an IMAGE-mode PoseLandmarker for crop-and-retry detection.
 *
 * Always uses CPU delegate to avoid WebGL context exhaustion.
 * The WASM binary is shared with the main landmarker (no double download).
 * IMAGE mode is single-shot and only runs on small crop regions when the
 * main landmarker misses the second fighter — very lightweight.
 */
export async function createRetryLandmarker(
  vision: any,
  _mainDelegate?: 'GPU' | 'CPU'
): Promise<PoseLandmarker | null> {
  const retryOpts = {
    runningMode: 'IMAGE' as const,
    numPoses: 1,
    // Lowered from 0.25/0.2 → 0.12/0.08 to catch heavily occluded fighters.
    // During crossing, the behind-fighter is barely visible, so MediaPipe's
    // confidence drops significantly. 0.12/0.08 still filters noise while catching
    // legitimate (but obscured) fighters. This is only used for crop-and-retry
    // on small regions when the main pass fails, so false positives are minimal.
    minPoseDetectionConfidence: 0.12,
    minPosePresenceConfidence: 0.08,
  }

  try {
    const lm = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: FULL_MODEL, delegate: 'CPU' },
      ...retryOpts,
    })
    console.log('[Pose] Retry landmarker ready (CPU, IMAGE mode)')
    return lm
  } catch (err) {
    console.warn('[Pose] Retry landmarker FAILED — crop-retry disabled:', err)
    return null
  }
}

function getPoseCenter(pose: NormalizedLandmark[]) {
  const lh = pose[POSE_LANDMARKS.LEFT_HIP]
  const rh = pose[POSE_LANDMARKS.RIGHT_HIP]
  const ls = pose[POSE_LANDMARKS.LEFT_SHOULDER]
  const rs = pose[POSE_LANDMARKS.RIGHT_SHOULDER]
  const x =
    ((lh?.x ?? 0.5) + (rh?.x ?? 0.5) + (ls?.x ?? 0.5) + (rs?.x ?? 0.5)) / 4
  const y =
    ((lh?.y ?? 0.5) + (rh?.y ?? 0.5) + (ls?.y ?? 0.5) + (rs?.y ?? 0.5)) / 4
  return { x, y }
}

function centerDistance(a: NormalizedLandmark[], b: NormalizedLandmark[]) {
  const ca = getPoseCenter(a)
  const cb = getPoseCenter(b)
  return Math.hypot(ca.x - cb.x, ca.y - cb.y)
}

function getPoseBounds(pose: NormalizedLandmark[]): BoundingBox | null {
  const visible = pose.filter((lm) => (lm.visibility ?? 1) >= 0.15)
  if (visible.length === 0) return null

  let left = 1
  let top = 1
  let right = 0
  let bottom = 0
  for (const lm of visible) {
    left = Math.min(left, lm.x)
    top = Math.min(top, lm.y)
    right = Math.max(right, lm.x)
    bottom = Math.max(bottom, lm.y)
  }

  return { left, top, right, bottom }
}

function bboxIou(a: BoundingBox | null, b: BoundingBox | null): number {
  if (!a || !b) return 0

  const left = Math.max(a.left, b.left)
  const top = Math.max(a.top, b.top)
  const right = Math.min(a.right, b.right)
  const bottom = Math.min(a.bottom, b.bottom)
  const width = Math.max(0, right - left)
  const height = Math.max(0, bottom - top)
  const intersection = width * height
  if (intersection <= 0) return 0

  const areaA = Math.max(0, a.right - a.left) * Math.max(0, a.bottom - a.top)
  const areaB = Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top)
  const union = areaA + areaB - intersection
  return union > 0 ? intersection / union : 0
}

function distinctPoseScore(candidate: NormalizedLandmark[], firstPose: NormalizedLandmark[]): number {
  const centerDist = centerDistance(candidate, firstPose)
  const overlap = bboxIou(getPoseBounds(candidate), getPoseBounds(firstPose))
  return centerDist + (1 - overlap) * 0.08
}

/**
 * Compute a lightweight body-proportion ratio (shoulder-width / torso-height)
 * to help distinguish two different people. This is roughly constant for a
 * given person regardless of their position on screen.
 */
function bodyPropRatio(pose: NormalizedLandmark[]): number {
  const ls = pose[POSE_LANDMARKS.LEFT_SHOULDER]
  const rs = pose[POSE_LANDMARKS.RIGHT_SHOULDER]
  const lh = pose[POSE_LANDMARKS.LEFT_HIP]
  const rh = pose[POSE_LANDMARKS.RIGHT_HIP]
  if (!ls || !rs || !lh || !rh) return 0
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y)
  const th = (Math.hypot(ls.x - lh.x, ls.y - lh.y) + Math.hypot(rs.x - rh.x, rs.y - rh.y)) / 2
  return th > 0.01 ? sw / th : 0
}

function isLikelyDuplicatePose(candidate: NormalizedLandmark[], firstPose: NormalizedLandmark[]): boolean {
  const centerDist = centerDistance(candidate, firstPose)
  const overlap = bboxIou(getPoseBounds(candidate), getPoseBounds(firstPose))

  // Body proportion check: if the two poses have very similar proportions AND
  // are very close, it's more likely a duplicate. If proportions differ
  // significantly, they're probably different people even if close.
  const propA = bodyPropRatio(candidate)
  const propB = bodyPropRatio(firstPose)
  const propSimilar = propA > 0 && propB > 0 ? Math.abs(propA - propB) < 0.15 : true

  // Tighter duplicate check: must be very close AND overlapping AND similar proportions
  if (propSimilar) {
    return centerDist < MIN_DISTINCT_DISTANCE * 0.7 && overlap > 0.55
  }
  // Different proportions = different people, only reject if nearly identical position
  return centerDist < MIN_DISTINCT_DISTANCE * 0.3 && overlap > 0.8
}

// Raised from 0.04 → 0.05: the 4% threshold was too lenient and allowed
// phantom/ghost detections from shadows or reflections. 5% still catches
// fighters in clinch but provides better noise rejection. The body-proportion
// check in isLikelyDuplicatePose now handles the close-range disambiguation
// that the old low threshold was trying to solve.
const MIN_DISTINCT_DISTANCE = 0.05

// Floor on distinctPoseScore for accepting a crop-retry "second fighter".
// Observed in baseline clips: same-body re-detections score 0.04-0.06,
// genuine second fighters 0.27-0.40. Misses below the floor are covered by
// the identity hold window, exactly like the offline baseline pipeline.
const RETRY_MIN_DISTINCT_SCORE = 0.12

/**
 * When the main PoseLandmarker only finds 1 person, crop the "other half"
 * of the frame and run the retry landmarker on it.
 * Returns mapped NormalizedLandmarks in full-frame coordinates, or null.
 *
 * @param retry        IMAGE-mode PoseLandmarker created by createRetryLandmarker
 * @param source       HTMLVideoElement or HTMLCanvasElement to crop from
 * @param firstPose    Landmarks of the already-detected fighter (or null)
 * @param cropCanvas   Reusable offscreen canvas (will be mutated)
 */
export function detectSecondFighter(
  retry: PoseLandmarker,
  source: HTMLVideoElement | HTMLCanvasElement,
  firstPose: NormalizedLandmark[] | null,
  cropCanvas: HTMLCanvasElement
): NormalizedLandmark[] | null {
  const vw =
    source instanceof HTMLVideoElement
      ? source.videoWidth
      : source.width
  const vh =
    source instanceof HTMLVideoElement
      ? source.videoHeight
      : source.height
  if (!vw || !vh) return null

  const cropCandidates: Array<{ left: number; right: number }> = []
  if (firstPose) {
    const firstCenterX = getPoseCenter(firstPose).x
    if (firstCenterX < 0.5) {
      cropCandidates.push(
        { left: 0.25, right: 1.0 },
        { left: 0.4, right: 1.0 },
        { left: 0.0, right: 1.0 },
        { left: 0.5, right: 1.0 }
      )
    } else {
      cropCandidates.push(
        { left: 0.0, right: 0.75 },
        { left: 0.0, right: 0.6 },
        { left: 0.0, right: 1.0 },
        { left: 0.0, right: 0.5 }
      )
    }
  } else {
    cropCandidates.push(
      { left: 0.0, right: 1.0 },
      { left: 0.0, right: 0.7 },
      { left: 0.3, right: 1.0 }
    )
  }

  const ctx = cropCanvas.getContext('2d')
  if (!ctx) return null

  for (const crop of cropCandidates) {
    const cropLeftNorm = Math.max(0, Math.min(1, crop.left))
    const cropRightNorm = Math.max(cropLeftNorm + 0.01, Math.min(1, crop.right))
    const cropLeftPx = Math.round(cropLeftNorm * vw)
    const cropWidthPx = Math.max(1, Math.round((cropRightNorm - cropLeftNorm) * vw))

    cropCanvas.width = cropWidthPx
    cropCanvas.height = vh
    ctx.clearRect(0, 0, cropWidthPx, vh)
    ctx.drawImage(source, cropLeftPx, 0, cropWidthPx, vh, 0, 0, cropWidthPx, vh)

    try {
      const result = retry.detect(cropCanvas)
      const poses = result.landmarks || []
      if (poses.length === 0) continue

      // Remap crop-local coordinates back to full-frame.
      // Clamp BOTH x and y to [0, 1] so invalid landmarks from edge-of-crop
      // detections can't render off-canvas (which caused skeleton fragments).
      const mapped = poses.map(
        (pose) =>
          pose.map((lm) => ({
            ...lm,
            x: Math.max(0, Math.min(1, cropLeftNorm + lm.x * (cropRightNorm - cropLeftNorm))),
            y: Math.max(0, Math.min(1, lm.y)),
          })) as NormalizedLandmark[]
      )

      if (!firstPose) {
        return mapped[0] || null
      }

      let bestPose: NormalizedLandmark[] | null = null
      let bestScore = -1
      for (const candidate of mapped) {
        const score = distinctPoseScore(candidate, firstPose)
        if (score > bestScore) {
          bestScore = score
          bestPose = candidate
        }
      }
      // Distinctness floor: a half-frame crop re-detecting the SAME body
      // scores ~0.04-0.06 here (slightly shifted box of one person), while a
      // genuine second fighter scores 0.27-0.40. The IoU-based duplicate
      // check misses the same-body case when the crop sees only part of the
      // body (small box inside big box → low IoU), so without this floor the
      // duplicate claims the other identity slot and BOTH skeletons stack on
      // one fighter.
      if (bestPose && bestScore >= RETRY_MIN_DISTINCT_SCORE && !isLikelyDuplicatePose(bestPose, firstPose)) {
        console.log(`[Pose Retry] Found second fighter, score=${bestScore.toFixed(3)}`)
        return bestPose
      }
    } catch (cropErr) {
      console.warn('[Pose Retry] Crop detect error:', cropErr)
    }
  }

  return null
}

export interface BoundingBox {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * Detect a single pose within a specific bounding box region.
 * Used to refine fighter landmarks after the cost-min tracker locates each
 * fighter's box from MediaPipe pose output.
 *
 * @param retry       IMAGE-mode PoseLandmarker
 * @param source      Video or canvas to crop from
 * @param bbox        Normalized bounding box (0-1 coordinates)
 * @param cropCanvas  Reusable offscreen canvas
 */
export function detectInRegion(
  retry: PoseLandmarker,
  source: HTMLVideoElement | HTMLCanvasElement,
  bbox: BoundingBox,
  cropCanvas: HTMLCanvasElement
): NormalizedLandmark[] | null {
  const vw =
    source instanceof HTMLVideoElement ? source.videoWidth : source.width
  const vh =
    source instanceof HTMLVideoElement ? source.videoHeight : source.height
  if (!vw || !vh) return null

  const pad = 0.05
  const left = Math.max(0, bbox.left - pad)
  const top = Math.max(0, bbox.top - pad)
  const right = Math.min(1, bbox.right + pad)
  const bottom = Math.min(1, bbox.bottom + pad)

  const sx = Math.round(left * vw)
  const sy = Math.round(top * vh)
  const sw = Math.max(1, Math.round((right - left) * vw))
  const sh = Math.max(1, Math.round((bottom - top) * vh))

  // Crop sizing: native by default, upscale ONLY when the crop is small.
  // A distant / partially-occluded fighter occupies few pixels; MediaPipe's
  // internal person-detector stage localizes such a body more tightly when fed
  // more pixels, so the short side is scaled up to a model-friendly target.
  // A blanket upscale (an earlier 320px experiment) blew up LARGE crops too —
  // that added blur, a ~6-frame A-dropout in clip1's crossing, and a slower
  // pass for no gain. Capping to small crops keeps the tightness win on distant
  // fighters while large crops stay native: no dropout, no slowdown.
  const TARGET_SHORT = 288
  const MAX_UPSCALE = 2.0
  const shortSide = Math.min(sw, sh)
  const scale = shortSide < TARGET_SHORT ? Math.min(TARGET_SHORT / shortSide, MAX_UPSCALE) : 1
  const cw = Math.max(1, Math.round(sw * scale))
  const ch = Math.max(1, Math.round(sh * scale))

  cropCanvas.width = cw
  cropCanvas.height = ch
  const ctx = cropCanvas.getContext('2d')
  if (!ctx) return null

  ctx.clearRect(0, 0, cw, ch)
  if (scale !== 1) ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, cw, ch)

  try {
    const result = retry.detect(cropCanvas)
    const poses = result.landmarks || []
    if (poses.length === 0) return null

    return poses[0].map((lm) => ({
      ...lm,
      x: left + lm.x * (right - left),
      y: top + lm.y * (bottom - top),
    })) as NormalizedLandmark[]
  } catch (err) {
    console.warn('[Pose Region] Detection error:', err)
    return null
  }
}
