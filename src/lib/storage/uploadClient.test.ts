import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadMarketplaceFile } from './uploadClient'

type TicketResponse = {
  asset: { id: string; status: string }
  upload: {
    method: string
    url: string
    headers: Record<string, string>
  }
}

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = []

  upload = { onprogress: null as ((event: ProgressEvent) => void) | null }
  withCredentials = false
  status = 200
  method = ''
  url = ''
  headers: Record<string, string> = {}
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  sentBody: unknown = null

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
    this.onload?.()
  }
}

function mockFetchWithTicket(ticket: TicketResponse) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === '/api/uploads') {
      return Response.json(ticket, { status: 201 })
    }
    if (url === `/api/uploads/${ticket.asset.id}/complete`) {
      return Response.json({ asset: { id: ticket.asset.id, status: 'uploaded' } })
    }
    throw new Error(`Unexpected fetch: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('uploadMarketplaceFile', () => {
  beforeEach(() => {
    FakeXMLHttpRequest.instances = []
    vi.stubGlobal('XMLHttpRequest', FakeXMLHttpRequest)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not send app credentials to cross-origin signed upload URLs', async () => {
    mockFetchWithTicket({
      asset: { id: 'asset_r2', status: 'pending_upload' },
      upload: {
        method: 'PUT',
        url: 'https://account.r2.cloudflarestorage.com/musashi-uploads/object-key?X-Amz-Signature=abc',
        headers: { 'Content-Type': 'video/mp4' },
      },
    })

    await uploadMarketplaceFile({
      file: new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
      purpose: 'analysis_clip',
    })

    expect(FakeXMLHttpRequest.instances).toHaveLength(1)
    expect(FakeXMLHttpRequest.instances[0].withCredentials).toBe(false)
  })

  it('keeps credentials for same-origin mock upload URLs', async () => {
    mockFetchWithTicket({
      asset: { id: 'asset_mock', status: 'pending_upload' },
      upload: {
        method: 'PUT',
        url: '/api/uploads/asset_mock/content',
        headers: { 'Content-Type': 'video/mp4' },
      },
    })

    await uploadMarketplaceFile({
      file: new File(['clip'], 'clip.mp4', { type: 'video/mp4' }),
      purpose: 'analysis_clip',
    })

    expect(FakeXMLHttpRequest.instances).toHaveLength(1)
    expect(FakeXMLHttpRequest.instances[0].withCredentials).toBe(true)
  })
})
