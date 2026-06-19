import { POSE_LANDMARKS } from '@/lib/kinematics'
import { clamp01, dist2, vec2 } from '@/lib/geometry/geometry'
import { makeEvidenceRef, makeId, makeTimeRangeMs } from '@/lib/fightlang/fightlang.ids'
import type { ActorId, EvidenceRef, FightFault, PoseLandmark } from '@/lib/fightlang/fightlang.types'

function lm2(landmarks: ReadonlyArray<PoseLandmark> | undefined, idx: number): { x: number; y: number } | null {
  const lm = landmarks?.[idx]
  if (!lm) return null
  return vec2(lm.x, lm.y)
}

function shoulderWidth(landmarks: ReadonlyArray<PoseLandmark> | undefined): number | null {
  const ls = lm2(landmarks, POSE_LANDMARKS.LEFT_SHOULDER)
  const rs = lm2(landmarks, POSE_LANDMARKS.RIGHT_SHOULDER)
  if (!ls || !rs) return null
  const w = dist2(ls, rs)
  return w > 0 ? w : null
}

export type FaultDetectionInput = Readonly<{
  tMs: number
  actorId: ActorId
  landmarks: ReadonlyArray<PoseLandmark> | undefined
  guardExposureScore?: number | null
  compromisedBaseScoreBw?: number | null
}>

export function detectFaults(input: FaultDetectionInput): FightFault[] {
  const { tMs, actorId, landmarks } = input
  const sw = shoulderWidth(landmarks)

  const faults: FightFault[] = []

  const evidenceBase = (kind: string, note: string): EvidenceRef[] => [
    makeEvidenceRef({
      id: makeId(`ev_fault_${kind}_${actorId}`),
      source: 'compiler',
      actorId,
      t: makeTimeRangeMs(tMs),
      note,
    }),
  ]

  // Guard low (based on exposureScore proxy).
  if (typeof input.guardExposureScore === 'number') {
    const score = clamp01(input.guardExposureScore)
    if (score > 0.55) {
      faults.push({
        id: makeId('fault_guard_low'),
        kind: 'guard_low',
        actorId,
        t: makeTimeRangeMs(tMs),
        severity: score > 0.8 ? 'high' : 'medium',
        confidence: { score: clamp01(0.55 + score * 0.4), basis: 'heuristic' },
        evidence: evidenceBase('guard_low', 'Guard low inferred from wrists below nose level (heuristic).'),
        message: 'Guard drops below head-line (exposure increases).',
        data: { exposureScore: score },
      })
    }
  }

  // Chin exposed proxy: nose far ahead of hip center in x-axis direction (camera-plane).
  const nose = lm2(landmarks, POSE_LANDMARKS.NOSE)
  const lh = lm2(landmarks, POSE_LANDMARKS.LEFT_HIP)
  const rh = lm2(landmarks, POSE_LANDMARKS.RIGHT_HIP)
  if (nose && lh && rh && sw) {
    const hipX = (lh.x + rh.x) / 2
    const dx = Math.abs(nose.x - hipX)
    const score = clamp01(dx / (sw * 0.9))
    if (score > 0.6) {
      faults.push({
        id: makeId('fault_chin_exposed'),
        kind: 'chin_exposed',
        actorId,
        t: makeTimeRangeMs(tMs),
        severity: score > 0.8 ? 'high' : 'medium',
        confidence: { score: clamp01(0.5 + score * 0.45), basis: 'heuristic' },
        evidence: evidenceBase('chin_exposed', 'Chin exposure proxy from nose lateral offset vs hip center.'),
        message: 'Head position drifts off base line (chin exposure proxy).',
        data: { noseDxNorm: dx / sw, score },
      })
    }
  }

  // Overextension proxy: wrist too far from shoulder relative to shoulder width.
  const ls = lm2(landmarks, POSE_LANDMARKS.LEFT_SHOULDER)
  const rs = lm2(landmarks, POSE_LANDMARKS.RIGHT_SHOULDER)
  const lw = lm2(landmarks, POSE_LANDMARKS.LEFT_WRIST)
  const rw = lm2(landmarks, POSE_LANDMARKS.RIGHT_WRIST)
  if (sw && ((ls && lw) || (rs && rw))) {
    const leftReach = ls && lw ? dist2(ls, lw) / sw : 0
    const rightReach = rs && rw ? dist2(rs, rw) / sw : 0
    const reach = Math.max(leftReach, rightReach)
    const score = clamp01((reach - 1.25) / 0.65)
    if (score > 0.55) {
      faults.push({
        id: makeId('fault_overextension'),
        kind: 'overextension',
        actorId,
        t: makeTimeRangeMs(tMs),
        severity: score > 0.8 ? 'high' : 'medium',
        confidence: { score: clamp01(0.5 + score * 0.45), basis: 'heuristic' },
        evidence: evidenceBase('overextension', 'Overextension proxy from wrist reach vs shoulder width.'),
        message: 'Overreaching / overextension detected (reach proxy).',
        data: { reachBw: reach, score },
      })
    }
  }

  // Compromised base (if provided by upstream geometry module / future calculation).
  if (typeof input.compromisedBaseScoreBw === 'number') {
    const score = clamp01(input.compromisedBaseScoreBw / 0.5)
    if (input.compromisedBaseScoreBw >= 0.35) {
      faults.push({
        id: makeId('fault_compromised_base'),
        kind: 'compromised_base',
        actorId,
        t: makeTimeRangeMs(tMs),
        severity: input.compromisedBaseScoreBw >= 0.55 ? 'high' : 'medium',
        confidence: { score: clamp01(0.55 + score * 0.4), basis: 'heuristic' },
        evidence: evidenceBase('compromised_base', 'Compromised base inferred from hip drift vs foot midpoint proxy (if available).'),
        message: 'Base integrity compromised (hip/base alignment proxy).',
        data: { scoreBw: input.compromisedBaseScoreBw },
      })
    }
  }

  return faults
}

