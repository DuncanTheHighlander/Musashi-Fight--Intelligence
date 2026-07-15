import { getCloudflareContext } from '@opennextjs/cloudflare'

export type WorkerR2Object = {
  body: ReadableStream | null
  size: number
  httpMetadata?: { contentType?: string }
}

export type WorkerR2Bucket = {
  put: (key: string, value: ReadableStream | ArrayBuffer | Uint8Array | string, options?: { httpMetadata?: { contentType?: string; contentLength?: number } }) => Promise<unknown>
  get: (key: string) => Promise<WorkerR2Object | null>
  head: (key: string) => Promise<{ size: number } | null>
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
