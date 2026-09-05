import { describe, expect, it } from 'vitest'
import {
  QUESTIONS_PER_CLIP,
  FREE_QUESTIONS_PER_CLIP,
  PRO_QUESTIONS_PER_CLIP,
  questionsPerClipForTier,
  extractChatClipKey,
} from '@/lib/musashiUsage'
describe('per-clip follow-up quota — exactly 3 for every role', () => {
  it('exports a single ceiling of 3', () => {
    expect(QUESTIONS_PER_CLIP).toBe(3)
    expect(FREE_QUESTIONS_PER_CLIP).toBe(3)
    expect(PRO_QUESTIONS_PER_CLIP).toBe(3)
  })

  it('resolves 3 for free and pro aliases', () => {
    expect(questionsPerClipForTier(false)).toBe(3)
    expect(questionsPerClipForTier(true)).toBe(3)
  })

  it('applies the same limit to free, pro, standard paid, shogun, and admin', () => {
    // Product rule: questionsPerClipForTier / QUESTIONS_PER_CLIP ignore role.
    // Free, Pro, standard paid, Shogun, and admin all receive exactly 3.
    for (const isPro of [false, true]) {
      expect(questionsPerClipForTier(isPro)).toBe(3)
    }
    expect(QUESTIONS_PER_CLIP).toBe(3)
  })

  it('does not meter initial Coach Card / initialVideoAnalysis requests', () => {
    expect(
      extractChatClipKey('chat', {
        context: { initialVideoAnalysis: true, videoFileUri: 'files/abc', normalizedAssetId: 'n1' },
      }),
    ).toBeNull()
  })

  it('meters typed/voice/suggested follow-ups via the same clip key', () => {
    expect(extractChatClipKey('chat', { context: { videoFileUri: 'files/abc' } })).toBe('files/abc')
    expect(extractChatClipKey('chat', { context: { normalizedAssetId: 'asset_1' } })).toBe('inline:asset_1')
    expect(extractChatClipKey('chat', { context: { clipAssetRef: 'r2:bucket/key' } })).toBe('r2:bucket/key')
    expect(extractChatClipKey('strategy', { context: { normalizedAssetId: 'asset_2' } })).toBe('inline:asset_2')
  })

  it('does not meter non-chat actions (Teach / analyze stay outside this counter)', () => {
    expect(extractChatClipKey('analyze_video_stream', { context: { videoFileUri: 'files/abc' } })).toBeNull()
    expect(extractChatClipKey('upload_video', { context: { videoFileUri: 'files/abc' } })).toBeNull()
  })
})
