/**
 * Formats approved human corrections as a prompt block attached BESIDE
 * retrieval — never inside coach-brain markdown.
 */
import type { AiCorrectionRow } from './store'

export type CorrectedLabels = {
  incorrect_labels?: string[]
  correct_labels?: string[]
  position?: string | null
  transition?: string | null
  controlling_fighter?: string | null
  correction_categories?: string[]
  coaching_note?: string | null
}

function parseLabels(json: string): CorrectedLabels {
  try {
    return JSON.parse(json) as CorrectedLabels
  } catch {
    return {}
  }
}

function fmtWindow(row: AiCorrectionRow): string {
  if (row.wholeClip) return 'whole clip'
  if (row.startMs == null && row.endMs == null) return 'no timestamp'
  const s = ((row.startMs ?? 0) / 1000).toFixed(1)
  const e = ((row.endMs ?? row.startMs ?? 0) / 1000).toFixed(1)
  return `${s}–${e}s`
}

export function formatApprovedCorrectionsBlock(rows: AiCorrectionRow[]): string {
  if (!rows.length) return ''

  const lines = rows.map((row, i) => {
    const labels = parseLabels(row.correctedLabelsJson)
    const incorrect = (labels.incorrect_labels ?? []).join(', ') || '(unspecified)'
    const correct = (labels.correct_labels ?? []).join(', ') || row.correctionText
    const fighter = labels.controlling_fighter ? `, ${labels.controlling_fighter}` : ''
    const note = labels.coaching_note || row.coachingNote
    return [
      `${i + 1}. Window: ${fmtWindow(row)}${fighter}`,
      `   Override: ${incorrect} → ${correct}`,
      `   Original claim: ${row.originalText.slice(0, 240)}`,
      `   Human note: ${row.correctionText.slice(0, 240)}`,
      note ? `   Coaching note: ${String(note).slice(0, 200)}` : null,
      `   id=${row.id}`,
    ]
      .filter(Boolean)
      .join('\n')
  })

  return `
APPROVED HUMAN CORRECTIONS FOR THIS EXACT CLIP (same owner, exact file/fingerprint):
These are adjudicated overrides. Apply them ONLY inside their stated time windows (or whole-clip when marked).
Do NOT generalize them to other moments, other clips, or other sports.
When a correction conflicts with the ledger or vision scan inside its window, prefer the human correction.
Outside the window, ignore the correction entirely.

${lines.join('\n\n')}
`
}

/** Short UI label for before/after reanalyze banner. */
export function formatCorrectionAppliedSummary(rows: AiCorrectionRow[]): string {
  if (!rows.length) return ''
  const first = rows[0]
  const labels = parseLabels(first.correctedLabelsJson)
  const correct = (labels.correct_labels ?? [])[0] || first.correctionText.slice(0, 40)
  const t =
    first.startMs != null
      ? `@ ${(first.startMs / 1000).toFixed(1)}s`
      : first.wholeClip
        ? '@ whole clip'
        : ''
  const more = rows.length > 1 ? ` (+${rows.length - 1} more)` : ''
  return `Correction applied: ${correct} ${t}${more}`.trim()
}
