import { describe, expect, it } from 'vitest'
import { extractChatClipKey, QUESTIONS_PER_CLIP } from '@/lib/musashiUsage'

/**
 * TEACH / Coach Cards must never consume the per-clip follow-up budget.
 * Follow-up answers still need stable message IDs + TEACH in the UI
 * (covered by FightCoachExperience chatMsg + TeachCorrectionPanel wiring).
 */
describe('TEACH regression — follow-up quota boundaries', () => {
  it('does not meter initial Coach Card analysis as a follow-up', () => {
    expect(
      extractChatClipKey('chat', {
        context: {
          initialVideoAnalysis: true,
          visionEvidence: { people: [] },
          normalizedAssetId: 'asset_teach',
        },
      }),
    ).toBeNull()
  })

  it('meters normal follow-up chat that TEACH can later target', () => {
    expect(
      extractChatClipKey('chat', {
        context: {
          visionEvidence: { people: [] },
          normalizedAssetId: 'asset_teach',
        },
      }),
    ).toBe('inline:asset_teach')
  })

  it('keeps the follow-up ceiling at 3 so TEACH remains usable after exhaustion', () => {
    // After used === limit, chat is blocked client/server-side, but TEACH
    // buttons do not call extractChatClipKey / sendChat.
    expect(QUESTIONS_PER_CLIP).toBe(3)
  })
})
