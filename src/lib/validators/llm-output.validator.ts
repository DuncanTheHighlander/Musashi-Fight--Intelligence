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
 * Fake-precision guard: exact physical measurements (force, velocity,
 * distances in cm, mass) may only appear in coaching text when the pipeline
 * actually measured something (ledger.kinematics non-empty). Otherwise the
 * number was invented by the model — soften it to qualitative language.
 *
 * Degrees are deliberately NOT matched: "pivot 45 degrees" is an instruction,
 * not a measurement claim, and appears legitimately in coaching output.
 */
const UNSUPPORTED_MEASUREMENT_RE =
  /\b\d+(?:\.\d+)?\s?(?:kn\b|newtons?\b|n of force|m\/s\b|meters? per second|km\/h\b|mph\b|cm\b|centimeters?\b|kg\b|kilograms?\b)/gi

function softenUnsupportedPrecision(text: string): { text: string; softened: boolean } {
  let softened = false
  const out = text.replace(UNSUPPORTED_MEASUREMENT_RE, (match) => {
    softened = true
    const unit = match.toLowerCase()
    if (/kn|newton|force/.test(unit)) return 'significant force'
    if (/m\/s|per second|km\/h|mph/.test(unit)) return 'high speed'
    if (/cm|centimeter/.test(unit)) return 'a clear margin'
    return 'a significant amount'
  })
  return { text: out, softened }
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

  // Fake-precision softening: when the pipeline measured nothing
  // (ledger.kinematics empty), exact force/velocity/cm/mass claims in the
  // coaching text are hallucinated — soften them to qualitative language.
  let sanitized: CoachingPayload = payload
  if ((ledger.kinematics?.length ?? 0) === 0) {
    let anySoftened = false
    const soften = (text: string | undefined, path: string): string | undefined => {
      if (!text) return text
      const res = softenUnsupportedPrecision(text)
      if (res.softened) {
        anySoftened = true
        issues.push({
          code: 'unsupported_numeric_precision',
          message: `Softened exact measurement claim not backed by measured kinematics`,
          path,
        })
      }
      return res.text
    }

    const quickCues = payload.quickCues.map((cue, i) => ({
      ...cue,
      quickCue: soften(cue.quickCue, `quickCues.${i}.quickCue`) ?? cue.quickCue,
      keyMistake: soften(cue.keyMistake, `quickCues.${i}.keyMistake`),
      whyItMatters: soften(cue.whyItMatters, `quickCues.${i}.whyItMatters`),
      whatToDoInstead: soften(cue.whatToDoInstead, `quickCues.${i}.whatToDoInstead`),
      expanded: soften(cue.expanded, `quickCues.${i}.expanded`),
    }))
    const suggestedCorrections = payload.suggestedCorrections.map((corr, i) => ({
      ...corr,
      why: soften(corr.why, `suggestedCorrections.${i}.why`) ?? corr.why,
      doInstead: soften(corr.doInstead, `suggestedCorrections.${i}.doInstead`) ?? corr.doInstead,
    }))
    const mainDiagnosis = soften(payload.mainDiagnosis, 'mainDiagnosis') ?? payload.mainDiagnosis

    if (anySoftened) {
      sanitized = { ...payload, quickCues, suggestedCorrections, mainDiagnosis }
    }
  }

  return { ok: issues.length === 0, issues, sanitized }
}

