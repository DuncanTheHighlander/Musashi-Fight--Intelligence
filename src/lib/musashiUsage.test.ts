import { describe, expect, it } from 'vitest'
import {
  FREE_LIFETIME_VIDEOS,
  FREE_MAX_VIDEO_SEC,
  PRO_MAX_VIDEO_SEC,
  PRO_WEEKLY_VIDEOS,
  FREE_QUESTIONS_PER_CLIP,
  PRO_QUESTIONS_PER_CLIP,
  fightActionConsumesVideoQuota,
  fightActionToQuotaBucket,
  questionsPerClipForTier,
  extractChatClipKey,
} from '@/lib/musashiUsage'

describe('musashiUsage video tier defaults', () => {
  it('uses product-specified free and pro limits', () => {
    expect(FREE_MAX_VIDEO_SEC).toBe(10)
    expect(PRO_MAX_VIDEO_SEC).toBe(30)
    expect(FREE_LIFETIME_VIDEOS).toBe(3)
    expect(PRO_WEEKLY_VIDEOS).toBe(10)
  })
})

describe('fightActionToQuotaBucket', () => {
  it('maps video-heavy actions to analyze bucket', () => {
    expect(fightActionToQuotaBucket('upload_video')).toBe('analyze')
    expect(fightActionToQuotaBucket('analyze_video_stream')).toBe('analyze')
    expect(fightActionToQuotaBucket('strategy')).toBe('analyze')
  })

  it('maps interactive actions to correct buckets', () => {
    expect(fightActionToQuotaBucket('chat')).toBe('chat')
    expect(fightActionToQuotaBucket('reflex')).toBe('reflex')
    expect(fightActionToQuotaBucket('track')).toBe('track')
  })
})

describe('fightActionConsumesVideoQuota', () => {
  it('charges native video chat/strategy but not plain chat', () => {
    expect(fightActionConsumesVideoQuota('chat', {})).toBe(false)
    expect(
      fightActionConsumesVideoQuota('chat', {
        context: { nativeVideo: true, videoFileUri: 'files/abc', clipDuration: 8 },
      })
    ).toBe(true)
  })

  it('charges streaming and frame analyze actions', () => {
    expect(fightActionConsumesVideoQuota('analyze_video_stream', {})).toBe(true)
    expect(fightActionConsumesVideoQuota('analyze_frames', {})).toBe(true)
  })
})

describe('per-clip question cap', () => {
  it('uses product-specified per-clip question limits', () => {
    expect(FREE_QUESTIONS_PER_CLIP).toBe(3)
    expect(PRO_QUESTIONS_PER_CLIP).toBe(15)
  })

  it('resolves the per-clip ceiling by tier', () => {
    expect(questionsPerClipForTier(false)).toBe(FREE_QUESTIONS_PER_CLIP)
    expect(questionsPerClipForTier(true)).toBe(PRO_QUESTIONS_PER_CLIP)
  })

  it('extracts the clip key only for clip-grounded chat/strategy questions', () => {
    expect(extractChatClipKey('chat', {})).toBeNull()
    expect(extractChatClipKey('chat', { context: {} })).toBeNull()
    expect(extractChatClipKey('chat', { context: { initialVideoAnalysis: true, videoFileUri: 'files/abc' } })).toBeNull()
    expect(extractChatClipKey('analyze_video_stream', { context: { videoFileUri: 'files/abc' } })).toBeNull()
    expect(extractChatClipKey('chat', { context: { videoFileUri: 'files/abc' } })).toBe('files/abc')
    expect(extractChatClipKey('strategy', { context: { videoFileUri: 'files/xyz' } })).toBe('files/xyz')
  })
})
