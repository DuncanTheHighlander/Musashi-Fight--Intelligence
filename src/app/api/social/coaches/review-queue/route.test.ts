import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import type { D1Database } from '@/lib/db'

describe('GET /api/social/coaches/review-queue', () => {
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

    const res = await GET(new Request('http://localhost/api/social/coaches/review-queue'))
    expect(res.status).toBe(401)
  })

  it('returns queue for shogun reviewer', async () => {
    const res = await GET(new Request('http://localhost/api/social/coaches/review-queue'))
    const body = (await res.json()) as { queue?: unknown[] }

    expect(res.status).toBe(200)
    expect(Array.isArray(body.queue)).toBe(true)
  })
})
