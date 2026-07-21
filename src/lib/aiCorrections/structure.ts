import { generateJson } from '@/lib/gemini/gemini-client'
import { resolvedModels } from '@/lib/gemini/models'
import { normalizeLabel, sportVocabulary } from './vocab'

export type StructureResult = {
  incorrect_labels: Array<{ value: string; unlisted?: boolean }>
  correct_labels: Array<{ value: string; unlisted?: boolean }>
  position: string | null
  transition: string | null
  controlling_fighter: 'A' | 'B' | 'Blue' | 'Red' | null
  correction_categories: string[]
  coaching_note: string | null
  needs_clarification: boolean
  clarification_question?: string | null
  modelName: string
}

type RawStructure = {
  incorrect_labels?: string[]
  correct_labels?: string[]
  position?: string | null
  transition?: string | null
  controlling_fighter?: string | null
  correction_categories?: string[]
  coaching_note?: string | null
  needs_clarification?: boolean
  clarification_question?: string | null
}

export async function structureCorrectionWithFlash(args: {
  sport: string
  originalText: string
  correctionText: string
  cardSection?: string | null
  responseType: 'coach_card' | 'chat'
}): Promise<StructureResult> {
  const vocab = sportVocabulary(args.sport).slice(0, 80)
  const prompt = `You structure a human coach correction for Musashi fight analysis into strict JSON.

Sport: ${args.sport}
Surface: ${args.responseType}${args.cardSection ? ` / ${args.cardSection}` : ''}
AI original text:
"""
${args.originalText.slice(0, 1200)}
"""
Human correction:
"""
${args.correctionText.slice(0, 800)}
"""

Preferred vocabulary (use these when possible; otherwise free-text is ok):
${vocab.join(', ')}

Rules:
- Map incorrect vs correct technique/position labels.
- controlling_fighter: A/B or Blue/Red when the human implies who; else null.
- One clarification question MAX. Set needs_clarification=true only if the correction is ambiguous (e.g. unclear which fighter or which moment).
- coaching_note: short optional tactical note from the human text.
- correction_categories from: wrong_technique, wrong_fighter, wrong_timestamp, missed_action, bad_advice, other.

Return JSON only with keys:
incorrect_labels (string[]), correct_labels (string[]), position (string|null), transition (string|null),
controlling_fighter (string|null), correction_categories (string[]), coaching_note (string|null),
needs_clarification (boolean), clarification_question (string|null).`

  const { model, data } = await generateJson<RawStructure>({
    model: resolvedModels.flash(),
    parts: [{ text: prompt }],
    temperature: 0.1,
    maxOutputTokens: 1024,
  })

  const mapLabels = (arr?: string[]) =>
    (Array.isArray(arr) ? arr : [])
      .map((s) => normalizeLabel(String(s), args.sport))
      .filter((l) => l.value && l.value !== 'unknown')
      .slice(0, 6)

  let fighter = data.controlling_fighter ? String(data.controlling_fighter).trim() : null
  if (fighter) {
    const n = fighter.toLowerCase()
    if (n === 'a' || n === 'blue') fighter = n === 'a' ? 'A' : 'Blue'
    else if (n === 'b' || n === 'red') fighter = n === 'b' ? 'B' : 'Red'
    else fighter = null
  }

  return {
    incorrect_labels: mapLabels(data.incorrect_labels),
    correct_labels: mapLabels(data.correct_labels),
    position: data.position ? normalizeLabel(String(data.position), args.sport).value : null,
    transition: data.transition ? String(data.transition).trim() || null : null,
    controlling_fighter: fighter as StructureResult['controlling_fighter'],
    correction_categories: Array.isArray(data.correction_categories)
      ? data.correction_categories.map(String).slice(0, 6)
      : [],
    coaching_note: data.coaching_note ? String(data.coaching_note).trim() || null : null,
    needs_clarification: Boolean(data.needs_clarification),
    clarification_question: data.clarification_question
      ? String(data.clarification_question).trim().slice(0, 200)
      : null,
    modelName: model,
  }
}

export function previewSummary(structured: StructureResult, windowLabel: string): string {
  const incorrect = structured.incorrect_labels.map((l) => l.value).join(', ') || '?'
  const correct = structured.correct_labels.map((l) => l.value).join(', ') || '?'
  const fighter = structured.controlling_fighter ? `, ${structured.controlling_fighter}` : ''
  return `Musashi understood: ${incorrect} → ${correct} @ ${windowLabel}${fighter}`
}
