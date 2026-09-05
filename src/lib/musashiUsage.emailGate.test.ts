import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSession, createUser } from '@/lib/musashiAuth'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import { enforceUsage } from '@/lib/musashiUsage'
import type { D1Database } from '@/lib/db'

describe('AI email gate', () => {
  let db: D1Database

  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '0')
    vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
    vi.stubEnv('MUSASHI_SESSION_SECRET', 'email-gate-test-secret')
    vi.stubEnv('MUSASHI_REQUIRE_EMAIL_VERIFIED', '1')
    vi.stubEnv('EMAIL_API_KEY', '')
    db = createMockD1()
    pinMockD1(db)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    unpinMockD1()
  })

  it('rejects before incrementing AI usage', async () => {
    const user = await createUser({
      email: 'unverified@example.com',
      password: 'CorrectHorse1',
      role: 'user',
    })
    expect(user.emailVerifiedAt).toBeNull()
    const { cookieValue } = await createSession(new Request('http://localhost/'), user.id)
    const req = new Request('http://localhost/api/fight', {
      method: 'POST',
      headers: { cookie: `musashi_session=${encodeURIComponent(cookieValue)}` },
    })

    await expect(enforceUsage(req, 'chat')).rejects.toThrow('EMAIL_NOT_VERIFIED')
    const row = await db
      .prepare('SELECT COUNT(*) AS count FROM musashi_usage_daily WHERE user_id = ?')
      .bind(user.id)
      .first<{ count: number }>()
    expect(Number(row?.count || 0)).toBe(0)
  })
})
