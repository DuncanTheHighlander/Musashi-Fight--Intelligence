import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { OverlayBox } from '@/lib/overlayGeometry'
import { clamp } from '@/lib/overlayGeometry'

export type PosePair = { A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null }
export type FighterKey = 'A' | 'B'
export type TimedPosePair = { tMs: number; pose: PosePair }

export const POSE_HISTORY_KEEP_MS = 1600
export const POSE_HISTORY_MAX_SAMPLES = 24
export const POSE_HISTORY_RESET_GAP_MS = 1500
export const POSE_SEEK_RESET_MS = 250
export const POSE_INTERPOLATE_MAX_GAP_MS = 1300
export const POSE_EXTRAPOLATE_MAX_RATIO = 1.6
export const POSE_STALE_MAX_MS = 1400
export const POSE_LIVE_MAX_LEAD_MS = 32
/** Typical pose cadence is 45–75 ms; allow one interval of lag before forcing history. */
export const POSE_LIVE_MAX_LAG_MS = 180
/**
 * Max display-ahead lag (ms) for painting the raw detection without history
 * interpolation. Larger values pin a stale pose on every RVFC frame while the
 * playhead advances — the skeleton visibly trails the fighter during playback.
 * ~1 composited frame at 60fps; above this we forward-interpolate history.
 */
export const POSE_DIRECT_DRAW_MAX_LAG_MS = 20
export const POSE_FADE_START_MS = 200
/**
 * A pose held past this much staleness has fully faded out. Kept well under
 * POSE_STALE_MAX_MS (which still gates interpolation validity) so a fighter
 * LOST by detection — e.g. a fighter occluded behind the other during a
 * crossing — disappears quickly instead of leaving a solid skeleton frozen on
 * an empty patch of canvas ("ghost off the person").
 */
export const POSE_FADE_END_MS = 600
export const POSE_FADE_MIN_ALPHA = 0

function blendLandmark(
  previous: NormalizedLandmark,
  next: NormalizedLandmark,
  ratio: number
): NormalizedLandmark {
  const t = clamp(ratio, -1, POSE_EXTRAPOLATE_MAX_RATIO)
  const out: NormalizedLandmark = {
    ...next,
    x: previous.x + (next.x - previous.x) * t,
    y: previous.y + (next.y - previous.y) * t,
  }
  if (typeof previous.z === 'number' && typeof next.z === 'number') {
    out.z = previous.z + (next.z - previous.z) * t
  }
  if (typeof previous.visibility === 'number' && typeof next.visibility === 'number') {
    out.visibility = previous.visibility + (next.visibility - previous.visibility) * clamp(t, 0, 1)
  }
  return out
}

function blendPose(
  previous: NormalizedLandmark[],
  next: NormalizedLandmark[],
  ratio: number
): NormalizedLandmark[] {
  if (previous.length !== next.length) return next
  return next.map((landmark, index) => {
    const prev = previous[index]
    return prev ? blendLandmark(prev, landmark, ratio) : landmark
  })
}

export function resolveActorPoseAt(
  history: TimedPosePair[],
  actor: FighterKey,
  targetMs: number,
  fallback: NormalizedLandmark[] | null
): NormalizedLandmark[] | null {
  const samples = history.filter((sample) => sample.pose[actor])
  if (samples.length === 0) return fallback

  let previousIndex = -1
  let nextIndex = -1
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].tMs <= targetMs) {
      previousIndex = i
    } else {
      nextIndex = i
      break
    }
  }

  const previous = previousIndex >= 0 ? samples[previousIndex] : null
  const next = nextIndex >= 0 ? samples[nextIndex] : null

  if (previous && next) {
    const gap = next.tMs - previous.tMs
    if (gap > 0 && gap <= POSE_INTERPOLATE_MAX_GAP_MS) {
      const ratio = (targetMs - previous.tMs) / gap
      // Allow modest forward extrapolation when the composited frame is slightly
      // ahead of the newest detection — capping at ratio=1 pinned the skeleton
      // behind fast-moving fighters during live playback.
      if (ratio <= POSE_EXTRAPOLATE_MAX_RATIO) {
        return blendPose(previous.pose[actor]!, next.pose[actor]!, ratio)
      }
      // Playhead ran past the newest sample: cap forward extrapolation instead of
      // snapping back to the stale nearest bracket (the main playback trail bug).
      if (targetMs >= next.tMs) {
        return blendPose(previous.pose[actor]!, next.pose[actor]!, POSE_EXTRAPOLATE_MAX_RATIO)
      }
    }
    return targetMs - previous.tMs <= next.tMs - targetMs ? previous.pose[actor]! : next.pose[actor]!
  }

  if (previous) {
    const age = targetMs - previous.tMs
    if (age > POSE_STALE_MAX_MS) return null
    // Playhead between the last two detections: interpolate. When the playhead
    // runs past the newest sample (ratio > 1), hold at the last detection —
    // forward extrapolation projected limbs past the body on slowdowns and
    // direction changes (the main visible drift during live playback).
    if (age > 0 && previousIndex > 0) {
      const prevPrev = samples[previousIndex - 1]
      const gap = previous.tMs - prevPrev.tMs
      if (
        prevPrev.pose[actor] &&
        gap > 0 &&
        gap <= POSE_INTERPOLATE_MAX_GAP_MS &&
        age <= POSE_INTERPOLATE_MAX_GAP_MS
      ) {
        const ratio = (targetMs - prevPrev.tMs) / gap
        if (ratio <= POSE_EXTRAPOLATE_MAX_RATIO) {
          return blendPose(prevPrev.pose[actor]!, previous.pose[actor]!, ratio)
        }
        if (targetMs > previous.tMs) {
          return blendPose(prevPrev.pose[actor]!, previous.pose[actor]!, POSE_EXTRAPOLATE_MAX_RATIO)
        }
      }
    }
    if (age > 0 && fallback) return fallback
    return previous.pose[actor]!
  }

  if (next) {
    return next.tMs - targetMs <= POSE_STALE_MAX_MS ? next.pose[actor]! : null
  }

  return fallback
}

export function resolvePoseAt(
  history: TimedPosePair[],
  targetMs: number,
  fallback: PosePair
): PosePair {
  return {
    A: resolveActorPoseAt(history, 'A', targetMs, fallback.A),
    B: resolveActorPoseAt(history, 'B', targetMs, fallback.B),
  }
}

export function appendPoseHistorySample(
  history: TimedPosePair[],
  tMs: number,
  poseSample: PosePair,
  stableBoxes: { A: OverlayBox | null; B: OverlayBox | null; cw: number; ch: number }
): void {
  const last = history[history.length - 1]
  if (last && (tMs < last.tMs - POSE_SEEK_RESET_MS || tMs - last.tMs > POSE_HISTORY_RESET_GAP_MS)) {
    history.length = 0
    stableBoxes.A = null
    stableBoxes.B = null
  }

  const updatedLast = history[history.length - 1]
  if (updatedLast && Math.abs(updatedLast.tMs - tMs) < 1) {
    updatedLast.pose = poseSample
  } else {
    history.push({ tMs, pose: poseSample })
  }

  const cutoff = tMs - POSE_HISTORY_KEEP_MS
  while (
    history.length > POSE_HISTORY_MAX_SAMPLES ||
    (history.length > 2 && history[0].tMs < cutoff)
  ) {
    history.shift()
  }
}

export function actorPoseAgeMs(
  history: TimedPosePair[],
  actor: FighterKey,
  targetMs: number
): number | null {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].pose[actor]) return targetMs - history[i].tMs
  }
  return null
}

export function staleFadeAlpha(ageMs: number | null): number {
  if (ageMs == null || ageMs <= POSE_FADE_START_MS) return 1
  const t = (ageMs - POSE_FADE_START_MS) / Math.max(1, POSE_FADE_END_MS - POSE_FADE_START_MS)
  return Math.max(POSE_FADE_MIN_ALPHA, 1 - t * (1 - POSE_FADE_MIN_ALPHA))
}

/** True when the detection is recent enough to show (staleness / fade gate). */
export function isPoseFreshForDisplay(poseTimeMs: number | null, displayMs: number | null): boolean {
  if (displayMs == null || typeof poseTimeMs !== 'number' || !Number.isFinite(poseTimeMs)) {
    return false
  }
  const lagMs = displayMs - poseTimeMs
  return lagMs >= -POSE_LIVE_MAX_LEAD_MS && lagMs <= POSE_LIVE_MAX_LAG_MS
}

/** True when detection media time matches the composited frame — safe to skip interpolation. */
export function isPoseAlignedToFrame(poseTimeMs: number | null, displayMs: number | null): boolean {
  if (displayMs == null || typeof poseTimeMs !== 'number' || !Number.isFinite(poseTimeMs)) {
    return false
  }
  const lagMs = displayMs - poseTimeMs
  return lagMs >= -POSE_LIVE_MAX_LEAD_MS && lagMs <= POSE_DIRECT_DRAW_MAX_LAG_MS
}
