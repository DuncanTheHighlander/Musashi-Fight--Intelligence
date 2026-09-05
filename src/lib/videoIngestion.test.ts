import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeVideoOnServer,
  resolveRequestedVideoDurationSec,
  VideoIngestionError,
} from './videoIngestion'

const originalEndpoint = process.env.MUSASHI_VIDEO_NORMALIZER_URL
const originalToken = process.env.MUSASHI_POSE_CLOUD_TOKEN

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

afterEach(() => {
  vi.unstubAllGlobals()
  restoreEnv('MUSASHI_VIDEO_NORMALIZER_URL', originalEndpoint)
  restoreEnv('MUSASHI_POSE_CLOUD_TOKEN', originalToken)
})

describe('normalizeVideoOnServer', () => {
  it('preserves a shorter requested duration under the authenticated tier cap', () => {
    expect(resolveRequestedVideoDurationSec(5, 10)).toBe(5)
    expect(resolveRequestedVideoDurationSec('7.5', 10)).toBe(7.5)
  })

  it('caps requested duration at the authenticated tier maximum', () => {
    expect(resolveRequestedVideoDurationSec(30, 10)).toBe(10)
    expect(resolveRequestedVideoDurationSec(undefined, 10)).toBe(10)
  })

  it('rejects invalid explicit requested durations', () => {
    expect(() => resolveRequestedVideoDurationSec(0, 10)).toThrow('Video analysis was rejected')
    expect(() => resolveRequestedVideoDurationSec('not-a-duration', 10)).toThrow(
      'Video analysis was rejected',
    )
  })

  it('streams the R2 object to Modal and requires verified output metadata', async () => {
    process.env.MUSASHI_VIDEO_NORMALIZER_URL = 'https://normalize.example.test/normalize_video'
    process.env.MUSASHI_POSE_CLOUD_TOKEN = 'test-token'
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'x-musashi-output-bytes': '3',
        'x-musashi-effective-duration-sec': '9.5',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const source = new Blob([new Uint8Array([4, 5, 6])]).stream() as ReadableStream<Uint8Array>
    const normalized = await normalizeVideoOnServer({
      source,
      sourceName: 'iphone-hevc.mov',
      sourceMimeType: 'video/quicktime',
      maxSec: 10,
      sourceStartSec: 4.2,
      requestId: 'request-123',
    })

    expect(normalized.sizeBytes).toBe(3)
    expect(normalized.effectiveDurationSec).toBe(9.5)
    expect((await new Response(normalized.body).arrayBuffer()).byteLength).toBe(3)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(init).toMatchObject({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer test-token',
        'Content-Type': 'video/quicktime',
        'X-Musashi-Max-Sec': '10',
        'X-Musashi-Source-Start-Sec': '4.2',
        'X-Musashi-Request-Id': 'request-123',
      }),
    })
  })

  it('does not expose Modal response text in a retry message', async () => {
    process.env.MUSASHI_VIDEO_NORMALIZER_URL = 'https://normalize.example.test/normalize_video'
    process.env.MUSASHI_POSE_CLOUD_TOKEN = 'test-token'
    vi.stubGlobal('fetch', vi.fn(async () => new Response('internal ffmpeg detail', { status: 422 })))

    await expect(normalizeVideoOnServer({
      source: new Blob(['source']).stream() as ReadableStream<Uint8Array>,
      sourceName: 'clip.mov',
      sourceMimeType: 'video/quicktime',
      maxSec: 10,
      requestId: 'request-456',
    })).rejects.toMatchObject({
      code: 'SERVER_PROCESSING_FAILED',
      message: 'Server video processing failed. Your original upload was kept safely; retry the analysis.',
      detail: expect.stringContaining('internal ffmpeg detail'),
    })
  })

  it('forwards a shorter requested maximum to the source-aware normalizer', async () => {
    process.env.MUSASHI_VIDEO_NORMALIZER_URL = 'https://normalize.example.test/normalize_video'
    process.env.MUSASHI_POSE_CLOUD_TOKEN = 'test-token'
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'x-musashi-output-bytes': '3',
        // The normalizer has capped the request again at the available source.
        'x-musashi-effective-duration-sec': '4.4',
      },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await normalizeVideoOnServer({
      source: new Blob(['source']).stream() as ReadableStream<Uint8Array>,
      sourceName: 'clip.mp4',
      sourceMimeType: 'video/mp4',
      maxSec: resolveRequestedVideoDurationSec(5, 10),
      sourceStartSec: 3,
      requestId: 'request-short-window',
    })

    const [, init] = fetchMock.mock.calls[0]
    expect(init?.headers).toEqual(expect.objectContaining({
      'X-Musashi-Max-Sec': '5',
      'X-Musashi-Source-Start-Sec': '3',
    }))
  })

  it('keeps public errors specific but safe', () => {
    const error = new VideoIngestionError('GEMINI_UPLOAD_FAILED', 'upstream internal detail')
    expect(error.message).toBe('Gemini tape upload failed. Please retry the analysis.')
    expect(error.detail).toBe('upstream internal detail')
  })
})
