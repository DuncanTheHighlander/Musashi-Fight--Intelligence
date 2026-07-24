import { describe, expect, it } from 'vitest'
import {
  applyCoachingOverride,
  applyTextOverride,
  buildRetryEmphasisBlock,
  correctionLabelPairs,
  findCoachingConflicts,
  findTextConflicts,
} from '@/lib/aiCorrections/compliance'
import type { AiCorrectionRow } from '@/lib/aiCorrections/store'
import type { CoachingPayload } from '@/lib/validators/llm-output.validator'

function row(overrides?: Partial<AiCorrectionRow>): AiCorrectionRow {
  return {
    id: 'aic_test1',
    ownerUserId: 'u1',
    clipId: 'asset1',
    videoFingerprint: null,
    ledgerId: null,
    responseType: 'coach_card',
    responseRef: null,
    cardSection: null,
    sport: 'bjj_grappling',
    focusTarget: 'A',
    startMs: null,
    endMs: null,
    wholeClip: true,
    originalText: 'Fighter A locks in an armbar',
    correctionText: 'That is a wrist ride, not an armbar',
    correctedLabelsJson: JSON.stringify({
      incorrect_labels: ['armbar'],
      correct_labels: ['wrist ride'],
    }),
    correctionCategoriesJson: null,
    coachingNote: null,
    status: 'approved',
    modelName: null,
    scope: null,
    createdAt: '2026-07-23',
    updatedAt: '2026-07-23',
    ...overrides,
  }
}

function coaching(mainDiagnosis: string): CoachingPayload {
  return {
    quickCues: [
      {
        id: 'q1',
        actorId: 'A',
        quickCue: 'Control the wrist before anything else',
        evidence: [],
      } as unknown as CoachingPayload['quickCues'][number],
    ],
    mainDiagnosis,
    styleNotes: [],
    suggestedCorrections: [
      { actorId: 'A', title: 'Finish the Armbar cleanly', why: 'x', doInstead: 'y' },
    ],
    overlayAnnotations: [],
  }
}

describe('teach compliance', () => {
  it('finds rejected labels across coaching fields (case-insensitive, word-boundary)', () => {
    const conflicts = findCoachingConflicts(coaching('A hunts the ARMBAR from guard.'), [row()])
    expect(conflicts.length).toBe(2) // mainDiagnosis + suggestedCorrections title
    expect(conflicts.map((c) => c.where)).toEqual(
      expect.arrayContaining(['mainDiagnosis', 'suggestedCorrections.0.title']),
    )
    expect(conflicts[0].correctLabel).toBe('wrist ride')
  })

  it('does not false-positive on substrings or compliant output', () => {
    const clean = coaching('A controls with a wrist ride.')
    clean.suggestedCorrections[0].title = 'Stabilize before attacking'
    expect(findCoachingConflicts(clean, [row()])).toEqual([])
    // "armbarred" should not match "armbar" thanks to the boundary guard.
    expect(findTextConflicts('he got armbarred once in 2019', [row()])).toEqual([])
  })

  it('skips labels that the human also approved (no self-conflict)', () => {
    const r = row({
      correctedLabelsJson: JSON.stringify({
        incorrect_labels: ['armbar'],
        correct_labels: ['armbar from mount'],
      }),
    })
    // 'armbar' != 'armbar from mount' → still enforced
    expect(correctionLabelPairs([r]).length).toBe(1)
    const same = row({
      correctedLabelsJson: JSON.stringify({ incorrect_labels: ['armbar'], correct_labels: ['armbar'] }),
    })
    expect(correctionLabelPairs([same])).toEqual([])
  })

  it('override rewrites only the offending labels and reports counts', () => {
    const bad = coaching('A hunts the armbar; the armbar attempt fails.')
    const conflicts = findCoachingConflicts(bad, [row()])
    const { payload, overridesApplied } = applyCoachingOverride(bad, conflicts)
    expect(payload.mainDiagnosis).toBe('A hunts the wrist ride; the wrist ride attempt fails.')
    expect(payload.suggestedCorrections[0].title).toBe('Finish the wrist ride cleanly')
    expect(overridesApplied).toBeGreaterThan(0)
    expect(findCoachingConflicts(payload, [row()])).toEqual([])
  })

  it('text override works for chat replies and multi-word labels', () => {
    const r = row({
      correctedLabelsJson: JSON.stringify({
        incorrect_labels: ['rear naked choke'],
        correct_labels: ['bulldog choke'],
      }),
    })
    const chat = 'He finishes with a rear_naked choke at 0:12.'
    const conflicts = findTextConflicts(chat, [r])
    expect(conflicts.length).toBe(1)
    const { text } = applyTextOverride(chat, conflicts)
    expect(text).toBe('He finishes with a bulldog choke at 0:12.')
  })

  it('retry block names each violation with the required replacement', () => {
    const block = buildRetryEmphasisBlock(
      findCoachingConflicts(coaching('armbar attempt'), [row()]),
    )
    expect(block).toContain('COMPLIANCE FAILURE')
    expect(block).toContain('"armbar"')
    expect(block).toContain('"wrist ride"')
  })
})
