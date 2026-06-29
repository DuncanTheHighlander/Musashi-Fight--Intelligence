import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { createUploadTicket } from '@/lib/storage/assets'
import { writeMockObject } from '@/lib/storage/mockStorage'
import type { D1Database } from '@/lib/db'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'

describe('POST /api/uploads/[id]/complete', () => {
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

  it('marks asset uploaded after bytes land in mock storage', async () => {
    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'job_video',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 256,
      origin: 'http://localhost:3000',
    })
    writeMockObject(ticket.asset.object_key, Buffer.from('video-bytes'))

    const res = await POST(
      new Request(`http://localhost/api/uploads/${ticket.asset.id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sizeBytes: 256 }),
      }),
      { params: Promise.resolve({ id: ticket.asset.id }) },
    )
    const body = (await res.json()) as { asset: { status: string; size_bytes: number } }

    expect(res.status).toBe(200)
    expect(body.asset.status).toBe('uploaded')
    expect(body.asset.size_bytes).toBeGreaterThan(0)
  })

  it('returns 404 for unknown asset id', async () => {
    const res = await POST(
      new Request('http://localhost/api/uploads/asset_missing/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'asset_missing' }) },
    )

    expect(res.status).toBe(404)
  })
})
