import { afterEach, describe, expect, it, vi } from 'vitest'
import { putWorkerR2Object, type WorkerR2Bucket } from './workerR2'

class TestFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  readonly expectedLength: number

  constructor(expectedLength: number) {
    super()
    this.expectedLength = expectedLength
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('putWorkerR2Object', () => {
  it('wraps a stream in FixedLengthStream before writing to R2', async () => {
    vi.stubGlobal('FixedLengthStream', TestFixedLengthStream)
    const put = vi.fn(async (_key: string, body: unknown) => {
      await new Response(body as BodyInit).arrayBuffer()
    })
    const bucket: WorkerR2Bucket = {
      put: put as WorkerR2Bucket['put'],
      get: vi.fn(),
      head: vi.fn(),
    }

    await putWorkerR2Object(bucket, {
      key: 'uploads/user/clip.mp4',
      body: new Blob([new Uint8Array([1, 2, 3])]).stream() as ReadableStream<Uint8Array>,
      sizeBytes: 3,
      contentType: 'video/mp4',
    })

    expect(put).toHaveBeenCalledWith(
      'uploads/user/clip.mp4',
      expect.any(ReadableStream),
      { httpMetadata: { contentType: 'video/mp4' } },
    )
  })

  it('rejects a missing authoritative length before opening an R2 write', async () => {
    const bucket: WorkerR2Bucket = {
      put: vi.fn(),
      get: vi.fn(),
      head: vi.fn(),
    }

    await expect(putWorkerR2Object(bucket, {
      key: 'uploads/user/clip.mp4',
      body: new Blob(['x']).stream() as ReadableStream<Uint8Array>,
      sizeBytes: 0,
      contentType: 'video/mp4',
    })).rejects.toThrow('INVALID_STREAM_LENGTH')
    expect(bucket.put).not.toHaveBeenCalled()
  })
})
