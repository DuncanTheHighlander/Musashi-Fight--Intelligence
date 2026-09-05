import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from './route'
import { createSession, createUser } from '@/lib/musashiAuth'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import type { D1Database } from '@/lib/db'

const PASSWORD = 'CorrectHorse1'

describe('GET /api/profile/activity', () => {
  let db: D1Database

  beforeEach(() => {
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '0')
    vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
    vi.stubEnv('MUSASHI_SESSION_SECRET', 'profile-activity-test-secret')
    vi.stubEnv('NODE_ENV', 'test')
    db = createMockD1()
    pinMockD1(db)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    unpinMockD1()
  })

  it('requires a signed-in user', async () => {
    const res = await GET(new Request('http://localhost/api/profile/activity'))
    expect(res.status).toBe(401)
  })

  it('returns real per-user lifetime totals', async () => {
    const user = await createUser({
      email: 'activity@example.com',
      password: PASSWORD,
      role: 'user',
    })
    const { cookieValue } = await createSession(new Request('http://localhost/'), user.id)
    const now = new Date().toISOString()

    await db
      .prepare('INSERT INTO musashi_video_clips_consumed (user_id, clip_key, consumed_at) VALUES (?, ?, ?)')
      .bind(user.id, 'files/clip-one', now)
      .run()
    await db
      .prepare('INSERT INTO musashi_video_clips_consumed (user_id, clip_key, consumed_at) VALUES (?, ?, ?)')
      .bind(user.id, 'files/clip-two', now)
      .run()
    await db
      .prepare('INSERT INTO musashi_usage_daily (user_id, day, chat_count, updated_at) VALUES (?, ?, 4, ?)')
      .bind(user.id, '2026-07-12', now)
      .run()
    await db
      .prepare('INSERT INTO user_technique_history (id, user_id, technique_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .bind('history-one', user.id, 'jab', now, now)
      .run()
    await db
      .prepare("INSERT INTO fight_sessions (id, user_id, status, ruleset, created_at, updated_at) VALUES (?, ?, 'completed', 'boxing', ?, ?)")
      .bind('completed-session', user.id, now, now)
      .run()
    await db
      .prepare("INSERT INTO fight_sessions (id, user_id, status, ruleset, created_at, updated_at) VALUES (?, ?, 'active', 'boxing', ?, ?)")
      .bind('active-session', user.id, now, now)
      .run()

    const res = await GET(
      new Request('http://localhost/api/profile/activity', {
        headers: { cookie: `musashi_session=${encodeURIComponent(cookieValue)}` },
      }),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(await res.json()).toEqual({
      videosAnalyzed: 2,
      aiQuestions: 4,
      techniquesTracked: 1,
      trainingSessions: 1,
    })
  })
})
