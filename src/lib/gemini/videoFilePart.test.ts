import { afterEach, describe, expect, it } from 'vitest'

import {
  buildGeminiVideoFileData,
  buildGeminiVideoFilePart,
  buildGeminiVideoInlinePart,
  buildGeminiVideoMetadata,
  clampGeminiFps,
  clipWindowDurationSec,
  geminiConfiguredVideoFps,
  geminiVideoFpsForSport,
  isInlineVideoEligible,
  normalizeClipWindow,
  resolveQuotaDurationSec,
  GEMINI_FPS_DEFAULT,
  GEMINI_FPS_MAX,
  MAX_INLINE_VIDEO_BYTES,
  MAX_ORIGINAL_UPLOAD_BYTES,
} from '@/lib/gemini/videoFilePart'

afterEach(() => {
  delete process.env.MUSASHI_GEMINI_VIDEO_FPS
})

describe('videoFilePart', () => {
  it('builds videoMetadata offsets + fps and never attaches per-part mediaResolution', () => {
    const part = buildGeminiVideoFilePart('files/abc', 'video/mp4', { startSec: 2.5, endSec: 12.5 })
    expect(part.fileData).toEqual({ fileUri: 'files/abc', mimeType: 'video/mp4' })
    expect(part.videoMetadata).toEqual({
      fps: GEMINI_FPS_DEFAULT,
      startOffset: '2.5s',
      endOffset: '12.5s',
    })
    expect(part).not.toHaveProperty('mediaResolution')
  })

  it('samples every sport at the configured evidence fps (default 24)', () => {
    expect(GEMINI_FPS_DEFAULT).toBe(24)
    for (const sport of ['bjj', 'wrestling', 'judo', 'boxing', 'mma', undefined]) {
      expect(geminiVideoFpsForSport(sport)).toBe(GEMINI_FPS_DEFAULT)
    }
    const part = buildGeminiVideoFilePart('files/bjj', 'video/mp4', {
      window: { startSec: 0, endSec: 10 },
      sport: 'bjj',
    })
    expect(part.videoMetadata?.fps).toBe(GEMINI_FPS_DEFAULT)
    expect(part).not.toHaveProperty('mediaResolution')
  })

  it('honors MUSASHI_GEMINI_VIDEO_FPS and clamps to the API max of 24', () => {
    process.env.MUSASHI_GEMINI_VIDEO_FPS = '12'
    expect(geminiConfiguredVideoFps()).toBe(12)
    expect(geminiVideoFpsForSport('boxing')).toBe(12)
    expect(buildGeminiVideoMetadata()?.fps).toBe(12)

    process.env.MUSASHI_GEMINI_VIDEO_FPS = '25'
    expect(geminiConfiguredVideoFps()).toBe(GEMINI_FPS_MAX)

    process.env.MUSASHI_GEMINI_VIDEO_FPS = 'garbage'
    expect(geminiConfiguredVideoFps()).toBe(GEMINI_FPS_DEFAULT)

    expect(clampGeminiFps(30)).toBe(24)
    expect(clampGeminiFps(0)).toBe(GEMINI_FPS_DEFAULT)
    expect(clampGeminiFps(12)).toBe(12)
  })

  it('still attaches fps when window is invalid', () => {
    const data = buildGeminiVideoFileData('files/abc', 'video/webm')
    const part = buildGeminiVideoFilePart('files/abc', 'video/webm', { startSec: 5, endSec: 5 })
    expect(data).toEqual({ fileUri: 'files/abc', mimeType: 'video/webm' })
    expect(part.videoMetadata).toEqual({ fps: GEMINI_FPS_DEFAULT })
    expect(part).not.toHaveProperty('mediaResolution')
  })

  it('builds inlineData parts for the <20MB fast path with explicit fps override', () => {
    const part = buildGeminiVideoInlinePart('YmFzZTY0', 'video/mp4', {
      sport: 'bjj',
      window: { startSec: 0, endSec: 8 },
      fps: 12,
    })
    expect(part.inlineData).toEqual({ mimeType: 'video/mp4', data: 'YmFzZTY0' })
    expect(part.videoMetadata).toEqual({
      fps: 12,
      startOffset: '0s',
      endOffset: '8s',
    })
    expect(part).not.toHaveProperty('mediaResolution')
    expect(buildGeminiVideoMetadata({ fps: 10 })?.fps).toBe(10)
    // Explicit overrides above the API max are clamped, not passed through.
    expect(buildGeminiVideoMetadata({ fps: 60 })?.fps).toBe(GEMINI_FPS_MAX)
  })

  it('gates inline eligibility at 20MB', () => {
    expect(isInlineVideoEligible(1)).toBe(true)
    expect(isInlineVideoEligible(MAX_INLINE_VIDEO_BYTES - 1)).toBe(true)
    expect(isInlineVideoEligible(MAX_INLINE_VIDEO_BYTES)).toBe(false)
    expect(isInlineVideoEligible(0)).toBe(false)
  })

  it('normalizes and measures window length for quota', () => {
    expect(normalizeClipWindow(1, 11)).toEqual({ startSec: 1, endSec: 11 })
    expect(clipWindowDurationSec(1, 11, 99)).toBe(10)
    expect(clipWindowDurationSec(null, null, 19)).toBe(19)
  })

  it('prefers analysis-window length over full-file clipDurationSec for quota', () => {
    expect(
      resolveQuotaDurationSec({ clipDurationSec: 19, startSec: 0, endSec: 10 }),
    ).toBe(10)
    expect(resolveQuotaDurationSec({ clipDurationSec: 19, startSec: 0, endSec: 0 })).toBe(19)
    expect(resolveQuotaDurationSec({ startSec: 5, endSec: 15 })).toBe(10)
  })

  it('exposes the 500MB hard upload cap (phone 4K-friendly)', () => {
    expect(MAX_ORIGINAL_UPLOAD_BYTES).toBe(500 * 1024 * 1024)
  })
})
