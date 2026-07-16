import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UploadClientError, uploadMarketplaceFile, type UploadProgress } from './uploadClient'

type TicketResponse = {
  asset: { id: string; status: string }
  upload: { method: string; url: string; headers: Record<string, string> }
}

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = []
  static onSend: ((xhr: FakeXMLHttpRequest) => void) | null = null

  upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
  withCredentials = false
  status = 200
  responseText = ''
  timeout = 0
  method = ''
  url = ''
  headers: Record<string, string> = {}
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  ontimeout: (() => void) | null = null
  sentBody: unknown = null
  aborted = false

  constructor() {
    FakeXMLHttpRequest.instances.push(this)
  }

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  setRequestHeader(key: string, value: string) {
    this.headers[key] = value
  }

  send(body: unknown) {
    this.sentBody = body
    if (FakeXMLHttpRequest.onSend) FakeXMLHttpRequest.onSend(this)
    else this.respond(200)
  }

  abort() {
    this.aborted = true
    this.onabort?.()
  }

  emitProgress(loaded: number, total: number, lengthComputable = true) {
    this.upload.onprogress?.({ loaded, total, lengthComputable } as ProgressEvent)
  }

  respond(status: number, responseText = '') {
    this.status = status
    this.responseText = responseText
    this.onload?.()
  }
}

function makeTicket(url = '/api/uploads/asset_test/content'): TicketResponse {
  return {
    asset: { id: 'asset_test', status: 'pending_upload' },
    upload: { method: 'PUT', url, headers: { 'Content-Type': 'video/mp4' } },
  }
}

function mockFetchWithTicket(ticket: TicketResponse) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input)
    if (url === '/api/uploads') return Response.json(ticket, { status: 201 })
    if (url === `/api/uploads/${ticket.asset.id}/complete`) {
      return Response.json({ asset: { id: ticket.asset.id, status: 'uploaded' } })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function waitForUploadRequest(): Promise<FakeXMLHttpRequest> {
  for (let attempt = 0; attempt < 12 && FakeXMLHttpRequest.instances.length === 0; attempt += 1) {
    await Promise.resolve()
  }
  expect(FakeXMLHttpRequest.instances).toHaveLength(1)
  return FakeXMLHttpRequest.instances[0]
}

describe('uploadMarketplaceFile', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.instances = []
    FakeXMLHttpRequest.onSend = null
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('isolates credentials by upload URL origin', async () => {
    vi.stubGlobal('window', { location: { origin: 'https://app.example' } })
    mockFetchWithTicket(
      makeTicket('https://r2.example/object?X-Amz-Signature=abc'),
    )
    await uploadMarketplaceFile({
      file: new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
      purpose: 'analysis_clip',
    })
    expect(FakeXMLHttpRequest.instances[0].withCredentials).toBe(false)

    FakeXMLHttpRequest.instances = []
    mockFetchWithTicket(makeTicket('https://app.example/api/uploads/asset_test/content'))
    await uploadMarketplaceFile({
      file: new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
      purpose: 'analysis_clip',
    })
    expect(FakeXMLHttpRequest.instances[0].withCredentials).toBe(true)
  })

  it('reports unweighted raw percent and byte progress', async () => {
    mockFetchWithTicket(makeTicket())
    const legacy: Array<{ percent: number; detail: UploadProgress }> = []
    const enhanced: UploadProgress[] = []
    FakeXMLHttpRequest.onSend = (xhr) => {
      xhr.emitProgress(25, 100)
      xhr.respond(200)
    }

    await uploadMarketplaceFile({
      file: new File([new Uint8Array(100)], 'clip.mp4', { type: 'video/mp4' }),
      purpose: 'analysis_clip',
      onProgress: (percent, detail) => legacy.push({ percent, detail }),
      onUploadProgress: (progress) => enhanced.push(progress),
    })

    const expected = {
      loadedBytes: 25,
      totalBytes: 100,
      percent: 25,
      lengthComputable: true,
    }
    expect(legacy).toEqual([{ percent: 25, detail: expected }])
    expect(enhanced).toEqual([expected])
  })

  it('uses File.size when lengthComputable is false', async () => {
    mockFetchWithTicket(makeTicket())
    const updates: UploadProgress[] = []
    const legacy = vi.fn()
    FakeXMLHttpRequest.onSend = (xhr) => {
      xhr.emitProgress(2, 0, false)
      xhr.respond(200)
    }

    await uploadMarketplaceFile({
      file: new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
      purpose: 'analysis_clip',
      onProgress: legacy,
      onUploadProgress: (progress) => updates.push(progress),
    })

    expect(updates).toEqual([
      { loadedBytes: 2, totalBytes: 4, percent: 50, lengthComputable: false },
    ])
    expect(legacy).toHaveBeenCalledWith(50, updates[0])
  })

  it('aborts with UPLOAD_STALLED when bytes stop advancing', async () => {
    vi.useFakeTimers()
    mockFetchWithTicket(makeTicket())
    FakeXMLHttpRequest.onSend = () => undefined

    const result = uploadMarketplaceFile({
      file: new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
      purpose: 'analysis_clip',
      stallTimeoutMs: 100,
      hardTimeoutMs: 1_000,
    }).catch((error: unknown) => error)
    const xhr = await waitForUploadRequest()

    await vi.advanceTimersByTimeAsync(50)
    xhr.emitProgress(1, 4)
    await vi.advanceTimersByTimeAsync(99)
    expect(xhr.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const error = await result

    expect(error).toBeInstanceOf(UploadClientError)
    expect(error).toMatchObject({
      code: 'UPLOAD_STALLED',
      stage: 'upload',
      retryable: true,
      body: { code: 'UPLOAD_STALLED', stage: 'upload', retryable: true },
    })
    expect(xhr.aborted).toBe(true)
  })

  it('enforces a configurable hard transfer timeout', async () => {
    vi.useFakeTimers()
    mockFetchWithTicket(makeTicket())
    FakeXMLHttpRequest.onSend = () => undefined

    const result = uploadMarketplaceFile({
      file: new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
      purpose: 'analysis_clip',
      stallTimeoutMs: 0,
      hardTimeoutMs: 250,
    }).catch((error: unknown) => error)
    const xhr = await waitForUploadRequest()

    expect(xhr.timeout).toBe(250)
    await vi.advanceTimersByTimeAsync(250)
    const error = await result

    expect(error).toMatchObject({ code: 'UPLOAD_TIMEOUT', stage: 'upload', retryable: true })
    expect(xhr.aborted).toBe(true)
  })

  it('supports caller cancellation with AbortSignal', async () => {
    mockFetchWithTicket(makeTicket())
    FakeXMLHttpRequest.onSend = () => undefined
    const controller = new AbortController()

    const result = uploadMarketplaceFile({
      file: new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
      purpose: 'analysis_clip',
      signal: controller.signal,
    }).catch((error: unknown) => error)
    const xhr = await waitForUploadRequest()

    controller.abort()
    const error = await result

    expect(error).toMatchObject({
      code: 'UPLOAD_ABORTED',
      stage: 'upload',
      retryable: false,
    })
    expect(xhr.aborted).toBe(true)
  })

  it('returns a structured safe body for upload status errors', async () => {
    mockFetchWithTicket(makeTicket())
    FakeXMLHttpRequest.onSend = (xhr) => {
      xhr.respond(
        413,
        JSON.stringify({
          code: 'file_too_large',
          error: 'Video is too large; signed URL https://r2.example/object?X-Amz-Signature=secret',
          internalSecret: 'must-not-escape',
        }),
      )
    }

    const error = (await uploadMarketplaceFile({
      file: new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
      purpose: 'analysis_clip',
    }).catch((reason: unknown) => reason)) as UploadClientError

    expect(error).toBeInstanceOf(UploadClientError)
    expect(error.body).toEqual({
      code: 'UPLOAD_HTTP_ERROR',
      stage: 'upload',
      status: 413,
      serverCode: 'FILE_TOO_LARGE',
      message: 'Video is too large; signed URL [redacted-url]',
      retryable: false,
    })
    expect(JSON.stringify(error.body)).not.toContain('must-not-escape')
    expect(JSON.stringify(error.body)).not.toContain('X-Amz-Signature')
  })

  it('returns structured status details when ticket creation fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { error: { code: 'auth_required', message: 'Please sign in again.' }, debug: 'hidden' },
          { status: 401 },
        ),
      ),
    )

    const error = (await uploadMarketplaceFile({
      file: new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
      purpose: 'analysis_clip',
    }).catch((reason: unknown) => reason)) as UploadClientError

    expect(error.body).toEqual({
      code: 'UPLOAD_TICKET_FAILED',
      stage: 'ticket',
      status: 401,
      serverCode: 'AUTH_REQUIRED',
      message: 'Please sign in again.',
      retryable: false,
    })
    expect(FakeXMLHttpRequest.instances).toHaveLength(0)
  })

  it('preserves phone-video MIME coercion in ticket and returned asset', async () => {
    const fetchMock = mockFetchWithTicket(makeTicket())

    const asset = await uploadMarketplaceFile({
      file: new File(['clip'], 'phone.MOV', { type: 'application/octet-stream' }),
      purpose: 'analysis_clip',
    })

    const ticketRequest = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(String(ticketRequest?.body))).toMatchObject({
      originalName: 'phone.MOV',
      contentType: 'video/quicktime',
    })
    expect(asset.contentType).toBe('video/quicktime')
  })
})
