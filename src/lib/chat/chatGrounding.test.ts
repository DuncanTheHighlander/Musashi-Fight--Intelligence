import { describe, expect, it } from 'vitest'
import {
  clipFollowUpsExhausted,
  formatClipFollowUpLabel,
  isChatGroundingReady,
  isPostUploadChatReady,
  shouldAttemptTapeUploadForChat,
} from '@/lib/chat/chatGrounding'

describe('isChatGroundingReady', () => {
  it('is ready when gemini Files URI exists', () => {
    expect(isChatGroundingReady({ geminiFileUri: 'files/abc' })).toBe(true)
  })

  it('is ready when normalizedAssetId exists (inline path, no Files URI)', () => {
    expect(
      isChatGroundingReady({
        geminiFileUri: null,
        normalizedAssetId: 'asset_123',
        visionEvidence: null,
        visionFirstEnabled: true,
      }),
    ).toBe(true)
  })

  it('is ready when vision-first evidence exists without Files URI', () => {
    expect(
      isChatGroundingReady({
        geminiFileUri: null,
        normalizedAssetId: null,
        visionEvidence: { people: [] },
        visionFirstEnabled: true,
      }),
    ).toBe(true)
  })

  it('is not ready when vision evidence exists but vision-first flag is off and no tape ids', () => {
    expect(
      isChatGroundingReady({
        geminiFileUri: null,
        normalizedAssetId: null,
        visionEvidence: { people: [] },
        visionFirstEnabled: false,
      }),
    ).toBe(false)
  })

  it('is not ready when all grounding sources are absent', () => {
    expect(
      isChatGroundingReady({
        geminiFileUri: null,
        normalizedAssetId: null,
        visionEvidence: null,
        visionFirstEnabled: true,
      }),
    ).toBe(false)
  })

  it('treats blank strings as absent', () => {
    expect(
      isChatGroundingReady({
        geminiFileUri: '   ',
        normalizedAssetId: '',
        visionEvidence: null,
        visionFirstEnabled: true,
      }),
    ).toBe(false)
  })

  it('vision-first + VisionEvidence + normalizedAssetId does not need upload (pose off ok)', () => {
    const ready = isChatGroundingReady({
      geminiFileUri: null,
      normalizedAssetId: 'norm_1',
      visionEvidence: { seen: [], heard: [], inferred: [], uncertain: [] },
      visionFirstEnabled: true,
    })
    expect(ready).toBe(true)
    expect(
      shouldAttemptTapeUploadForChat({
        videoLoaded: true,
        groundingReady: ready,
        hasVideoFile: true,
        uploading: false,
      }),
    ).toBe(false)
  })
})

describe('shouldAttemptTapeUploadForChat', () => {
  it('only uploads when video loaded, not ready, file present, and idle', () => {
    expect(
      shouldAttemptTapeUploadForChat({
        videoLoaded: true,
        groundingReady: false,
        hasVideoFile: true,
        uploading: false,
      }),
    ).toBe(true)
  })

  it('does not upload when grounding is already ready', () => {
    expect(
      shouldAttemptTapeUploadForChat({
        videoLoaded: true,
        groundingReady: true,
        hasVideoFile: true,
        uploading: false,
      }),
    ).toBe(false)
  })

  it('does not upload while another upload is running', () => {
    expect(
      shouldAttemptTapeUploadForChat({
        videoLoaded: true,
        groundingReady: false,
        hasVideoFile: true,
        uploading: true,
      }),
    ).toBe(false)
  })
})

describe('isPostUploadChatReady', () => {
  it('accepts normalizedAssetId or VisionEvidence without geminiFileUri', () => {
    expect(
      isPostUploadChatReady({
        tapeUri: null,
        geminiFileUri: null,
        normalizedAssetId: 'a1',
        visionEvidence: null,
      }),
    ).toBe(true)
    expect(
      isPostUploadChatReady({
        tapeUri: null,
        geminiFileUri: null,
        normalizedAssetId: null,
        visionEvidence: { people: [] },
      }),
    ).toBe(true)
  })
})

describe('formatClipFollowUpLabel', () => {
  it('shows next follow-up number before each successful answer', () => {
    expect(formatClipFollowUpLabel({ used: 0, limit: 3, remaining: 3 })).toBe('Follow-up 1 of 3')
    expect(formatClipFollowUpLabel({ used: 1, limit: 3, remaining: 2 })).toBe('Follow-up 2 of 3')
    expect(formatClipFollowUpLabel({ used: 2, limit: 3, remaining: 1 })).toBe('Follow-up 3 of 3')
  })

  it('shows exhausted copy after the third successful answer', () => {
    expect(formatClipFollowUpLabel({ used: 3, limit: 3, remaining: 0 })).toBe('3 of 3 follow-ups used')
    expect(clipFollowUpsExhausted({ used: 3, limit: 3, remaining: 0 })).toBe(true)
    expect(clipFollowUpsExhausted({ used: 2, limit: 3, remaining: 1 })).toBe(false)
  })
})
