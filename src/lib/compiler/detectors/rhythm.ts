import { POSE_LANDMARKS } from '@/lib/kinematics'
import { coeffOfVariation, median, vec2 } from '@/lib/geometry/geometry'
import { makeEvidenceRef, makeId, makeTimeRangeMs } from '@/lib/fightlang/fightlang.ids'
import type { ActorId, EvidenceRef, PoseFrame, PoseLandmark } from '@/lib/fightlang/fightlang.types'

type RhythmFeatures = Readonly<{
  bounceHz: number | null
  cadenceCv: number | null
  evidence: EvidenceRef[]
}>

function lmY(landmarks: ReadonlyArray<PoseLandmark> | undefined, idx: number): number | null {
  const lm = landmarks?.[idx]
  if (!lm) return null
  return lm.y
}

/**
 * Rhythm features (v1):
 * - bounceHz: approximate vertical bounce frequency from hip-center Y oscillations.
 * - cadenceCv: coefficient-of-variation of detected "bounce peaks" intervals.
 *
 * These are coarse and meant only for style scaffolding + UI hints.
 */
export function detectRhythm(input: {
  actorId: ActorId
  poseFrames: ReadonlyArray<PoseFrame>
  endMs: number
  windowMs: number
}): RhythmFeatures {
  const { actorId, poseFrames, endMs, windowMs } = input
  const startMs = Math.max(0, endMs - windowMs)
  const frames = poseFrames.filter((f) => f.tMs >= startMs && f.tMs <= endMs)

  const series = frames
    .map((f) => {
      const lms = f.actors[actorId]
      const ly = lmY(lms, POSE_LANDMARKS.LEFT_HIP)
      const ry = lmY(lms, POSE_LANDMARKS.RIGHT_HIP)
      if (ly == null && ry == null) return null
      const y = ly != null && ry != null ? (ly + ry) / 2 : ly ?? ry
      return { tMs: f.tMs, y }
    })
    .filter((v): v is { tMs: number; y: number } => Boolean(v && Number.isFinite(v.y)))

  if (series.length < 6) {
    return {
      bounceHz: null,
      cadenceCv: null,
      evidence: [
        makeEvidenceRef({
          id: makeId(`ev_rhythm_${actorId}`),
          source: 'kinematics',
          actorId,
          t: makeTimeRangeMs(endMs),
          note: 'Not enough samples for rhythm features.',
        }),
      ],
    }
  }

  const ys = series.map((s) => s.y)
  const y0 = median(ys) ?? ys[0] ?? 0
  const centered = series.map((s) => ({ tMs: s.tMs, v: s.y - y0 }))

  // Peak detection: simple local maxima with minimum spacing.
  const peaks: number[] = []
  const minPeakGapMs = 220
  for (let i = 1; i < centered.length - 1; i++) {
    const a = centered[i - 1]
    const b = centered[i]
    const c = centered[i + 1]
    if (!a || !b || !c) continue
    if (b.v > a.v && b.v > c.v && Math.abs(b.v) > 0.004) {
      const t = b.tMs
      const last = peaks[peaks.length - 1]
      if (last == null || t - last >= minPeakGapMs) peaks.push(t)
    }
  }

  const intervals = peaks.slice(1).map((t, i) => t - (peaks[i] ?? t)).filter((dt) => dt > 0)
  const cadenceCv = coeffOfVariation(intervals)
  const avgIntervalMs =
    intervals.length > 0 ? intervals.reduce((s, v) => s + v, 0) / intervals.length : null
  const bounceHz = avgIntervalMs && avgIntervalMs > 0 ? 1000 / avgIntervalMs : null

  return {
    bounceHz,
    cadenceCv,
    evidence: [
      makeEvidenceRef({
        id: makeId(`ev_rhythm_${actorId}`),
        source: 'kinematics',
        actorId,
        t: makeTimeRangeMs(startMs, endMs),
        note: 'Rhythm features from hip-center vertical oscillation (coarse).',
      }),
    ],
  }
}

