/**
 * Identity-replay core - turn per-frame pose CANDIDATES into a stable A/B track.
 *
 * This is the EXACT identity pipeline FightAnalyzer.processPoseFrame runs during
 * the dense boot pass (dedupe -> bipartite assignment -> crossing lock -> phase
 * machine -> hold/keep -> velocity nudge -> adaptive smoothing), lifted out of the
 * offline replay test so it can be reused by:
 *   - src/lib/identityReplay.offline.test.ts  (the 3-clip eval safety net)
 *   - src/lib/cloudPose.ts                    (cloud GPU dense pass)
 *
 * Input candidates use the same JSON shape the offline detector and the cloud
 * worker (cloud/pose_pipeline.py) emit. Output is DenseTrackSample[] - the same
 * {tMs, A, B} the in-browser dense pass caches and playback replays.
 *
 * Excluded (browser-only): HSV-histogram appearance reconciliation and pre-scan
 * hints. The two-region ColorProfile path IS replayed. Keep the constants below
 * in sync with FightAnalyzer.tsx.
 */
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import {
  advanceCrossingPhase,
  assignFighterTracks,
  clampVelocity,
  crossingHoldMs,
  crossingSmoothAlpha,
  dedupePoseCandidates,
  isCrossingPhase,
  updateIdentitySlotColor,
  type CrossingPhase,
  type IdentitySlot,
  type PoseAnchor,
} from '@/lib/identityTracking'
import { blendColorProfile, colorProfileDist, type ColorProfile } from '@/lib/appearance'
import { smoothLandmarks } from '@/lib/kinematics'

export type DenseTrackSample = {
  tMs: number
  A: NormalizedLandmark[] | null
  B: NormalizedLandmark[] | null
}

/** Candidate frame as emitted by the offline detector and cloud/pose_pipeline.py. */
export type ReplayInFrame = {
  f: number
  tMs: number
  candidates: Array<{
    pose: NormalizedLandmark[]
    anchor?: PoseAnchor
    scale?: number
    color?: {
      torso: { r: number; g: number; b: number }
      upper?: unknown
      lower?: { r: number; g: number; b: number } | null
    } | null
  }>
}

// Constants copied from FightAnalyzer.tsx (keep in sync).
const IDENTITY_SCALE_WEIGHT = 0.16
const IDENTITY_POSE_WEIGHT = 0.18
const IDENTITY_VELOCITY_ALPHA = 0.28
const IDENTITY_COLOR_SMOOTHING = 0.15
const IDENTITY_OCCLUSION_HOLD_MS = 1800
const IDENTITY_PROFILE_COLOR_WEIGHT = 0.82
const IDENTITY_PROFILE_SCALE_WEIGHT = 0.1
const IDENTITY_PROFILE_CLEAR_MARGIN = 0.065

const TRACKING_POINTS: Array<[number, number]> = [
  [11, 1.2], [12, 1.2], [23, 1.2], [24, 1.2],
  [0, 0.45], [13, 0.55], [14, 0.55], [15, 0.4], [16, 0.4],
  [25, 0.75], [26, 0.75], [27, 0.65], [28, 0.65],
]

type FighterKey = 'A' | 'B'
type CornerCandidate = {
  pose: NormalizedLandmark[]
  anchor: PoseAnchor
  color: ColorProfile | null
  scale: number
}
type SlotWithConf = IdentitySlot & { confidence: number }

function getPoseAnchor(landmarks: NormalizedLandmark[]): PoseAnchor | null {
  const pts = [landmarks[11], landmarks[12], landmarks[23], landmarks[24]].filter(
    Boolean
  ) as NormalizedLandmark[]
  if (pts.length < 2) return null
  let x = 0, y = 0, w = 0
  for (const lm of pts) {
    const weight = Math.max(0.25, lm.visibility ?? 1)
    x += lm.x * weight
    y += lm.y * weight
    w += weight
  }
  return w > 0 ? { x: x / w, y: y / w } : null
}

function getPoseScale(landmarks: NormalizedLandmark[]): number {
  const [ls, rs, lh, rh] = [landmarks[11], landmarks[12], landmarks[23], landmarks[24]]
  if (!ls || !rs || !lh || !rh) return 0.18
  const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y)
  const hipW = Math.hypot(lh.x - rh.x, lh.y - rh.y)
  const torsoH =
    (Math.hypot(ls.x - lh.x, ls.y - lh.y) + Math.hypot(rs.x - rh.x, rs.y - rh.y)) / 2
  return Math.max(0.08, shoulderW, hipW, torsoH)
}

function poseShapeDistance(a: NormalizedLandmark[], b: NormalizedLandmark[]): number {
  if (a.length !== b.length) return 0.5
  let total = 0, weight = 0
  for (const [idx, baseWeight] of TRACKING_POINTS) {
    const la = a[idx], lb = b[idx]
    if (!la || !lb) continue
    const vis = Math.min(la.visibility ?? 1, lb.visibility ?? 1)
    if (vis < 0.08) continue
    const w = baseWeight * Math.max(0.35, vis)
    total += Math.hypot(la.x - lb.x, la.y - lb.y) * w
    weight += w
  }
  return weight > 0 ? total / weight : 0.5
}

function mixProfileColor(
  previous: ColorProfile | null,
  next: ColorProfile | null,
  samples: number
): ColorProfile | null {
  if (!next) return previous
  if (!previous || samples <= 0) return next
  const a = Math.max(0.035, Math.min(0.16, 1 / (samples + 2)))
  return blendColorProfile(previous, next, a)
}

function getTorsoVelocity(curr: NormalizedLandmark[], prev: NormalizedLandmark[]) {
  const a = getPoseAnchor(curr)
  const b = getPoseAnchor(prev)
  if (!a || !b) return { vx: 0, vy: 0 }
  return { vx: a.x - b.x, vy: a.y - b.y }
}

/**
 * Stateful replayer. One instance per clip; feed frames in order. Mirrors the
 * mutable refs FightAnalyzer keeps across frames.
 */
class IdentityReplayer {
  private slots: { A: SlotWithConf | null; B: SlotWithConf | null } = { A: null, B: null }
  private profiles: Record<FighterKey, { color: ColorProfile | null; scale: number | null; samples: number }> = {
    A: { color: null, scale: null, samples: 0 },
    B: { color: null, scale: null, samples: 0 },
  }
  private crossingPhase: CrossingPhase = 'tracking'
  private recoveryStable = 0
  private lockKey: FighterKey | null = null
  private occlusionUntil = 0
  private lastSeen: Record<FighterKey, number | null> = { A: null, B: null }
  private lastRaw: Record<FighterKey, NormalizedLandmark[] | null> = { A: null, B: null }
  private prevRaw: Record<FighterKey, NormalizedLandmark[] | null> = { A: null, B: null }
  private smoothed: Record<FighterKey, NormalizedLandmark[] | null> = { A: null, B: null }
  private velocity: Record<FighterKey, { vx: number; vy: number }> = {
    A: { vx: 0, vy: 0 },
    B: { vx: 0, vy: 0 },
  }

  private assignCornerIdentities(
    candidates: CornerCandidate[],
    posesLength: number,
    wallNow: number
  ): { A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null } {
    const phaseIn = this.crossingPhase

    if (candidates.length === 0) {
      if (wallNow < this.occlusionUntil || isCrossingPhase(phaseIn)) {
        return { A: this.slots.A?.pose ?? null, B: this.slots.B?.pose ?? null }
      }
      return { A: null, B: null }
    }

    const profileCost = (candidate: CornerCandidate, key: FighterKey): number => {
      const profile = this.profiles[key]
      if (!profile.color || !candidate.color || profile.samples < 2) return Infinity
      const color = colorProfileDist(candidate.color, profile.color)
      const scale =
        profile.scale && profile.scale > 0
          ? Math.abs(Math.log(Math.max(0.05, candidate.scale) / Math.max(0.05, profile.scale)))
          : 0.18
      return color * IDENTITY_PROFILE_COLOR_WEIGHT + Math.min(0.45, scale) * IDENTITY_PROFILE_SCALE_WEIGHT
    }

    const updateProfile = (key: FighterKey, candidate: CornerCandidate | undefined, clearFrame: boolean) => {
      if (!candidate?.color || !clearFrame) return
      const profile = this.profiles[key]
      this.profiles[key] = {
        color: mixProfileColor(profile.color, candidate.color, profile.samples),
        scale: profile.scale == null ? candidate.scale : profile.scale * 0.94 + candidate.scale * 0.06,
        samples: Math.min(80, profile.samples + 1),
      }
    }

    const updateSlot = (
      key: FighterKey,
      candidate: CornerCandidate | undefined,
      learnAppearance: boolean,
      phase: CrossingPhase
    ) => {
      if (!candidate) return
      const prev = this.slots[key]
      let vel = { vx: 0, vy: 0 }
      if (prev) {
        const dt = Math.max(1, wallNow - prev.wallMs)
        const raw = clampVelocity(
          (candidate.anchor.x - prev.anchor.x) / dt,
          (candidate.anchor.y - prev.anchor.y) / dt
        )
        vel = {
          vx: prev.velocity.vx * (1 - IDENTITY_VELOCITY_ALPHA) + raw.vx * IDENTITY_VELOCITY_ALPHA,
          vy: prev.velocity.vy * (1 - IDENTITY_VELOCITY_ALPHA) + raw.vy * IDENTITY_VELOCITY_ALPHA,
        }
      }
      const color =
        learnAppearance || phase === 'tracking'
          ? updateIdentitySlotColor(prev, candidate, phase, IDENTITY_COLOR_SMOOTHING)
          : prev?.color ?? candidate.color
      this.slots[key] = {
        pose: candidate.pose,
        anchor: candidate.anchor,
        color,
        anchorColor: prev?.anchorColor ?? null,
        scale: learnAppearance && prev ? prev.scale * 0.84 + candidate.scale * 0.16 : prev?.scale ?? candidate.scale,
        velocity: vel,
        wallMs: wallNow,
        confidence: Math.min(1, (prev?.confidence ?? 0.6) + 0.08),
      }
      updateProfile(key, candidate, learnAppearance && phase === 'tracking')
    }

    let { A: assignA, B: assignB } = assignFighterTracks(
      candidates,
      this.slots.A,
      this.slots.B,
      wallNow,
      phaseIn,
      (candidate, slot) => ({
        poseShape: poseShapeDistance(candidate.pose, slot.pose),
        scaleWeight: IDENTITY_SCALE_WEIGHT,
        poseWeight: IDENTITY_POSE_WEIGHT,
      })
    )

    if (candidates.length === 1 && this.slots.A && this.slots.B && isCrossingPhase(phaseIn)) {
      this.occlusionUntil = wallNow + IDENTITY_OCCLUSION_HOLD_MS
      const profileA = profileCost(candidates[0], 'A')
      const profileB = profileCost(candidates[0], 'B')
      const profileClear =
        Number.isFinite(profileA) &&
        Number.isFinite(profileB) &&
        Math.abs(profileA - profileB) > IDENTITY_PROFILE_CLEAR_MARGIN * 1.5
      let lk: FighterKey
      if (profileClear) {
        lk = profileA < profileB ? 'A' : 'B'
      } else if (this.lockKey) {
        lk = this.lockKey
      } else {
        lk = assignA ? 'A' : 'B'
      }
      this.lockKey = lk
      assignA = lk === 'A' ? candidates[0] : undefined
      assignB = lk === 'B' ? candidates[0] : undefined
    } else if (candidates.length >= 2) {
      this.lockKey = null
    }

    const learnAppearance = phaseIn === 'tracking' && candidates.length >= 2
    updateSlot('A', assignA, learnAppearance, phaseIn)
    updateSlot('B', assignB, learnAppearance, phaseIn)

    const phaseResult = advanceCrossingPhase(
      phaseIn, this.slots.A, this.slots.B, posesLength, wallNow, this.recoveryStable
    )
    this.crossingPhase = phaseResult.phase
    this.recoveryStable = phaseResult.stableFrames
    if (phaseResult.phase === 'tracking') this.lockKey = null

    return { A: assignA?.pose ?? null, B: assignB?.pose ?? null }
  }

  /** Feed one ordered frame; returns the {A,B} landmarks plus per-frame diagnostics. */
  push(frame: ReplayInFrame): {
    A: NormalizedLandmark[] | null
    B: NormalizedLandmark[] | null
    rawA: boolean
    rawB: boolean
    nCands: number
    phase: CrossingPhase
    lock: FighterKey | null
  } {
    const wallNow = frame.tMs
    const allPoses = frame.candidates.map((c) => c.pose)
    const deduped = dedupePoseCandidates(allPoses)
    const candidates: CornerCandidate[] = deduped
      .map((pose) => {
        const src = frame.candidates[allPoses.indexOf(pose)]
        const anchor = getPoseAnchor(pose)
        if (!anchor) return null
        const color: ColorProfile | null = src?.color
          ? { torso: src.color.torso, legs: src.color.lower ?? null }
          : null
        return { pose, anchor, color, scale: getPoseScale(pose) }
      })
      .filter((c): c is CornerCandidate => !!c)

    const { A: rawA, B: rawB } = this.assignCornerIdentities(candidates, deduped.length, wallNow)

    const holdMs = crossingHoldMs(this.crossingPhase, deduped.length)
    const reAcquiredA = rawA && (this.lastSeen.A === null || wallNow - this.lastSeen.A > holdMs)
    const reAcquiredB = rawB && (this.lastSeen.B === null || wallNow - this.lastSeen.B > holdMs)
    if (reAcquiredA) { this.lastRaw.A = null; this.prevRaw.A = null; this.smoothed.A = null }
    if (reAcquiredB) { this.lastRaw.B = null; this.prevRaw.B = null; this.smoothed.B = null }

    if (rawA) this.lastSeen.A = wallNow
    if (rawB) this.lastSeen.B = wallNow
    const keepA = !rawA && this.lastSeen.A !== null && wallNow - this.lastSeen.A < holdMs
    const keepB = !rawB && this.lastSeen.B !== null && wallNow - this.lastSeen.B < holdMs

    for (const key of ['A', 'B'] as const) {
      const raw = key === 'A' ? rawA : rawB
      const keep = key === 'A' ? keepA : keepB
      if (keep && !raw && this.smoothed[key]) {
        const vel = this.velocity[key]
        const elapsed = wallNow - (this.lastSeen[key] ?? wallNow)
        const decay = Math.max(0, 1 - Math.max(0, elapsed - 200) / (holdMs - 200))
        if (Math.hypot(vel.vx, vel.vy) > 0.002 && decay > 0) {
          this.smoothed[key] = this.smoothed[key]!.map((lm) => ({
            ...lm,
            x: Math.max(0, Math.min(1, lm.x + vel.vx * decay * 0.5)),
            y: Math.max(0, Math.min(1, lm.y + vel.vy * decay * 0.5)),
          })) as NormalizedLandmark[]
        }
      }
    }

    const smoothAlpha = crossingSmoothAlpha(this.crossingPhase)
    const landmarksA = rawA
      ? smoothLandmarks(rawA, this.lastRaw.A ?? this.smoothed.A, smoothAlpha)
      : keepA ? this.smoothed.A : null
    const landmarksB = rawB
      ? smoothLandmarks(rawB, this.lastRaw.B ?? this.smoothed.B, smoothAlpha)
      : keepB ? this.smoothed.B : null

    if (rawA) {
      if (this.lastRaw.A) this.velocity.A = getTorsoVelocity(rawA, this.lastRaw.A)
      this.prevRaw.A = this.lastRaw.A
      this.lastRaw.A = rawA
    }
    if (rawB) {
      if (this.lastRaw.B) this.velocity.B = getTorsoVelocity(rawB, this.lastRaw.B)
      this.prevRaw.B = this.lastRaw.B
      this.lastRaw.B = rawB
    }
    this.smoothed.A = landmarksA
    this.smoothed.B = landmarksB

    return {
      A: landmarksA,
      B: landmarksB,
      rawA: !!rawA,
      rawB: !!rawB,
      nCands: deduped.length,
      phase: this.crossingPhase,
      lock: this.lockKey,
    }
  }

  // Diagnostics the offline replay records alongside the track.
  get phase(): CrossingPhase { return this.crossingPhase }
  get lock(): FighterKey | null { return this.lockKey }
}

/**
 * Replay an ordered list of candidate frames into a dense A/B track.
 * `round` matches the in-browser dense pass which stores Math.round(tMs).
 */
export function replayCandidatesToDenseTrack(
  frames: ReplayInFrame[],
  opts?: { round?: boolean }
): DenseTrackSample[] {
  const sorted = [...frames].sort((a, b) => a.f - b.f)
  const replayer = new IdentityReplayer()
  const out: DenseTrackSample[] = []
  for (const frame of sorted) {
    const { A, B } = replayer.push(frame)
    out.push({ tMs: opts?.round === false ? frame.tMs : Math.round(frame.tMs), A, B })
  }
  return out
}

export { IdentityReplayer }
