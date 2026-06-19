import { makeEvidenceRef, makeId, makeTimeRangeMs } from '@/lib/fightlang/fightlang.ids'
import type { ActorId, EvidenceRef, RangeBand } from '@/lib/fightlang/fightlang.types'
import { rangeBandFromDistance } from '@/lib/fightlang/fightlang.defaults'

export type RangeDetection = Readonly<{
  band: RangeBand
  distanceBw: number | null
  closingBwps: number | null
  evidence: EvidenceRef[]
}>

export function detectRange(input: {
  tMs: number
  actorId: ActorId
  distanceBw?: number | null
  closingBwps?: number | null
}): RangeDetection {
  const { tMs, actorId } = input
  const distanceBw = typeof input.distanceBw === 'number' && Number.isFinite(input.distanceBw) ? input.distanceBw : null
  const closingBwps = typeof input.closingBwps === 'number' && Number.isFinite(input.closingBwps) ? input.closingBwps : null

  const band = distanceBw == null ? 'unknown' : rangeBandFromDistance(distanceBw)
  const evidence: EvidenceRef[] = [
    makeEvidenceRef({
      id: makeId(`ev_range_${actorId}`),
      source: 'kinematics',
      actorId,
      t: makeTimeRangeMs(tMs),
      note: 'Range band inferred from body-width distance (from kinematics if available).',
    }),
  ]

  return { band, distanceBw, closingBwps, evidence }
}

