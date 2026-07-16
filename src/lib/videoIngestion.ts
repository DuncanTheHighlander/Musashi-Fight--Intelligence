import { readSecretEnv } from '@/lib/env'

export type VideoIngestionStage =
  | 'selected'
  | 'uploading_original'
  | 'original_uploaded'
  | 'normalizing'
  | 'normalized'
  | 'uploading_to_gemini'
  | 'gemini_processing'
  | 'gemini_ready'
  | 'analyzing'
  | 'complete'
  | 'failed'

export type IngestionFailureCode =
  | 'ORIGINAL_UPLOAD_FAILED'
  | 'ORIGINAL_ASSET_NOT_READY'
  | 'SERVER_PROCESSING_UNAVAILABLE'
  | 'SERVER_PROCESSING_FAILED'
  | 'NORMALIZED_STORAGE_UNAVAILABLE'
  | 'NORMALIZED_STORAGE_INCOMPLETE'
  | 'NORMALIZED_STORAGE_SIZE_MISMATCH'
  | 'GEMINI_UPLOAD_FAILED'
  | 'GEMINI_PROCESSING_FAILED'
  | 'GEMINI_PROCESSING_TIMEOUT'
  | 'VIDEO_ANALYSIS_REJECTED'

const FAILURE_MESSAGES: Record<IngestionFailureCode, string> = {
  ORIGINAL_UPLOAD_FAILED: 'Original upload failed. Check your connection and try the video again.',
  ORIGINAL_ASSET_NOT_READY: 'Original upload did not finish. Try the video again.',
  SERVER_PROCESSING_UNAVAILABLE: 'Server video processing is temporarily unavailable. Please try again shortly.',
  SERVER_PROCESSING_FAILED: 'Server video processing failed. Your original upload was kept safely; retry the analysis.',
  NORMALIZED_STORAGE_UNAVAILABLE: 'Server processing could not save the normalized video. Please try again.',
  NORMALIZED_STORAGE_INCOMPLETE: 'Server processing produced an incomplete video. Please try again.',
  NORMALIZED_STORAGE_SIZE_MISMATCH: 'Server processing could not verify the normalized video. Please try again.',
  GEMINI_UPLOAD_FAILED: 'Gemini tape upload failed. Please retry the analysis.',
  GEMINI_PROCESSING_FAILED: 'Gemini could not process this video. Try a different clip.',
  GEMINI_PROCESSING_TIMEOUT: 'Gemini processing timed out. Please retry the analysis.',
  VIDEO_ANALYSIS_REJECTED: 'Video analysis was rejected. Please try again.',
}

export class VideoIngestionError extends Error {
  readonly code: IngestionFailureCode
  /**
   * Keep upstream/FFmpeg text available to server logs, but never include it
   * in the browser response. It can be noisy and is not actionable for an
   * athlete retrying an upload.
   */
  readonly detail?: string

  constructor(code: IngestionFailureCode, detail?: string) {
    super(FAILURE_MESSAGES[code])
    this.name = 'VideoIngestionError'
    this.code = code
    this.detail = detail
  }
}

export const ingestionFailureMessage = (code: IngestionFailureCode): string => FAILURE_MESSAGES[code]

export const asVideoIngestionError = (error: unknown): VideoIngestionError | null =>
  error instanceof VideoIngestionError ? error : null

export type NormalizedVideo = {
  body: ReadableStream<Uint8Array>
  sizeBytes: number
  effectiveDurationSec: number
}

/**
 * Resolve the longest interval the normalizer may emit. The authenticated
 * server tier remains the hard ceiling, while a shorter athlete selection is
 * preserved instead of being silently expanded to the tier maximum. The
 * normalizer applies the final source-availability cap after probing the real
 * media (`sourceDuration - sourceStart`).
 */
export function resolveRequestedVideoDurationSec(
  requestedDurationSec: unknown,
  tierMaxSec: number,
): number {
  const serverTierMaxSec = Number(tierMaxSec)
  if (!Number.isFinite(serverTierMaxSec) || serverTierMaxSec <= 0) {
    throw new VideoIngestionError('VIDEO_ANALYSIS_REJECTED', 'invalid server tier duration')
  }

  const hasRequestedDuration =
    requestedDurationSec !== null &&
    requestedDurationSec !== undefined &&
    String(requestedDurationSec).trim() !== ''
  if (!hasRequestedDuration) return serverTierMaxSec

  const requested = Number(requestedDurationSec)
  if (!Number.isFinite(requested) || requested <= 0) {
    throw new VideoIngestionError('VIDEO_ANALYSIS_REJECTED', 'invalid requested duration')
  }
  return Math.min(requested, serverTierMaxSec)
}

/**
 * Send an R2 stream to Modal for a deterministic FFmpeg normalize/slice pass.
 * The endpoint never receives user credentials and the Worker never buffers the
 * original phone file in memory.
 */
export async function normalizeVideoOnServer(args: {
  source: ReadableStream<Uint8Array>
  sourceName: string
  sourceMimeType: string
  maxSec: number
  /** Requested source offset; the normalizer validates it against the file. */
  sourceStartSec?: number
  requestId: string
}): Promise<NormalizedVideo> {
  const endpoint = readSecretEnv('MUSASHI_VIDEO_NORMALIZER_URL')
  const token = readSecretEnv('MUSASHI_POSE_CLOUD_TOKEN')
  if (!endpoint || !token) {
    throw new VideoIngestionError('SERVER_PROCESSING_UNAVAILABLE')
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 280_000)
  try {
    const sourceStartSec =
      Number.isFinite(args.sourceStartSec) && Number(args.sourceStartSec) >= 0
        ? Math.min(Number(args.sourceStartSec), 86_400)
        : 0
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': args.sourceMimeType || 'application/octet-stream',
        'X-Musashi-Source-Name': encodeURIComponent(args.sourceName || 'clip.mp4'),
        'X-Musashi-Max-Sec': String(args.maxSec),
        'X-Musashi-Source-Start-Sec': String(sourceStartSec),
        'X-Musashi-Request-Id': args.requestId,
      },
      body: args.source as unknown as BodyInit,
      signal: controller.signal,
      duplex: 'half' as never,
    } as RequestInit)

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 180)
      throw new VideoIngestionError('SERVER_PROCESSING_FAILED', `status ${response.status}${detail ? `: ${detail}` : ''}`)
    }
    if (!response.body) throw new VideoIngestionError('SERVER_PROCESSING_FAILED', 'empty response')

    const sizeBytes = Number(response.headers.get('x-musashi-output-bytes') || 0)
    const effectiveDurationSec = Number(response.headers.get('x-musashi-effective-duration-sec') || 0)
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      throw new VideoIngestionError('SERVER_PROCESSING_FAILED', 'missing normalized byte size')
    }
    if (!Number.isFinite(effectiveDurationSec) || effectiveDurationSec <= 0 || effectiveDurationSec > args.maxSec + 0.25) {
      throw new VideoIngestionError('SERVER_PROCESSING_FAILED', 'invalid normalized duration')
    }
    return { body: response.body, sizeBytes, effectiveDurationSec }
  } catch (error) {
    if (error instanceof VideoIngestionError) throw error
    if (controller.signal.aborted) {
      throw new VideoIngestionError('SERVER_PROCESSING_FAILED', 'processing timed out')
    }
    throw new VideoIngestionError(
      'SERVER_PROCESSING_FAILED',
      error instanceof Error ? error.message.slice(0, 180) : 'unknown upstream error',
    )
  } finally {
    clearTimeout(timeout)
  }
}
