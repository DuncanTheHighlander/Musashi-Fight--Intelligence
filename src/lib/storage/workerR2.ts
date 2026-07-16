import { getCloudflareContext } from '@opennextjs/cloudflare'

export type WorkerR2Object = {
  body: ReadableStream | null
  size: number
  httpMetadata?: { contentType?: string }
}

export type WorkerR2Bucket = {
  put: (key: string, value: ReadableStream | ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string } }) => Promise<unknown>
  get: (key: string) => Promise<WorkerR2Object | null>
  head: (key: string) => Promise<{ size: number } | null>
}

/**
 * R2 accepts a ReadableStream only when Workers can determine its total
 * length. Browser request streams and fetch response streams are otherwise
 * rejected with "Provided readable stream must have a known length". The
 * caller supplies an already-authoritative length: upload-ticket size for an
 * original, or Modal's verified output-size header for a normalized video.
 */
export const putWorkerR2Object = async (
  bucket: WorkerR2Bucket,
  input: {
    key: string
    body: ReadableStream<Uint8Array>
    sizeBytes: number
    contentType: string
  },
): Promise<void> => {
  const sizeBytes = Math.trunc(Number(input.sizeBytes))
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    throw new Error('INVALID_STREAM_LENGTH')
  }

  // FixedLengthStream is a native Workers primitive. Keeping the source as a
  // stream preserves the phone -> R2 and Modal -> R2 paths without copying a
  // video into Worker memory.
  const fixedLength = new FixedLengthStream(sizeBytes)
  const write = input.body.pipeTo(
    fixedLength.writable as unknown as WritableStream<Uint8Array>,
  )
  const put = bucket.put(input.key, fixedLength.readable, {
    httpMetadata: { contentType: input.contentType },
  })
  await Promise.all([write, put])
}

/** Use the existing Worker binding when S3 signing credentials are unavailable. */
export const getWorkerUploadsBucket = async (): Promise<WorkerR2Bucket | null> => {
  try {
    const env = (await getCloudflareContext({ async: true })).env as {
      MUSASHI_UPLOADS_BUCKET?: WorkerR2Bucket
      MUSASHI_BUCKET?: WorkerR2Bucket
    }
    return env.MUSASHI_UPLOADS_BUCKET || env.MUSASHI_BUCKET || null
  } catch {
    return null
  }
}
