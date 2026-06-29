import { describe, expect, it } from 'vitest'
import {
  FREE_LIFETIME_VIDEOS,
  FREE_MAX_VIDEO_SEC,
  PRO_MAX_VIDEO_SEC,
  PRO_WEEKLY_VIDEOS,
  fightActionConsumesVideoQuota,
  fightActionToQuotaBucket,
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
