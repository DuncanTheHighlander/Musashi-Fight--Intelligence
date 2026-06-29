import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import type { D1Database } from '@/lib/db'

function jsonPost(body: unknown): Request {
  return new Request('http://localhost/api/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/uploads', () => {
  let db: D1Database

  beforeEach(() => {
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '1')
    vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'mock')
    db = createMockD1()
    pinMockD1(db)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    unpinMockD1()
  })

  it('returns 501 when R2 mode is forced but storage env is missing', async () => {
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'r2')
    vi.stubEnv('STORAGE_SERVICE_URL', '')
    vi.stubEnv('STORAGE_ACCESS_KEY', '')
    vi.stubEnv('STORAGE_SECRET_KEY', '')
    vi.stubEnv('STORAGE_BUCKET_NAME', '')
    vi.stubEnv('NODE_ENV', 'production')

    const res = await POST(
      jsonPost({
        purpose: 'job_video',
        originalName: 'clip.mp4',
        contentType: 'video/mp4',
        sizeBytes: 1024,
      }),
    )
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBe(501)
    expect(body.error).toMatch(/not configured/i)
  })

  it('rejects unsupported content type', async () => {
    const res = await POST(
      jsonPost({
        purpose: 'job_video',
        originalName: 'notes.txt',
        contentType: 'text/plain',
        sizeBytes: 100,
      }),
    )
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/content type/i)
  })

  it('issues upload ticket in mock mode', async () => {
    const res = await POST(
      jsonPost({
        purpose: 'job_video',
        originalName: 'clip.mp4',
        contentType: 'video/mp4',
        sizeBytes: 2048,
      }),
    )
    const body = (await res.json()) as {
      asset: { id: string; status: string }
      upload: { method: string; url: string }
    }

    expect(res.status).toBe(201)
    expect(body.asset.status).toBe('pending_upload')
    expect(body.upload.method).toBe('PUT')
    expect(body.upload.url).toContain('/api/uploads/')
  })
})
