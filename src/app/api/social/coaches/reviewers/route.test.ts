import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import type { D1Database } from '@/lib/db'

describe('/api/social/coaches/reviewers', () => {
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

  it('GET returns reviewers for shogun', async () => {
    const res = await GET(new Request('http://localhost/api/social/coaches/reviewers'))
    const body = (await res.json()) as { reviewers?: unknown[] }

    expect(res.status).toBe(200)
    expect(Array.isArray(body.reviewers)).toBe(true)
  })

  it('POST requires userId or email', async () => {
    const res = await POST(
      new Request('http://localhost/api/social/coaches/reviewers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/userId or email/i)
  })

  it('GET returns 401 without auth when bypass disabled', async () => {
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '0')
    vi.stubEnv('MUSASHI_SESSION_SECRET', 'test-secret')

    const res = await GET(new Request('http://localhost/api/social/coaches/reviewers'))
    expect(res.status).toBe(401)
  })
})
