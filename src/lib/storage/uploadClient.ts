/**
 * Client-side upload helper - creates ticket, PUTs bytes, completes.
 */
export type UploadPurpose = 'job_video' | 'deliverable' | 'dispute_evidence' | 'profile_media' | 'analysis_clip'

export type UploadedAsset = {
  id: string
  purpose: UploadPurpose
  originalName: string
  contentType: string
}

export type UploadProgress = {
  /** Bytes the browser has handed to the network layer. */
  loadedBytes: number
  /** Expected request-body bytes. Falls back to File.size when XHR omits a total. */
  totalBytes: number | null
  /** Raw transfer percentage in the 0..100 range, with no pipeline weighting. */
  percent: number | null
  /** Whether the native XHR ProgressEvent supplied its own total. */
  lengthComputable: boolean
}

export type UploadClientStage = 'ticket' | 'upload' | 'complete'

export type UploadClientErrorCode =
  | 'UPLOAD_TICKET_FAILED'
  | 'UPLOAD_HTTP_ERROR'
  | 'UPLOAD_NETWORK_ERROR'
  | 'UPLOAD_STALLED'
  | 'UPLOAD_TIMEOUT'
  | 'UPLOAD_ABORTED'
  | 'UPLOAD_COMPLETE_FAILED'

export type UploadErrorBody = {
  code: UploadClientErrorCode
  stage: UploadClientStage
  message: string
  retryable: boolean
  status?: number
  serverCode?: string
}

/**
 * A deliberately small, display-safe upload failure. It never includes the
 * signed upload URL, request headers, file name, or an unfiltered server body.
 */
export class UploadClientError extends Error {
  readonly code: UploadClientErrorCode
  readonly stage: UploadClientStage
  readonly retryable: boolean
  readonly status?: number
  readonly serverCode?: string
  readonly body: UploadErrorBody

  constructor(body: UploadErrorBody) {
    super(body.message)
    this.name = 'UploadClientError'
    this.code = body.code
    this.stage = body.stage
    this.retryable = body.retryable
    this.status = body.status
    this.serverCode = body.serverCode
    this.body = body
  }
}

export const DEFAULT_UPLOAD_STALL_TIMEOUT_MS = 20_000
export const DEFAULT_UPLOAD_HARD_TIMEOUT_MS = 10 * 60_000

type TicketResponse = {
  asset: { id: string; status: string }
  upload: {
    method: string
    url: string
    headers: Record<string, string>
  }
}

function inferVideoContentType(fileName: string, declared?: string): string {
  const raw = String(declared || '')
    .toLowerCase()
    .split(';')[0]
    .trim()
  if (raw === 'video/mp4' || raw === 'video/quicktime' || raw === 'video/webm') return raw
  const lower = String(fileName || '').toLowerCase()
  if (lower.endsWith('.mov') || lower.endsWith('.qt')) return 'video/quicktime'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4'
  // Browsers often leave type empty or set octet-stream for phone clips.
  if (!raw || raw === 'application/octet-stream') return 'video/mp4'
  return raw
}

export async function uploadMarketplaceFile(args: {
  file: File
  purpose: UploadPurpose
  jobId?: string
  disputeId?: string
  /** Existing percent callback. The optional second argument adds byte detail. */
  onProgress?: (pct: number, progress: UploadProgress) => void
  /** Always receives progress details, including non-computable XHR events. */
  onUploadProgress?: (progress: UploadProgress) => void
  /** Cancels ticket creation, byte transfer, or completion. */
  signal?: AbortSignal
  /** Abort when uploaded bytes do not increase for this long. Set 0 to disable. */
  stallTimeoutMs?: number
  /** Absolute byte-transfer deadline. Set 0 to disable. */
  hardTimeoutMs?: number
}): Promise<UploadedAsset> {
  const {
    file,
    purpose,
    jobId,
    disputeId,
    onProgress,
    onUploadProgress,
    signal,
    stallTimeoutMs = DEFAULT_UPLOAD_STALL_TIMEOUT_MS,
    hardTimeoutMs = DEFAULT_UPLOAD_HARD_TIMEOUT_MS,
  } = args
  const contentType = inferVideoContentType(file.name, file.type)

  throwIfAborted(signal, 'ticket')

  // Analysis clips (phone .mov often 100–500 MB) must use browser-direct R2.
  // /api/upload-ticket always requires a presigned URL — never Worker proxy.
  const ticketUrl = purpose === 'analysis_clip' ? '/api/upload-ticket' : '/api/uploads'

  let ticketRes: Response
  try {
    ticketRes = await fetch(ticketUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal,
      body: JSON.stringify({
        purpose,
        originalName: file.name,
        contentType,
        sizeBytes: file.size,
        jobId,
        disputeId,
      }),
    })
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw abortedError('ticket')
    throw uploadError({
      code: 'UPLOAD_TICKET_FAILED',
      stage: 'ticket',
      message: 'Could not create the upload. Check your connection and retry.',
      retryable: true,
    })
  }
  if (!ticketRes.ok) {
    const server = await readSafeServerFailure(ticketRes)
    if (ticketRes.status === 501) {
      throw uploadError({
        code: 'UPLOAD_TICKET_FAILED',
        stage: 'ticket',
        status: ticketRes.status,
        serverCode: server.serverCode,
        message: 'Direct upload unavailable - paste a shareable link instead.',
        retryable: false,
      })
    }
    throw uploadError({
      code: 'UPLOAD_TICKET_FAILED',
      stage: 'ticket',
      status: ticketRes.status,
      serverCode: server.serverCode,
      message: server.message || 'Failed to create upload ticket',
      retryable: isRetryableStatus(ticketRes.status),
    })
  }
  const ticketJson = (await ticketRes.json()) as TicketResponse & {
    assetId?: string
    presignedUrl?: string
  }
  const ticket: TicketResponse = {
    asset: ticketJson.asset?.id
      ? ticketJson.asset
      : { id: String(ticketJson.assetId || ''), status: 'pending_upload' },
    upload: ticketJson.upload?.url
      ? ticketJson.upload
      : {
          method: 'PUT',
          url: String(ticketJson.presignedUrl || ''),
          headers: (ticketJson as { headers?: Record<string, string> }).headers || {
            'Content-Type': contentType,
          },
        },
  }
  if (!ticket.asset.id || !ticket.upload.url) {
    throw uploadError({
      code: 'UPLOAD_TICKET_FAILED',
      stage: 'ticket',
      message: 'Upload ticket was incomplete. Retry in a moment.',
      retryable: true,
    })
  }
  // putWithProgress sets withCredentials=false for cross-origin R2 hosts.

  await putWithProgress(ticket.upload.url, file, ticket.upload.headers, {
    onProgress,
    onUploadProgress,
    signal,
    stallTimeoutMs,
    hardTimeoutMs,
  })

  throwIfAborted(signal, 'complete')

  let completeRes: Response
  try {
    completeRes = await fetch(`/api/uploads/${ticket.asset.id}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      signal,
      body: JSON.stringify({ sizeBytes: file.size }),
    })
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) throw abortedError('complete')
    throw uploadError({
      code: 'UPLOAD_COMPLETE_FAILED',
      stage: 'complete',
      message: 'Upload was sent, but could not be verified. Retry to check it again.',
      retryable: true,
    })
  }
  if (!completeRes.ok) {
    const server = await readSafeServerFailure(completeRes)
    throw uploadError({
      code: 'UPLOAD_COMPLETE_FAILED',
      stage: 'complete',
      status: completeRes.status,
      serverCode: server.serverCode,
      message: server.message || 'Failed to complete upload',
      retryable: isRetryableStatus(completeRes.status),
    })
  }

  return {
    id: ticket.asset.id,
    purpose,
    originalName: file.name,
    contentType,
  }
}

function putWithProgress(
  url: string,
  file: File,
  headers: Record<string, string>,
  options: {
    onProgress?: (pct: number, progress: UploadProgress) => void
    onUploadProgress?: (progress: UploadProgress) => void
    signal?: AbortSignal
    stallTimeoutMs: number
    hardTimeoutMs: number
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(abortedError('upload'))
      return
    }

    const xhr = new XMLHttpRequest()
    let settled = false
    let lastLoaded = 0
    let stallTimer: ReturnType<typeof setTimeout> | null = null
    let hardTimer: ReturnType<typeof setTimeout> | null = null

    const stallTimeoutMs = normalizedTimeout(options.stallTimeoutMs)
    const hardTimeoutMs = normalizedTimeout(options.hardTimeoutMs)

    const cleanup = () => {
      if (stallTimer !== null) clearTimeout(stallTimer)
      if (hardTimer !== null) clearTimeout(hardTimer)
      stallTimer = null
      hardTimer = null
      options.signal?.removeEventListener('abort', onSignalAbort)
      xhr.upload.onprogress = null
      xhr.onload = null
      xhr.onerror = null
      xhr.onabort = null
      xhr.ontimeout = null
    }

    const succeed = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve()
    }

    const fail = (error: UploadClientError, abortTransport = false) => {
      if (settled) return
      settled = true
      cleanup()
      if (abortTransport) {
        try {
          xhr.abort()
        } catch {
          // The promise is already being rejected with the useful cause.
        }
      }
      reject(error)
    }

    const armStallWatchdog = () => {
      if (stallTimer !== null) clearTimeout(stallTimer)
      if (!stallTimeoutMs) return
      stallTimer = setTimeout(() => {
        fail(
          uploadError({
            code: 'UPLOAD_STALLED',
            stage: 'upload',
            message: 'Upload stalled because no bytes moved. Check your connection and retry.',
            retryable: true,
          }),
          true,
        )
      }, stallTimeoutMs)
    }

    function onSignalAbort() {
      fail(abortedError('upload'), true)
    }

    xhr.open('PUT', url)
    xhr.withCredentials = shouldSendUploadCredentials(url)
    for (const [k, v] of Object.entries(headers || {})) {
      xhr.setRequestHeader(k, v)
    }
    xhr.upload.onprogress = (ev) => {
      const loadedBytes = finiteNonNegative(ev.loaded)
      const nativeTotal = ev.lengthComputable && ev.total > 0 ? finiteNonNegative(ev.total) : null
      const fileTotal = file.size > 0 ? file.size : null
      const totalBytes = nativeTotal || fileTotal
      const percent = totalBytes
        ? Math.min(100, Math.max(0, (loadedBytes / totalBytes) * 100))
        : null
      const progress: UploadProgress = {
        loadedBytes,
        totalBytes,
        percent,
        lengthComputable: ev.lengthComputable,
      }

      options.onUploadProgress?.(progress)
      if (percent !== null) options.onProgress?.(Math.round(percent), progress)

      if (loadedBytes > lastLoaded) {
        lastLoaded = loadedBytes
        armStallWatchdog()
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        succeed()
        return
      }
      const server = readSafeXhrFailure(xhr)
      fail(
        uploadError({
          code: 'UPLOAD_HTTP_ERROR',
          stage: 'upload',
          status: xhr.status,
          serverCode: server.serverCode,
          message: server.message || `Upload failed (${xhr.status})`,
          retryable: isRetryableStatus(xhr.status),
        }),
      )
    }
    xhr.onerror = () =>
      fail(
        uploadError({
          code: 'UPLOAD_NETWORK_ERROR',
          stage: 'upload',
          message: 'Upload network error. Check your connection and retry.',
          retryable: true,
        }),
      )
    xhr.onabort = () => fail(abortedError('upload'))
    xhr.ontimeout = () =>
      fail(
        uploadError({
          code: 'UPLOAD_TIMEOUT',
          stage: 'upload',
          message: 'Upload timed out. Check your connection and retry.',
          retryable: true,
        }),
      )

    options.signal?.addEventListener('abort', onSignalAbort, { once: true })
    armStallWatchdog()
    if (hardTimeoutMs) {
      xhr.timeout = hardTimeoutMs
      hardTimer = setTimeout(() => {
        fail(
          uploadError({
            code: 'UPLOAD_TIMEOUT',
            stage: 'upload',
            message: 'Upload timed out. Check your connection and retry.',
            retryable: true,
          }),
          true,
        )
      }, hardTimeoutMs)
    }

    try {
      xhr.send(file)
    } catch {
      fail(
        uploadError({
          code: 'UPLOAD_NETWORK_ERROR',
          stage: 'upload',
          message: 'Upload could not start. Check your connection and retry.',
          retryable: true,
        }),
      )
    }
  })
}

function normalizedTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

function finiteNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function throwIfAborted(signal: AbortSignal | undefined, stage: UploadClientStage): void {
  if (signal?.aborted) throw abortedError(stage)
}

function isAbortError(error: unknown): boolean {
  return typeof DOMException !== 'undefined' && error instanceof DOMException
    ? error.name === 'AbortError'
    : error instanceof Error && error.name === 'AbortError'
}

function abortedError(stage: UploadClientStage): UploadClientError {
  return uploadError({
    code: 'UPLOAD_ABORTED',
    stage,
    message: 'Upload canceled.',
    retryable: false,
  })
}

function uploadError(body: UploadErrorBody): UploadClientError {
  return new UploadClientError(compactBody(body))
}

function compactBody(body: UploadErrorBody): UploadErrorBody {
  const compact: UploadErrorBody = {
    code: body.code,
    stage: body.stage,
    message: sanitizeMessage(body.message) || 'Upload failed',
    retryable: body.retryable,
  }
  if (typeof body.status === 'number') compact.status = body.status
  if (body.serverCode) compact.serverCode = body.serverCode
  return compact
}

function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 425 || status === 429 || status >= 500
}

type SafeServerFailure = {
  message?: string
  serverCode?: string
}

async function readSafeServerFailure(response: Response): Promise<SafeServerFailure> {
  try {
    const text = await response.text()
    if (!text || text.length > 16_384) return {}
    return safeServerFailureFromUnknown(JSON.parse(text) as unknown)
  } catch {
    return {}
  }
}

function readSafeXhrFailure(xhr: XMLHttpRequest): SafeServerFailure {
  try {
    const text = xhr.responseText
    if (!text || text.length > 16_384) return {}
    return safeServerFailureFromUnknown(JSON.parse(text) as unknown)
  } catch {
    return {}
  }
}

function safeServerFailureFromUnknown(value: unknown): SafeServerFailure {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const body = value as Record<string, unknown>
  const nestedError =
    body.error && typeof body.error === 'object' && !Array.isArray(body.error)
      ? (body.error as Record<string, unknown>)
      : null
  const message = firstSafeMessage(
    body.message,
    typeof body.error === 'string' ? body.error : undefined,
    nestedError?.message,
  )
  const serverCode = firstSafeServerCode(body.code, nestedError?.code)
  return { message, serverCode }
}

function firstSafeMessage(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const message = sanitizeMessage(value)
    if (message) return message
  }
  return undefined
}

function sanitizeMessage(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/\bX-Amz-[A-Za-z-]+=[^\s&]+/gi, '[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

function firstSafeServerCode(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (/^[A-Za-z0-9_.:-]{1,64}$/.test(trimmed)) return trimmed.toUpperCase()
  }
  return undefined
}

function shouldSendUploadCredentials(url: string): boolean {
  const rawUrl = String(url || '').trim()
  if (!rawUrl) return true

  const currentOrigin =
    typeof window !== 'undefined' && window.location?.origin
      ? window.location.origin
      : null

  if (!currentOrigin) {
    return !/^[a-z][a-z\d+.-]*:\/\//i.test(rawUrl)
  }

  try {
    return new URL(rawUrl, currentOrigin).origin === currentOrigin
  } catch {
    return true
  }
}
