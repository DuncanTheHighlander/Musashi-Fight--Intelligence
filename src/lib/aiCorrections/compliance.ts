/**
 * Teach Musashi compliance — proof that approved corrections were OBEYED.
 *
 * "Correction applied" may only be claimed when the FINAL output is free of
 * the rejected labels. Enforcement ladder (analyze + chat):
 *   1. Generate with the corrections block in the prompt.
 *   2. Scan the final output for each correction's incorrect_labels.
 *   3. Conflict → retry ONCE with an explicit violation notice.
 *   4. Still conflicting → targeted structured override: rewrite the offending
 *      label to the corrected one in place, and record the override for audit.
 */

import type { AiCorrectionRow } from './store'
import type { CorrectedLabels } from './formatBlock'
import type { CoachingPayload } from '@/lib/validators/llm-output.validator'

export type CorrectionConflict = {
  correctionId: string
  /** The rejected label found in the output. */
  incorrectLabel: string
  /** The replacement the human approved (first correct label / correction text). */
  correctLabel: string
  /** Where it was found (for audit/logs). */
  where: string
}

export type ComplianceStatus = 'no_corrections' | 'clean' | 'retried_clean' | 'overridden' | 'conflict'

export type ComplianceAudit = {
  status: ComplianceStatus
  conflicts: CorrectionConflict[]
  /** Conflicts remaining after the retry (empty when retried_clean). */
  postRetryConflicts?: CorrectionConflict[]
  overridesApplied?: number
}

function parseLabels(json: string): CorrectedLabels {
  try {
    return JSON.parse(json) as CorrectedLabels
  } catch {
    return {}
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Word-boundary, case-insensitive matcher. Labels are normalized vocab like
 * "armbar" / "wrist ride" — underscores match either '_' or space in output.
 */
function labelRegex(label: string): RegExp | null {
  const trimmed = label.trim()
  if (trimmed.length < 3) return null // too short to match safely
  const pattern = escapeRegExp(trimmed).replace(/[_\s]+/g, '[\\s_-]+')
  return new RegExp(`(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])`, 'gi')
}

type LabelPair = { correctionId: string; incorrect: string; correct: string }

/** Expand corrections into (incorrect → correct) pairs worth enforcing. */
export function correctionLabelPairs(rows: AiCorrectionRow[]): LabelPair[] {
  const pairs: LabelPair[] = []
  for (const row of rows) {
    const labels = parseLabels(row.correctedLabelsJson)
    const incorrect = (labels.incorrect_labels ?? []).map((s) => String(s).trim()).filter(Boolean)
    const correct = (labels.correct_labels ?? []).map((s) => String(s).trim()).filter(Boolean)
    const fallbackCorrect = correct[0] || row.correctionText.trim().slice(0, 60)
    const correctSet = new Set(correct.map((c) => c.toLowerCase()))
    for (const bad of incorrect) {
      // A label that the human ALSO approved is not a violation.
      if (correctSet.has(bad.toLowerCase())) continue
      pairs.push({ correctionId: row.id, incorrect: bad, correct: fallbackCorrect })
    }
  }
  return pairs
}

/** Collect every text field of a coaching payload, with a path for audit. */
export function coachingTextFields(payload: CoachingPayload): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = []
  const push = (path: string, text: unknown) => {
    if (typeof text === 'string' && text.trim()) out.push({ path, text })
  }
  push('mainDiagnosis', payload.mainDiagnosis)
  ;(payload.quickCues ?? []).forEach((cue, i) => {
    const c = cue as unknown as Record<string, unknown>
    push(`quickCues.${i}.quickCue`, c.quickCue)
    push(`quickCues.${i}.text`, c.text)
    push(`quickCues.${i}.keyMistake`, c.keyMistake)
    push(`quickCues.${i}.whyItMatters`, c.whyItMatters)
    push(`quickCues.${i}.whatToDoInstead`, c.whatToDoInstead)
    push(`quickCues.${i}.expanded`, c.expanded)
  })
  ;(payload.styleNotes ?? []).forEach((s, i) => push(`styleNotes.${i}`, s))
  ;(payload.suggestedCorrections ?? []).forEach((corr, i) => {
    push(`suggestedCorrections.${i}.title`, corr.title)
    push(`suggestedCorrections.${i}.why`, corr.why)
    push(`suggestedCorrections.${i}.doInstead`, corr.doInstead)
  })
  ;(payload.overlayAnnotations ?? []).forEach((ann, i) =>
    push(`overlayAnnotations.${i}.message`, (ann as unknown as Record<string, unknown>).message),
  )
  push('audioScript', payload.audioScript)
  return out
}

/** Find rejected labels in a coaching payload. Empty array = compliant. */
export function findCoachingConflicts(
  payload: CoachingPayload,
  rows: AiCorrectionRow[],
): CorrectionConflict[] {
  const pairs = correctionLabelPairs(rows)
  if (pairs.length === 0) return []
  const fields = coachingTextFields(payload)
  const conflicts: CorrectionConflict[] = []
  for (const pair of pairs) {
    const re = labelRegex(pair.incorrect)
    if (!re) continue
    for (const field of fields) {
      re.lastIndex = 0
      if (re.test(field.text)) {
        conflicts.push({
          correctionId: pair.correctionId,
          incorrectLabel: pair.incorrect,
          correctLabel: pair.correct,
          where: field.path,
        })
      }
    }
  }
  return conflicts
}

/** Find rejected labels in free chat text. */
export function findTextConflicts(
  text: string,
  rows: AiCorrectionRow[],
): CorrectionConflict[] {
  const pairs = correctionLabelPairs(rows)
  const conflicts: CorrectionConflict[] = []
  for (const pair of pairs) {
    const re = labelRegex(pair.incorrect)
    if (!re) continue
    re.lastIndex = 0
    if (re.test(text)) {
      conflicts.push({
        correctionId: pair.correctionId,
        incorrectLabel: pair.incorrect,
        correctLabel: pair.correct,
        where: 'chat',
      })
    }
  }
  return conflicts
}

/** Prompt block for the single retry: name the violations explicitly. */
export function buildRetryEmphasisBlock(conflicts: CorrectionConflict[]): string {
  const lines = conflicts.map(
    (c) => `- You wrote "${c.incorrectLabel}" (${c.where}) — the approved human correction says it is "${c.correctLabel}". Use "${c.correctLabel}" and never "${c.incorrectLabel}".`,
  )
  return `
COMPLIANCE FAILURE — YOUR PREVIOUS ANSWER VIOLATED APPROVED HUMAN CORRECTIONS.
This is a regeneration. The following labels are adjudicated WRONG for this exact clip and must not appear:
${lines.join('\n')}
Rewrite the coaching accordingly. Everything else stays grounded in the same evidence.`
}

function replaceLabel(text: string, incorrect: string, correct: string): string {
  const re = labelRegex(incorrect)
  if (!re) return text
  return text.replace(re, correct)
}

/**
 * Targeted structured override — last resort after the retry still conflicts.
 * Rewrites only the offending labels in place; never touches other content.
 */
export function applyCoachingOverride(
  payload: CoachingPayload,
  conflicts: CorrectionConflict[],
): { payload: CoachingPayload; overridesApplied: number } {
  let overridesApplied = 0
  const fix = (text: string | undefined): string | undefined => {
    if (!text) return text
    let out = text
    for (const c of conflicts) {
      const before = out
      out = replaceLabel(out, c.incorrectLabel, c.correctLabel)
      if (out !== before) overridesApplied++
    }
    return out
  }

  const fixed: CoachingPayload = {
    ...payload,
    mainDiagnosis: fix(payload.mainDiagnosis) ?? payload.mainDiagnosis,
    styleNotes: (payload.styleNotes ?? []).map((s) => fix(s) ?? s),
    quickCues: (payload.quickCues ?? []).map((cue) => {
      const c = cue as unknown as Record<string, unknown>
      return {
        ...cue,
        ...(typeof c.quickCue === 'string' ? { quickCue: fix(c.quickCue) } : {}),
        ...(typeof c.text === 'string' ? { text: fix(c.text) } : {}),
        ...(typeof c.keyMistake === 'string' ? { keyMistake: fix(c.keyMistake) } : {}),
        ...(typeof c.whyItMatters === 'string' ? { whyItMatters: fix(c.whyItMatters) } : {}),
        ...(typeof c.whatToDoInstead === 'string' ? { whatToDoInstead: fix(c.whatToDoInstead) } : {}),
        ...(typeof c.expanded === 'string' ? { expanded: fix(c.expanded) } : {}),
      } as typeof cue
    }),
    suggestedCorrections: (payload.suggestedCorrections ?? []).map((corr) => ({
      ...corr,
      title: fix(corr.title) ?? corr.title,
      why: fix(corr.why) ?? corr.why,
      doInstead: fix(corr.doInstead) ?? corr.doInstead,
    })),
    overlayAnnotations: (payload.overlayAnnotations ?? []).map((ann) => {
      const a = ann as unknown as Record<string, unknown>
      return typeof a.message === 'string' ? ({ ...ann, message: fix(a.message) } as typeof ann) : ann
    }),
    ...(payload.audioScript ? { audioScript: fix(payload.audioScript) } : {}),
  }
  return { payload: fixed, overridesApplied }
}

/** Text-level override for chat replies. */
export function applyTextOverride(
  text: string,
  conflicts: CorrectionConflict[],
): { text: string; overridesApplied: number } {
  let overridesApplied = 0
  let out = text
  for (const c of conflicts) {
    const before = out
    out = replaceLabel(out, c.incorrectLabel, c.correctLabel)
    if (out !== before) overridesApplied++
  }
  return { text: out, overridesApplied }
}
