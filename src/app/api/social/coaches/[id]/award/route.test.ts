import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { ensureCoachRank } from '@/lib/marketplace/coachRankStore'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import type { D1Database } from '@/lib/db'

describe('POST /api/social/coaches/[id]/award', () => {
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

  it('requires shogun (401 without session when auth enabled)', async () => {
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '0')
    vi.stubEnv('MUSASHI_SESSION_SECRET', 'test-secret')

    const res = await POST(
      new Request('http://localhost/api/social/coaches/coach_a/award', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toBelt: 'blue' }),
      }),
      { params: Promise.resolve({ id: 'coach_a' }) },
    )

    expect(res.status).toBe(401)
  })

  it('rejects invalid belt', async () => {
    await ensureCoachRank(db, 'coach_a')
    const res = await POST(
      new Request('http://localhost/api/social/coaches/coach_a/award', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toBelt: 'not-a-belt' }),
      }),
      { params: Promise.resolve({ id: 'coach_a' }) },
    )
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/invalid belt/i)
  })

  it('awards belt on happy path', async () => {
    await ensureCoachRank(db, 'coach_a')
    const res = await POST(
      new Request('http://localhost/api/social/coaches/coach_a/award', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toBelt: 'blue', notes: 'test award' }),
      }),
      { params: Promise.resolve({ id: 'coach_a' }) },
    )
    const body = (await res.json()) as { earnedBelt?: string }

    expect(res.status).toBe(200)
    expect(body.earnedBelt).toBe('blue')
  })
})
