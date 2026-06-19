import { FightEvidenceLedgerSchemaV1 } from '@/lib/fightlang/fightlang.schema'
import type { FightEvidenceLedger } from '@/lib/fightlang/fightlang.types'

export type LedgerValidationIssue = Readonly<{
  code: string
  message: string
  path?: string
}>

export type LedgerValidationResult = Readonly<{
  ok: boolean
  issues: LedgerValidationIssue[]
}>

export function validateFightEvidenceLedger(ledger: FightEvidenceLedger): LedgerValidationResult {
  const issues: LedgerValidationIssue[] = []

  const parsed = FightEvidenceLedgerSchemaV1.safeParse(ledger)
  if (!parsed.success) {
    for (const err of parsed.error.issues) {
      issues.push({
        code: 'schema_error',
        message: err.message,
        path: err.path.join('.'),
      })
    }
    return { ok: false, issues }
  }

  // Invariants (v1):
  // - EvidenceRef IDs are unique.
  // - Time ranges are sane.
  // - Actors referenced exist.
  const actorSet = new Set(parsed.data.actors)

  const evIds = new Set<string>()
  for (const ev of parsed.data.evidenceIndex) {
    if (evIds.has(ev.id)) {
      issues.push({ code: 'duplicate_evidence_id', message: `Duplicate evidence id: ${ev.id}` })
    } else {
      evIds.add(ev.id)
    }
    if (ev.t.endMs < ev.t.startMs) {
      issues.push({ code: 'bad_timerange', message: `Evidence ${ev.id} has endMs < startMs` })
    }
    if (ev.actorId && !actorSet.has(ev.actorId)) {
      issues.push({ code: 'unknown_actor', message: `Evidence ${ev.id} references unknown actor ${ev.actorId}` })
    }
  }

  const checkTimeRange = (id: string, startMs: number, endMs: number, label: string) => {
    if (endMs < startMs) issues.push({ code: 'bad_timerange', message: `${label} ${id} has endMs < startMs` })
    if (startMs < 0 || endMs < 0) issues.push({ code: 'bad_timerange', message: `${label} ${id} has negative time` })
  }

  for (const e of parsed.data.events) {
    checkTimeRange(e.id, e.t.startMs, e.t.endMs, 'Event')
    if (e.actorId && !actorSet.has(e.actorId)) issues.push({ code: 'unknown_actor', message: `Event ${e.id} unknown actor` })
  }
  for (const f of parsed.data.faults) {
    checkTimeRange(f.id, f.t.startMs, f.t.endMs, 'Fault')
    if (f.actorId && !actorSet.has(f.actorId)) issues.push({ code: 'unknown_actor', message: `Fault ${f.id} unknown actor` })
  }
  for (const p of parsed.data.patterns) {
    for (const occ of p.occurrences) checkTimeRange(p.id, occ.startMs, occ.endMs, 'Pattern occurrence')
    if (p.actorId && !actorSet.has(p.actorId)) issues.push({ code: 'unknown_actor', message: `Pattern ${p.id} unknown actor` })
  }

  return { ok: issues.length === 0, issues }
}

