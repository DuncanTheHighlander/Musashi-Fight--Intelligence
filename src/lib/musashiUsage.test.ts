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
  extractFightVideoQuotaContext,
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

describe('extractFightVideoQuotaContext', () => {
  it('uses analysis-window length when start/end offsets are present', () => {
    const ctx = extractFightVideoQuotaContext(
      'analyze_video_stream',
      {
        clipDuration: 19,
        startSec: 2,
        endSec: 12,
        videoFileUri: 'files/abc',
      },
      null,
    )
    expect(ctx).toEqual({ clipDurationSec: 10, clipKey: 'files/abc' })
  })

  it('falls back to clipDuration when offsets are missing', () => {
    const ctx = extractFightVideoQuotaContext(
      'chat',
      {
        context: {
          nativeVideo: true,
          videoFileUri: 'files/xyz',
          clipDuration: 8,
        },
      },
      null,
    )
    expect(ctx).toEqual({ clipDurationSec: 8, clipKey: 'files/xyz' })
  })
})

describe('per-clip question cap', () => {
  it('uses a single per-clip follow-up limit of 3 for every tier', () => {
    expect(FREE_QUESTIONS_PER_CLIP).toBe(3)
    expect(PRO_QUESTIONS_PER_CLIP).toBe(3)
  })

  it('resolves the per-clip ceiling identically for free and pro', () => {
    expect(questionsPerClipForTier(false)).toBe(3)
    expect(questionsPerClipForTier(true)).toBe(3)
  })

  it('extracts the clip key only for clip-grounded chat/strategy questions', () => {
    expect(extractChatClipKey('chat', {})).toBeNull()
    expect(extractChatClipKey('chat', { context: {} })).toBeNull()
    expect(extractChatClipKey('chat', { context: { initialVideoAnalysis: true, videoFileUri: 'files/abc' } })).toBeNull()
    expect(extractChatClipKey('analyze_video_stream', { context: { videoFileUri: 'files/abc' } })).toBeNull()
    expect(extractChatClipKey('chat', { context: { videoFileUri: 'files/abc' } })).toBe('files/abc')
    expect(extractChatClipKey('strategy', { context: { videoFileUri: 'files/xyz' } })).toBe('files/xyz')
    expect(extractChatClipKey('chat', { context: { normalizedAssetId: 'n1' } })).toBe('inline:n1')
    expect(extractChatClipKey('chat', { context: { clipAssetRef: 'r2:x' } })).toBe('r2:x')
  })
})
