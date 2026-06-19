import type {
  ActorId,
  EvidenceRef,
  FightEvidenceLedger,
  RangeBand,
  StrategyAssessment,
  StyleArchetype,
} from '@/lib/fightlang/fightlang.types'
import { median } from '@/lib/geometry/geometry'
import { makeEvidenceRef, makeId, makeTimeRangeMs } from '@/lib/fightlang/fightlang.ids'

function pickLatestRangePreference(ledger: FightEvidenceLedger): RangeBand | null {
  // Prefer kinematics range band if present.
  for (let i = ledger.kinematics.length - 1; i >= 0; i--) {
    const r = ledger.kinematics[i]?.range?.band
    if (r) return r
  }
  // Otherwise use actorStateTimeline.
  for (let i = ledger.actorStateTimeline.length - 1; i >= 0; i--) {
    const r = ledger.actorStateTimeline[i]?.rangeToOther
    if (r) return r
  }
  return null
}

function actorGeometrySamples(ledger: FightEvidenceLedger, actorId: ActorId) {
  return ledger.geometry.filter((g) => g.actorId === actorId)
}

function guardHighRate(ledger: FightEvidenceLedger, actorId: ActorId): number | null {
  const samples = actorGeometrySamples(ledger, actorId).map((g) => g.guard.handsHigh).filter((v): v is boolean => typeof v === 'boolean')
  if (!samples.length) return null
  return samples.filter(Boolean).length / samples.length
}

function stanceWidthP50(ledger: FightEvidenceLedger, actorId: ActorId): number | null {
  const values = actorGeometrySamples(ledger, actorId)
    .map((g) => g.stanceWidthBw)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return median(values)
}

function stanceAngleP50(ledger: FightEvidenceLedger, actorId: ActorId): number | null {
  const values = actorGeometrySamples(ledger, actorId)
    .map((g) => g.stanceAngleDeg)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return median(values)
}

function bounceHzP50(ledger: FightEvidenceLedger, actorId: ActorId): number | null {
  const values = ledger.actorStateTimeline
    .filter((s) => s.actorId === actorId)
    .map((s) => s.rhythm?.bounceHz)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return median(values)
}

function cadenceCvP50(ledger: FightEvidenceLedger, actorId: ActorId): number | null {
  const values = ledger.actorStateTimeline
    .filter((s) => s.actorId === actorId)
    .map((s) => s.rhythm?.cadenceCv)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  return median(values)
}

function countFaultRate(ledger: FightEvidenceLedger, actorId: ActorId, kinds: string[]): number | null {
  const relevant = ledger.faults.filter((f) => f.actorId === actorId && kinds.includes(f.kind))
  const frames = ledger.actorStateTimeline.filter((s) => s.actorId === actorId).length
  if (!frames) return null
  return Math.min(1, relevant.length / Math.max(1, frames / 10)) // normalize ~10Hz state sampling
}

function archetypeFromFeatures(f: {
  rangePref: RangeBand | null
  bounceHz: number | null
  cadenceCv: number | null
  guardHighRate: number | null
  stanceWidthBw: number | null
  stanceAngleDeg: number | null
}): { archetype: StyleArchetype; confidence: number; ambiguity: string[] } {
  const ambiguity: string[] = []

  const rangePref = f.rangePref ?? 'unknown'
  const bounceHz = f.bounceHz
  const cadenceCv = f.cadenceCv
  const guardHigh = f.guardHighRate
  const width = f.stanceWidthBw
  const angle = f.stanceAngleDeg

  // Scoring across archetypes (coarse). We keep this stable but tuneable.
  const score: Record<StyleArchetype, number> = {
    pressure_boxer: 0,
    outfighter: 0,
    counter_puncher: 0,
    muay_thai_influenced: 0,
    kickboxer: 0,
    karate_point_fighting_influenced: 0,
    taekwondo_influenced: 0,
    mma_hybrid_striker: 0,
    unknown: 0.1,
  }

  // Range preference
  if (rangePref === 'close') score.pressure_boxer += 0.35
  if (rangePref === 'mid') score.kickboxer += 0.15
  if (rangePref === 'long') {
    score.outfighter += 0.35
    score.karate_point_fighting_influenced += 0.25
    score.taekwondo_influenced += 0.2
  }
  if (rangePref === 'unknown') ambiguity.push('range_unknown')

  // Bounce & cadence (point-fighting / karate / TKD tends to have clearer bounce; pressure tends lower bounce)
  if (bounceHz != null) {
    if (bounceHz >= 1.4) {
      score.karate_point_fighting_influenced += 0.25
      score.taekwondo_influenced += 0.2
      score.outfighter += 0.1
    }
    if (bounceHz < 0.9) {
      score.pressure_boxer += 0.15
      score.counter_puncher += 0.05
    }
  } else {
    ambiguity.push('bounce_unknown')
  }

  if (cadenceCv != null) {
    if (cadenceCv < 0.14) score.pressure_boxer += 0.1 // steady marching tempo proxy
    if (cadenceCv >= 0.22) score.counter_puncher += 0.1 // irregular cadence proxy
  } else {
    ambiguity.push('cadence_unknown')
  }

  // Guard discipline proxies
  if (guardHigh != null) {
    if (guardHigh >= 0.7) score.pressure_boxer += 0.12
    if (guardHigh < 0.4) {
      score.karate_point_fighting_influenced += 0.08
      score.outfighter += 0.06
    }
  } else {
    ambiguity.push('guard_unknown')
  }

  // Stance width + angle (bladed tends more point-fighting; square can be pressure / kickboxing)
  if (width != null) {
    if (width < 0.9) score.karate_point_fighting_influenced += 0.08
    if (width > 1.35) score.kickboxer += 0.08
  } else ambiguity.push('stance_width_unknown')

  if (angle != null) {
    if (angle > 35) score.karate_point_fighting_influenced += 0.12
    if (angle < 18) score.pressure_boxer += 0.06
  } else ambiguity.push('stance_angle_unknown')

  // Pick best
  const entries = Object.entries(score) as Array<[StyleArchetype, number]>
  entries.sort((a, b) => b[1] - a[1])
  const [best, bestScore] = entries[0] ?? ['unknown', 0.1]
  const second = entries[1]?.[1] ?? 0
  const margin = bestScore - second

  const confidence = Math.max(0.2, Math.min(0.9, 0.35 + bestScore + margin * 0.5))
  if (margin < 0.12) ambiguity.push('archetype_ambiguous')

  return { archetype: best, confidence, ambiguity }
}

export function inferStyle(ledger: FightEvidenceLedger, actorId: ActorId): StrategyAssessment {
  const rangePref = pickLatestRangePreference(ledger)
  const features = {
    stanceWidthBwP50: stanceWidthP50(ledger, actorId),
    stanceAngleDegP50: stanceAngleP50(ledger, actorId),
    guardHighRate: guardHighRate(ledger, actorId),
    rangePreference: rangePref,
    bounceHzP50: bounceHzP50(ledger, actorId),
    cadenceCvP50: cadenceCvP50(ledger, actorId),
    leadLegActivityRate: null,
    headMovementRate: null,
    entryDirectness: 'unknown' as const,
    exitStyle: 'unknown' as const,
  }

  const { archetype, confidence, ambiguity } = archetypeFromFeatures({
    rangePref: features.rangePreference ?? 'unknown',
    bounceHz: features.bounceHzP50,
    cadenceCv: features.cadenceCvP50,
    guardHighRate: features.guardHighRate,
    stanceWidthBw: features.stanceWidthBwP50,
    stanceAngleDeg: features.stanceAngleDegP50,
  })

  const supportingEvidence: EvidenceRef[] = [
    makeEvidenceRef({
      id: makeId(`ev_style_${actorId}`),
      source: 'compiler',
      actorId,
      t: makeTimeRangeMs(ledger.poseFrames?.[0]?.tMs ?? ledger.generatedAtMs, ledger.poseFrames?.at(-1)?.tMs ?? ledger.generatedAtMs),
      note: 'Style inference uses stance width/angle, guard rate, range band, bounce and cadence features.',
    }),
  ]

  return {
    actorId,
    archetype,
    confidence: { score: confidence, basis: 'heuristic' },
    supportingEvidence,
    features,
    ambiguityFlags: ambiguity,
  }
}

