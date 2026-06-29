import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { createUploadTicket, completeUpload } from '@/lib/storage/assets'
import { writeMockObject } from '@/lib/storage/mockStorage'
import {
  buildSessionCookieHeader,
  createSession,
  createUser,
} from '@/lib/musashiAuth'
import type { D1Database } from '@/lib/db'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'

describe('GET /api/uploads/[id]', () => {
  let db: D1Database

  beforeEach(() => {
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '0')
    vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
    vi.stubEnv('MUSASHI_SESSION_SECRET', 'test-session-secret')
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'mock')
    db = createMockD1()
    pinMockD1(db)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    unpinMockD1()
  })

  async function authedGet(assetId: string, asUserId: string): Promise<Response> {
    const loginReq = new Request('http://localhost/login')
    const { cookieValue } = await createSession(loginReq, asUserId)
    const cookie = buildSessionCookieHeader(cookieValue).split(';')[0]
    return GET(
      new Request(`http://localhost/api/uploads/${assetId}`, {
        headers: { Cookie: cookie },
      }),
      { params: Promise.resolve({ id: assetId }) },
    )
  }

  it('returns 403 when a non-owner requests another users asset', async () => {
    const owner = await createUser({
      email: 'owner@example.test',
      password: 'Password1abc',
      role: 'user',
    })
    const viewer = await createUser({
      email: 'viewer@example.test',
      password: 'Password1abc',
      role: 'user',
    })

    const ticket = await createUploadTicket(db, {
      userId: owner.id,
      purpose: 'job_video',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 512,
      origin: 'http://localhost:3000',
    })
    writeMockObject(ticket.asset.object_key, Buffer.from('bytes'))
    await completeUpload(db, { assetId: ticket.asset.id, userId: owner.id })

    const res = await authedGet(ticket.asset.id, viewer.id)
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBe(403)
    expect(body.error).toMatch(/forbidden/i)
  })

  it('returns asset metadata for the owner', async () => {
    const owner = await createUser({
      email: 'owner2@example.test',
      password: 'Password1abc',
      role: 'user',
    })

    const ticket = await createUploadTicket(db, {
      userId: owner.id,
      purpose: 'deliverable',
      originalName: 'notes.pdf',
      contentType: 'application/pdf',
      sizeBytes: 128,
      origin: 'http://localhost:3000',
    })
    writeMockObject(ticket.asset.object_key, Buffer.from('pdf'))
    await completeUpload(db, { assetId: ticket.asset.id, userId: owner.id })

    const res = await authedGet(ticket.asset.id, owner.id)
    const body = (await res.json()) as { asset: { id: string; status: string }; readUrl: string }

    expect(res.status).toBe(200)
    expect(body.asset.status).toBe('uploaded')
    expect(body.readUrl).toContain('/api/uploads/')
  })
})
