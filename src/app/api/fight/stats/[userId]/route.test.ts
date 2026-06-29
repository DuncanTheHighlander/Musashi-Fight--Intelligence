import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import { buildSessionCookieHeader, createSession, createUser } from '@/lib/musashiAuth'

describe('/api/fight/stats/[userId]', () => {
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
    const user = await createUser({
      email,
      password: 'Password1abc',
      role: 'user',
    })
    const loginReq = new Request('http://localhost/login')
    const { cookieValue } = await createSession(loginReq, user.id)
    return { cookie: buildSessionCookieHeader(cookieValue), user }
  }

  it('returns 403 when requesting another user stats via path param', async () => {
    const victim = await createUser({
      email: 'victim@example.test',
      password: 'Password1abc',
      role: 'user',
    })
    const { cookie } = await sessionCookieFor('attacker@example.test')

    const res = await GET(
      new Request(`http://localhost/api/fight/stats/${victim.id}`, {
        headers: { Cookie: cookie },
      }),
      { params: Promise.resolve({ userId: victim.id }) }
    )

    expect(res.status).toBe(403)
  })

  it('returns 403 when requesting another user stats via query param', async () => {
    const victim = await createUser({
      email: 'victim2@example.test',
      password: 'Password1abc',
      role: 'user',
    })
    const { cookie, user } = await sessionCookieFor('self@example.test')

    const res = await GET(
      new Request(`http://localhost/api/fight/stats/${user.id}?userId=${victim.id}`, {
        headers: { Cookie: cookie },
      }),
      { params: Promise.resolve({ userId: user.id }) }
    )

    expect(res.status).toBe(403)
  })

  it('allows shogun to read another user stats', async () => {
    const victim = await createUser({
      email: 'victim3@example.test',
      password: 'Password1abc',
      role: 'user',
    })
    const shogun = await createUser({
      email: 'shogun-stats@example.test',
      password: 'Password1abc',
      role: 'shogun',
    })
    const loginReq = new Request('http://localhost/login')
    const { cookieValue } = await createSession(loginReq, shogun.id)

    const res = await GET(
      new Request(`http://localhost/api/fight/stats/${victim.id}`, {
        headers: { Cookie: buildSessionCookieHeader(cookieValue) },
      }),
      { params: Promise.resolve({ userId: victim.id }) }
    )

    expect(res.status).toBe(200)
    const body = (await res.json()) as { userId: string }
    expect(body.userId).toBe(victim.id)
  })
})
