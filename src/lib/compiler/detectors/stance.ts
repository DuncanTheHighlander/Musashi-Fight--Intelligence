import { POSE_LANDMARKS } from '@/lib/kinematics'
import { clamp01, dist2, median, vec2 } from '@/lib/geometry/geometry'
import { makeEvidenceRef, makeId, makeTimeRangeMs } from '@/lib/fightlang/fightlang.ids'
import type { ActorId, Confidence, EvidenceRef, PoseLandmark, StanceSide, Vec2 } from '@/lib/fightlang/fightlang.types'

function lm2(landmarks: ReadonlyArray<PoseLandmark> | undefined, idx: number): Vec2 | null {
  const lm = landmarks?.[idx]
  if (!lm) return null
  return vec2(lm.x, lm.y)
}

function hipCenter(landmarks: ReadonlyArray<PoseLandmark> | undefined): Vec2 | null {
  const lh = lm2(landmarks, POSE_LANDMARKS.LEFT_HIP)
  const rh = lm2(landmarks, POSE_LANDMARKS.RIGHT_HIP)
  if (!lh || !rh) return null
  return vec2((lh.x + rh.x) / 2, (lh.y + rh.y) / 2)
}

function shoulderWidth(landmarks: ReadonlyArray<PoseLandmark> | undefined): number | null {
  const ls = lm2(landmarks, POSE_LANDMARKS.LEFT_SHOULDER)
  const rs = lm2(landmarks, POSE_LANDMARKS.RIGHT_SHOULDER)
  if (!ls || !rs) return null
  const w = dist2(ls, rs)
  return w > 0 ? w : null
}

type StanceDetection = Readonly<{
  stanceSide: StanceSide
  stanceConfidence: Confidence
  stanceWidthBw: number | null
  stanceAngleDeg: number | null
  evidence: EvidenceRef[]
}>

/**
 * Heuristic stance-side inference:
 * - Choose lead foot as the foot closer to opponent hip center (proxy for opponent position).
 * - If lead foot is left → orthodox; if right → southpaw.
 * - If missing opponent or feet → unknown.
 *
 * This is intentionally conservative; camera angle + occlusion can break it.
 */
export function detectStance(input: {
  tMs: number
  actorId: ActorId
  landmarks: ReadonlyArray<PoseLandmark> | undefined
  opponentLandmarks: ReadonlyArray<PoseLandmark> | undefined
}): StanceDetection {
  const { tMs, actorId, landmarks, opponentLandmarks } = input

  const sw = shoulderWidth(landmarks)

  const lf = lm2(landmarks, POSE_LANDMARKS.LEFT_FOOT_INDEX) ?? lm2(landmarks, POSE_LANDMARKS.LEFT_ANKLE)
  const rf = lm2(landmarks, POSE_LANDMARKS.RIGHT_FOOT_INDEX) ?? lm2(landmarks, POSE_LANDMARKS.RIGHT_ANKLE)
  const oppHip = hipCenter(opponentLandmarks)

  let stanceSide: StanceSide = 'unknown'
  let confidenceScore = 0.35

  if (lf && rf && oppHip) {
    const dL = dist2(lf, oppHip)
    const dR = dist2(rf, oppHip)
    if (Math.abs(dL - dR) > 1e-4) {
      stanceSide = dL < dR ? 'orthodox' : 'southpaw'
      // More separation between distances → higher confidence.
      const sep = Math.abs(dL - dR)
      confidenceScore = clamp01(0.55 + sep * 1.2)
    }
  }

  const stanceWidthBw =
    lf && rf && sw
      ? dist2(lf, rf) / sw
      : null

  // Stance angle / bladedness proxy: angle between foot line and x-axis (image plane).
  // This is *not* a true yaw; used only as a coarse "squared vs bladed" hint.
  const stanceAngleDeg =
    lf && rf
      ? Math.abs((Math.atan2(rf.y - lf.y, rf.x - lf.x) * 180) / Math.PI)
      : null

  const evidence: EvidenceRef[] = [
    makeEvidenceRef({
      id: makeId(`ev_stance_${actorId}`),
      source: 'geometry',
      actorId,
      t: makeTimeRangeMs(tMs),
      note: 'Stance inferred by lead-foot proximity to opponent hip-center (heuristic).',
    }),
  ]

  return {
    stanceSide,
    stanceConfidence: { score: confidenceScore, basis: 'heuristic' },
    stanceWidthBw: Number.isFinite(stanceWidthBw) ? stanceWidthBw : null,
    stanceAngleDeg: Number.isFinite(stanceAngleDeg) ? stanceAngleDeg : null,
    evidence,
  }
}

