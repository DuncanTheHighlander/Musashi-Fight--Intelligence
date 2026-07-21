import { describe, expect, it } from 'vitest'
import { formatApprovedCorrectionsBlock, formatCorrectionAppliedSummary } from './formatBlock'
import type { AiCorrectionRow } from './store'

const base = (over: Partial<AiCorrectionRow> = {}): AiCorrectionRow => ({
  id: 'aic_1',
  ownerUserId: 'u1',
  clipId: 'asset_1',
  videoFingerprint: 'fp',
  ledgerId: 'ledg_1',
  responseType: 'coach_card',
  responseRef: 'fix_0',
  cardSection: 'fix',
  sport: 'bjj_grappling',
  focusTarget: 'A',
  startMs: 4000,
  endMs: 6500,
  wholeClip: false,
  originalText: 'front headlock',
  correctionText: 'wrist ride',
  correctedLabelsJson: JSON.stringify({
    incorrect_labels: ['front_headlock'],
    correct_labels: ['wrist_ride'],
  }),
  correctionCategoriesJson: '["wrong_technique"]',
  coachingNote: null,
  status: 'approved',
  modelName: 'gemini-2.5-flash',
  scope: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  ...over,
})

describe('formatApprovedCorrectionsBlock', () => {
  it('formats override-only-within-window block', () => {
    const block = formatApprovedCorrectionsBlock([base()])
    expect(block).toContain('APPROVED HUMAN CORRECTIONS FOR THIS EXACT CLIP')
    expect(block).toContain('front_headlock → wrist_ride')
    expect(block).toContain('4.0–6.5s')
  })

  it('returns empty string for no rows', () => {
    expect(formatApprovedCorrectionsBlock([])).toBe('')
  })
})

describe('formatCorrectionAppliedSummary', () => {
  it('summarizes first correction', () => {
    expect(formatCorrectionAppliedSummary([base()])).toContain('wrist_ride')
    expect(formatCorrectionAppliedSummary([base()])).toContain('@ 4.0s')
  })
})
