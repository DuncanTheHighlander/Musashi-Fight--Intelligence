import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { ensureCoachRank } from '@/lib/marketplace/coachRankStore'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import type { D1Database } from '@/lib/db'

describe('POST /api/social/coaches/[id]/review', () => {
  let db: D1Database

  beforeEach(() => {
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '1')
    vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
    db = createMockD1()
    pinMockD1(db)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    unpinMockD1()
  })

  it('returns 401 without auth when bypass disabled', async () => {
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '0')
    vi.stubEnv('MUSASHI_SESSION_SECRET', 'test-secret')

    const res = await POST(
      new Request('http://localhost/api/social/coaches/coach_a/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve' }),
      }),
      { params: Promise.resolve({ id: 'coach_a' }) },
    )

    expect(res.status).toBe(401)
  })

  it('rejects invalid decision', async () => {
    await ensureCoachRank(db, 'coach_a')
    const res = await POST(
      new Request('http://localhost/api/social/coaches/coach_a/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'maybe' }),
      }),
      { params: Promise.resolve({ id: 'coach_a' }) },
    )
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/approve.*hold/i)
  })
})
