import type {
  ActorId,
  CoachingCue,
  FightEvidenceLedger,
  OverlayAnnotation,
  RangeBand,
  StanceSide,
} from '@/lib/fightlang/fightlang.types'

export type CoachingPayload = Readonly<{
  quickCues: CoachingCue[]
  mainDiagnosis: string
  styleNotes: string[]
  suggestedCorrections: Array<{
    actorId?: ActorId
    title: string
    why: string
    doInstead: string
    evidenceIds?: string[]
  }>
  overlayAnnotations: OverlayAnnotation[]
  audioScript?: string
}>

export type LlmValidationIssue = Readonly<{
  code: string
  message: string
  path?: string
}>

export type LlmValidationResult = Readonly<{
  ok: boolean
  issues: LlmValidationIssue[]
  sanitized?: CoachingPayload
}>

function latestActorState(ledger: FightEvidenceLedger, actorId: ActorId) {
  for (let i = ledger.actorStateTimeline.length - 1; i >= 0; i--) {
    const s = ledger.actorStateTimeline[i]
    if (s?.actorId === actorId) return s
  }
  return null
}

function evidenceIdsSet(ledger: FightEvidenceLedger): Set<string> {
  return new Set(ledger.evidenceIndex.map((e) => e.id))
}

/**
 * v1 validator: prevents direct contradictions against the deterministic ledger.
 * We cannot fully prove semantics; we enforce:
 * - evidence ids referenced must exist
 * - stance/range claims (if provided via structured fields) must match ledger state
 * - if ledger has high-severity faults, forbid "praise" cues that claim the opposite (light heuristic)
 */
export function validateCoachingPayloadAgainstLedger(input: {
  ledger: FightEvidenceLedger
  payload: CoachingPayload
}): LlmValidationResult {
  const { ledger, payload } = input
  const issues: LlmValidationIssue[] = []

  const evIds = evidenceIdsSet(ledger)

  // Validate evidence ids referenced.
  for (const [i, corr] of payload.suggestedCorrections.entries()) {
    if (!corr.evidenceIds) continue
    for (const id of corr.evidenceIds) {
      if (!evIds.has(id)) {
        issues.push({
          code: 'unknown_evidence_id',
          message: `suggestedCorrections[${i}] references unknown evidence id ${id}`,
          path: `suggestedCorrections.${i}.evidenceIds`,
        })
      }
    }
  }
  for (const [i, cue] of payload.quickCues.entries()) {
    for (const ev of cue.evidence) {
      if (!evIds.has(ev.id)) {
        issues.push({
          code: 'unknown_evidence_id',
          message: `quickCues[${i}] contains evidence id not in ledger: ${ev.id}`,
          path: `quickCues.${i}.evidence`,
        })
      }
    }
  }

  // Soft contradiction checks: if cue explicitly asserts stance/range in text, we can't parse reliably.
  // Instead, enforce consistency via optional structured convention if present in payload metadata later.
  // TODO: extend CoachingPayload to allow explicit stance/range claims for strict validation.

  // Heuristic: if ledger has any high-severity fault for an actor, disallow cues that contain "great balance"
  // or "excellent balance" (example guardrails).
  const hasHighFault = (actorId: ActorId) => ledger.faults.some((f) => f.actorId === actorId && f.severity === 'high')
  const badPraisePhrases = ['great balance', 'excellent balance', 'perfect balance']
  for (const [i, cue] of payload.quickCues.entries()) {
    const text = `${cue.quickCue} ${cue.expanded ?? ''}`.toLowerCase()
    if (!cue.actorId) continue
    if (hasHighFault(cue.actorId) && badPraisePhrases.some((p) => text.includes(p))) {
      issues.push({
        code: 'contradiction_praise_vs_fault',
        message: `Cue claims balance praise but ledger has high-severity fault for actor ${cue.actorId}`,
        path: `quickCues.${i}`,
      })
    }
  }

  return { ok: issues.length === 0, issues, sanitized: payload }
}

