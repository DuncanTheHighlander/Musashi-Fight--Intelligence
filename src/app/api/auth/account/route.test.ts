import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DELETE } from './route'
import { createSession, createUser } from '@/lib/musashiAuth'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import type { D1Database } from '@/lib/db'

const PASSWORD = 'CorrectHorse1'

const makeUser = async (db: D1Database, email = 'fighter@example.com') => {
  const user = await createUser({ email, password: PASSWORD, role: 'user' })
  const { cookieValue } = await createSession(new Request('http://localhost/'), user.id)
  return { user, cookieValue }
}

const deleteRequest = (cookieValue: string | null, password: string | undefined) =>
  new Request('http://localhost/api/auth/account', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      ...(cookieValue ? { cookie: `musashi_session=${encodeURIComponent(cookieValue)}` } : {}),
    },
    body: JSON.stringify(password === undefined ? {} : { password }),
  })

describe('DELETE /api/auth/account', () => {
  let db: D1Database

  beforeEach(() => {
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '0')
    vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
    vi.stubEnv('MUSASHI_SESSION_SECRET', 'test-secret')
    db = createMockD1()
    pinMockD1(db)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    unpinMockD1()
  })

  it('returns 401 without a session', async () => {
    const res = await DELETE(deleteRequest(null, PASSWORD))
    expect(res.status).toBe(401)
  })

  it('rejects admin (shogun) self-deletion', async () => {
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '1') // dev bypass user has role shogun
    const res = await DELETE(deleteRequest(null, PASSWORD))
    expect(res.status).toBe(403)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toMatch(/admin/i)
  })

  it('requires password confirmation', async () => {
    const { cookieValue } = await makeUser(db)
    const res = await DELETE(deleteRequest(cookieValue, undefined))
    expect(res.status).toBe(400)
  })

  it('rejects an incorrect password', async () => {
    const { user, cookieValue } = await makeUser(db)
    const res = await DELETE(deleteRequest(cookieValue, 'WrongPassword1'))
    expect(res.status).toBe(403)

    const row = await db.prepare('SELECT id FROM musashi_users WHERE id = ?').bind(user.id).first()
    expect(row?.id).toBe(user.id)
  })

  it('blocks deletion while marketplace funds are in escrow', async () => {
    const { user, cookieValue } = await makeUser(db)
    const now = new Date().toISOString()
    await db
      .prepare(
        `INSERT INTO marketplace_jobs (id, fighter_id, job_type, title, status, created_at, updated_at)
         VALUES ('job_escrow', ?, 'direct_hire', 'Breakdown', 'FUNDED', ?, ?)`,
      )
      .bind(user.id, now, now)
      .run()

    const res = await DELETE(deleteRequest(cookieValue, PASSWORD))
    expect(res.status).toBe(409)
    const body = (await res.json()) as { error?: string }
    expect(body.error).toMatch(/escrow/i)
  })

  it('deletes the account, revokes sessions, anonymizes the legacy row, clears the cookie', async () => {
    const { user, cookieValue } = await makeUser(db)

    const res = await DELETE(deleteRequest(cookieValue, PASSWORD))
    expect(res.status).toBe(200)
    expect(res.headers.get('Set-Cookie')).toContain('musashi_session=;')

    const authRow = await db.prepare('SELECT id FROM musashi_users WHERE id = ?').bind(user.id).first()
    expect(authRow).toBeFalsy()

    const session = await db
      .prepare('SELECT revoked_at FROM musashi_sessions WHERE user_id = ? LIMIT 1')
      .bind(user.id)
      .first()
    if (session) expect(session.revoked_at).toBeTruthy()

    const legacy = await db.prepare('SELECT email FROM users WHERE id = ?').bind(user.id).first()
    if (legacy) expect(String(legacy.email)).toContain('deleted+')

    // Deleted credentials must no longer authenticate a fresh request.
    const again = await DELETE(deleteRequest(cookieValue, PASSWORD))
    expect(again.status).toBe(401)
  })
})
