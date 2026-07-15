import { getDb } from '@/lib/db'
import type { MusashiRole } from '@/lib/musashiAuth'

export const FREE_NO_CLIP_CHAT_DAILY_LIMIT = 3

export type NoClipChatBalance = {
  tier: 'free' | 'pro' | 'shogun'
  limit: number | null
  used: number
  remaining: number | null
  day: string
  resetsAt: string
}

const dayKey = (): string => new Date().toISOString().slice(0, 10)

const nextUtcDay = (): string => {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()
}

const asCount = (value: unknown): number => {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0
}

const resolveTier = async (
  userId: string,
  role: MusashiRole,
): Promise<NoClipChatBalance['tier']> => {
  if (role === 'shogun') return 'shogun'
  const row = await getDb()
    .prepare(
      "SELECT stripe_subscription_id FROM musashi_stripe_subscriptions WHERE user_id = ? AND status IN ('active','trialing') AND (current_period_end IS NULL OR current_period_end >= ?) LIMIT 1",
    )
    .bind(userId, new Date().toISOString())
    .first<{ stripe_subscription_id?: string }>()
  return row?.stripe_subscription_id ? 'pro' : 'free'
}

export const getNoClipChatBalance = async (
  userId: string,
  role: MusashiRole,
): Promise<NoClipChatBalance> => {
  const day = dayKey()
  const tier = await resolveTier(userId, role)
  if (tier !== 'free') {
    return { tier, limit: null, used: 0, remaining: null, day, resetsAt: nextUtcDay() }
  }

  const row = await getDb()
    .prepare('SELECT question_count FROM musashi_no_clip_chat_daily WHERE user_id = ? AND day = ?')
    .bind(userId, day)
    .first<{ question_count?: number }>()
  const used = asCount(row?.question_count)
  return {
    tier,
    limit: FREE_NO_CLIP_CHAT_DAILY_LIMIT,
    used,
    remaining: Math.max(0, FREE_NO_CLIP_CHAT_DAILY_LIMIT - used),
    day,
    resetsAt: nextUtcDay(),
  }
}

/**
 * Atomically spend one Free no-clip question. The conditional upsert prevents
 * simultaneous tabs from exceeding the daily allowance.
 */
export const consumeNoClipChatQuestion = async (
  userId: string,
  role: MusashiRole,
): Promise<NoClipChatBalance> => {
  const balance = await getNoClipChatBalance(userId, role)
  if (balance.tier !== 'free') return balance

  const now = new Date().toISOString()
  const result = await getDb()
    .prepare(
      `INSERT INTO musashi_no_clip_chat_daily (user_id, day, question_count, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id, day) DO UPDATE SET
         question_count = musashi_no_clip_chat_daily.question_count + 1,
         updated_at = excluded.updated_at
       WHERE musashi_no_clip_chat_daily.question_count < ?`,
    )
    .bind(userId, balance.day, now, FREE_NO_CLIP_CHAT_DAILY_LIMIT)
    .run()

  const changes = Number((result as { meta?: { changes?: number } }).meta?.changes || 0)
  if (changes !== 1) throw new Error('NO_CLIP_CHAT_QUOTA')
  return getNoClipChatBalance(userId, role)
}

/** Chat and strategy requests without a provider video URI use this allowance. */
export const isNoClipChatRequest = (action: string, body: unknown): boolean => {
  if (action !== 'chat' && action !== 'strategy') return false
  const context = body && typeof body === 'object'
    ? (body as { context?: unknown }).context
    : null
  const videoFileUri = context && typeof context === 'object'
    ? String((context as { videoFileUri?: unknown }).videoFileUri || '').trim()
    : ''
  return !videoFileUri
}
