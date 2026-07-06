import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import { buildSessionCookieHeader, createSession, createUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'
import { listCoachingFeedback } from '@/lib/coachingFeedbackStore'

describe('/api/fight/coaching-feedback', () => {
  beforeEach(() => {
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '0')
    vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
    vi.stubEnv('MUSASHI_SESSION_SECRET', 'test-session-secret')
    pinMockD1(createMockD1())
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    unpinMockD1()
  })

  async function sessionCookieFor(email: string) {
    const user = await createUser({ email, password: 'Password1abc', role: 'user' })
    const loginReq = new Request('http://localhost/login')
    const { cookieValue } = await createSession(loginReq, user.id)
    return { cookie: buildSessionCookieHeader(cookieValue), user }
  }

  const post = (body: unknown, cookie?: string) =>
    POST(
      new Request('http://localhost/api/fight/coaching-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        body: JSON.stringify(body),
      })
    )

  it('rejects anonymous ratings', async () => {
    const res = await post({ ledgerId: 'ledg_x', rating: 1 })
    expect(res.status).toBe(401)
  })

  it('rejects invalid ratings and missing ledger ids', async () => {
    const { cookie } = await sessionCookieFor('rater1@example.test')
    expect((await post({ ledgerId: 'ledg_x', rating: 0 }, cookie)).status).toBe(400)
    expect((await post({ ledgerId: 'ledg_x', rating: 5 }, cookie)).status).toBe(400)
    expect((await post({ rating: 1 }, cookie)).status).toBe(400)
  })

  it('records a thumbs rating and replaces it on re-rate', async () => {
    const { cookie, user } = await sessionCookieFor('rater2@example.test')

    const up = await post({ ledgerId: 'ledg_abc', rating: 1, aiModel: 'gemini-test', discipline: 'bjj' }, cookie)
    expect(up.status).toBe(200)
    expect(((await up.json()) as { success: boolean }).success).toBe(true)

    // Re-rate: thumbs down replaces the earlier thumbs up (one verdict per user per analysis).
    const down = await post({ ledgerId: 'ledg_abc', rating: -1 }, cookie)
    expect(down.status).toBe(200)

    const rows = await listCoachingFeedback(getDb(), { ledgerId: 'ledg_abc' })
    expect(rows).toHaveLength(1)
    expect(rows[0].rating).toBe(-1)
    expect(rows[0].userId).toBe(user.id)
  })
})
