import { describe, expect, it } from 'vitest'
import {
  buildGeminiVideoFileData,
  buildGeminiVideoFilePart,
  clipWindowDurationSec,
  normalizeClipWindow,
  resolveQuotaDurationSec,
  MAX_ORIGINAL_UPLOAD_BYTES,
} from '@/lib/gemini/videoFilePart'

describe('videoFilePart', () => {
  it('builds videoMetadata offsets for a valid window', () => {
    const part = buildGeminiVideoFilePart('files/abc', 'video/mp4', { startSec: 2.5, endSec: 12.5 })
    expect(part.fileData).toEqual({ fileUri: 'files/abc', mimeType: 'video/mp4' })
    expect(part.videoMetadata).toEqual({
      startOffset: '2.5s',
      endOffset: '12.5s',
    })
  })

  it('omits videoMetadata when window is invalid', () => {
    const data = buildGeminiVideoFileData('files/abc', 'video/webm')
    const part = buildGeminiVideoFilePart('files/abc', 'video/webm', { startSec: 5, endSec: 5 })
    expect(data).toEqual({ fileUri: 'files/abc', mimeType: 'video/webm' })
    expect(part.videoMetadata).toBeUndefined()
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
