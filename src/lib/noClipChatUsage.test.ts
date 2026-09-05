import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import {
  consumeNoClipChatQuestion,
  FREE_NO_CLIP_CHAT_DAILY_LIMIT,
  getNoClipChatBalance,
  isNoClipChatRequest,
} from '@/lib/noClipChatUsage'

const USER_ID = 'no-clip-chat-test-user'
const ROLE = 'user' as const

beforeEach(() => {
  vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
  vi.stubEnv('MUSASHI_DISABLE_AUTH', '0')
  vi.stubEnv('NODE_ENV', 'test')
  pinMockD1(createMockD1())
})

afterEach(() => {
  unpinMockD1()
  vi.unstubAllEnvs()
})

describe('no-clip coaching allowance', () => {
  it('persists and enforces three Free questions per UTC day', async () => {
    expect(await getNoClipChatBalance(USER_ID, ROLE)).toMatchObject({
      tier: 'free',
      limit: FREE_NO_CLIP_CHAT_DAILY_LIMIT,
      used: 0,
      remaining: 3,
    })

    for (let i = 0; i < FREE_NO_CLIP_CHAT_DAILY_LIMIT; i++) {
      const balance = await consumeNoClipChatQuestion(USER_ID, ROLE)
      expect(balance.used).toBe(i + 1)
    }

    await expect(consumeNoClipChatQuestion(USER_ID, ROLE)).rejects.toThrow('NO_CLIP_CHAT_QUOTA')
    expect(await getNoClipChatBalance(USER_ID, ROLE)).toMatchObject({ used: 3, remaining: 0 })
  })

  it('does not over-spend when many tabs submit together', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => consumeNoClipChatQuestion(USER_ID, ROLE)),
    )
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(3)
    expect(await getNoClipChatBalance(USER_ID, ROLE)).toMatchObject({ used: 3, remaining: 0 })
  })

  it('does not apply the Free cap to an active Pro subscriber', async () => {
    const db = createMockD1()
    pinMockD1(db)
    await db
      .prepare(
        `INSERT INTO musashi_stripe_subscriptions
          (stripe_subscription_id, user_id, stripe_customer_id, status, current_period_end)
         VALUES (?, ?, ?, 'active', ?)`,
      )
      .bind('sub_no_clip_pro', USER_ID, 'cus_no_clip_pro', '2099-01-01T00:00:00.000Z')
      .run()

    expect(await consumeNoClipChatQuestion(USER_ID, ROLE)).toMatchObject({
      tier: 'pro',
      limit: null,
      remaining: null,
    })
  })
})

describe('isNoClipChatRequest', () => {
  it('requires a real provider video URI to count as clip-grounded chat', () => {
    expect(isNoClipChatRequest('chat', {})).toBe(true)
    expect(isNoClipChatRequest('strategy', { context: { videoFileUri: '' } })).toBe(true)
    expect(isNoClipChatRequest('chat', { context: { videoFileUri: 'files/clip-1' } })).toBe(false)
    expect(isNoClipChatRequest('track', {})).toBe(false)
  })
})
