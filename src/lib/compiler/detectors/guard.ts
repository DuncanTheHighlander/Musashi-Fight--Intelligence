import { POSE_LANDMARKS } from '@/lib/kinematics'
import { clamp01, vec2 } from '@/lib/geometry/geometry'
import { makeEvidenceRef, makeId, makeTimeRangeMs } from '@/lib/fightlang/fightlang.ids'
import type { ActorId, EvidenceRef, GuardShape, PoseLandmark, Vec2 } from '@/lib/fightlang/fightlang.types'

function lmY(landmarks: ReadonlyArray<PoseLandmark> | undefined, idx: number): number | null {
  const lm = landmarks?.[idx]
  if (!lm) return null
  return lm.y
}

function lm2(landmarks: ReadonlyArray<PoseLandmark> | undefined, idx: number): Vec2 | null {
  const lm = landmarks?.[idx]
  if (!lm) return null
  return vec2(lm.x, lm.y)
}

export type GuardDetection = Readonly<{
  shape: GuardShape
  handsHigh: boolean | null
  exposureScore: number | null // 0..1
  headLine: { chin: Vec2; nose: Vec2 } | null
  evidence: EvidenceRef[]
}>

/**
 * Guard inference (v1):
 * - "handsHigh" proxy: wrists are above shoulder line (in image coords).
 * - exposureScore: if either wrist drops below nose level, exposure increases.
 *
 * NOTE: this is camera-plane only; depth/rotation can mislead.
 */
export function detectGuard(input: {
  tMs: number
  actorId: ActorId
  landmarks: ReadonlyArray<PoseLandmark> | undefined
}): GuardDetection {
  const { tMs, actorId, landmarks } = input

  const lsY = lmY(landmarks, POSE_LANDMARKS.LEFT_SHOULDER)
  const rsY = lmY(landmarks, POSE_LANDMARKS.RIGHT_SHOULDER)
  const nose = lm2(landmarks, POSE_LANDMARKS.NOSE)
  const chin = lm2(landmarks, POSE_LANDMARKS.MOUTH_RIGHT) ?? lm2(landmarks, POSE_LANDMARKS.MOUTH_LEFT)

  const lwY = lmY(landmarks, POSE_LANDMARKS.LEFT_WRIST)
  const rwY = lmY(landmarks, POSE_LANDMARKS.RIGHT_WRIST)

  const shoulderY =
    lsY != null && rsY != null ? (lsY + rsY) / 2 : lsY != null ? lsY : rsY != null ? rsY : null

  let handsHigh: boolean | null = null
  if (shoulderY != null && lwY != null && rwY != null) {
    // y is downwards; above shoulder means smaller y
    handsHigh = lwY < shoulderY && rwY < shoulderY
  }

  let exposureScore: number | null = null
  if (nose && lwY != null && rwY != null) {
    const belowNose = Math.max(0, Math.max(lwY - nose.y, rwY - nose.y))
    exposureScore = clamp01(belowNose / 0.08)
  }

  let shape: GuardShape = 'unknown'
  if (handsHigh === true) shape = 'high'
  else if (handsHigh === false) shape = exposureScore != null && exposureScore > 0.5 ? 'low' : 'mid'

  const evidence: EvidenceRef[] = [
    makeEvidenceRef({
      id: makeId(`ev_guard_${actorId}`),
      source: 'geometry',
      actorId,
      t: makeTimeRangeMs(tMs),
      note: 'Guard inferred by wrist height vs shoulders/nose (heuristic).',
    }),
  ]

  return {
    shape,
    handsHigh,
    exposureScore,
    headLine: nose && chin ? { chin, nose } : null,
    evidence,
  }
}

