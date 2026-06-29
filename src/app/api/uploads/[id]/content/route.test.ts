import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PUT } from './route'
import { createUploadTicket } from '@/lib/storage/assets'
import type { D1Database } from '@/lib/db'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'

describe('PUT /api/uploads/[id]/content', () => {
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

  it('accepts mock-mode bytes for pending asset', async () => {
    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'job_video',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 64,
      origin: 'http://localhost:3000',
    })

    const res = await PUT(
      new Request(`http://localhost/api/uploads/${ticket.asset.id}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        body: Buffer.from('mock-upload'),
      }),
      { params: Promise.resolve({ id: ticket.asset.id }) },
    )

    expect(res.status).toBe(200)
  })

  it('returns 405 when storage mode is r2', async () => {
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'r2')
    vi.stubEnv('STORAGE_SERVICE_URL', 'https://example.r2.cloudflarestorage.com')
    vi.stubEnv('STORAGE_ACCESS_KEY', 'access')
    vi.stubEnv('STORAGE_SECRET_KEY', 'secret')
    vi.stubEnv('STORAGE_BUCKET_NAME', 'bucket')

    const res = await PUT(
      new Request('http://localhost/api/uploads/asset_x/content', {
        method: 'PUT',
        body: Buffer.from('x'),
      }),
      { params: Promise.resolve({ id: 'asset_x' }) },
    )
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBe(405)
    expect(body.error).toMatch(/mock storage/i)
  })
})
