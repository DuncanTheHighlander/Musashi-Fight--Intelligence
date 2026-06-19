import { requireUser, type MusashiRole } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

export type MusashiAction = 'analyze' | 'chat' | 'reflex' | 'track'

type Limits = {
  perMinute: number
  dailyAnalyze: number
  dailyChat: number
  dailyReflex: number
  dailyTrack: number
}

const paidLimits: Limits = {
  perMinute: 60,
  dailyAnalyze: 250,
  dailyChat: 3000,
  dailyReflex: 3000,
  dailyTrack: 3000,
}

const defaultLimitsForRole = (role: MusashiRole): Limits => {
  if (role === 'shogun') {
    return {
      perMinute: 240,
      dailyAnalyze: 10_000,
      dailyChat: 50_000,
      dailyReflex: 50_000,
      dailyTrack: 50_000,
    }
  }

  return {
    perMinute: 30,
    dailyAnalyze: 60,
    dailyChat: 600,
    dailyReflex: 600,
    dailyTrack: 600,
  }
}

const getDayKey = (): string => {
  return new Date().toISOString().slice(0, 10)
}

const getMinuteBucket = (): number => {
  return Math.floor(Date.now() / 60_000)
}

const loadOverrides = async (userId: string): Promise<Partial<Limits>> => {
  const db = getDb()
  const row = await db
    .prepare(
      'SELECT daily_analyze_limit, daily_chat_limit, daily_reflex_limit, daily_track_limit, per_minute_limit FROM musashi_user_limits WHERE user_id = ?'
    )
    .bind(userId)
    .first()

  if (!row) return {}

  const out: Partial<Limits> = {}
  if (row.per_minute_limit != null) out.perMinute = Number(row.per_minute_limit)
  if (row.daily_analyze_limit != null) out.dailyAnalyze = Number(row.daily_analyze_limit)
  if (row.daily_chat_limit != null) out.dailyChat = Number(row.daily_chat_limit)
  if (row.daily_reflex_limit != null) out.dailyReflex = Number(row.daily_reflex_limit)
  if (row.daily_track_limit != null) out.dailyTrack = Number(row.daily_track_limit)
  return out
}

const resolveLimits = async (userId: string, role: MusashiRole): Promise<Limits> => {
  let base = defaultLimitsForRole(role)
  if (role === 'user') {
    try {
      const db = getDb()
      const nowIso = new Date().toISOString()
      const row = await db
        .prepare(
          "SELECT stripe_subscription_id FROM musashi_stripe_subscriptions WHERE user_id = ? AND status IN ('active','trialing') AND (current_period_end IS NULL OR current_period_end >= ?) LIMIT 1"
        )
        .bind(userId, nowIso)
        .first()

      if (row?.stripe_subscription_id) {
        base = paidLimits
      }
    } catch {
      void 0
    }
  }
  const overrides = await loadOverrides(userId)
  return {
    perMinute: Number.isFinite(overrides.perMinute as number) ? Math.max(1, overrides.perMinute as number) : base.perMinute,
    dailyAnalyze: Number.isFinite(overrides.dailyAnalyze as number)
      ? Math.max(0, overrides.dailyAnalyze as number)
      : base.dailyAnalyze,
    dailyChat: Number.isFinite(overrides.dailyChat as number) ? Math.max(0, overrides.dailyChat as number) : base.dailyChat,
    dailyReflex: Number.isFinite(overrides.dailyReflex as number)
      ? Math.max(0, overrides.dailyReflex as number)
      : base.dailyReflex,
    dailyTrack: Number.isFinite(overrides.dailyTrack as number) ? Math.max(0, overrides.dailyTrack as number) : base.dailyTrack,
  }
}

const enforceRateLimit = async (userId: string, perMinute: number) => {
  const db = getDb()
  const bucket = getMinuteBucket()

  const row = await db
    .prepare('SELECT count FROM musashi_rate_limit_minute WHERE user_id = ? AND bucket_minute = ?')
    .bind(userId, bucket)
    .first()

  const count = row?.count != null ? Number(row.count) : 0
  if (count >= perMinute) {
    throw new Error('RATE_LIMIT')
  }

  const now = new Date().toISOString()
  await db
    .prepare(
      'INSERT INTO musashi_rate_limit_minute (user_id, bucket_minute, count, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id, bucket_minute) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at'
    )
    .bind(userId, bucket, now)
    .run()
}

const usageColumnForAction = (action: MusashiAction) => {
  if (action === 'analyze') return 'analyze_count'
  if (action === 'chat') return 'chat_count'
  if (action === 'reflex') return 'reflex_count'
  return 'track_count'
}

const dailyLimitForAction = (limits: Limits, action: MusashiAction) => {
  if (action === 'analyze') return limits.dailyAnalyze
  if (action === 'chat') return limits.dailyChat
  if (action === 'reflex') return limits.dailyReflex
  return limits.dailyTrack
}

const enforceDailyUsage = async (userId: string, limits: Limits, action: MusashiAction) => {
  const db = getDb()
  const day = getDayKey()
  const col = usageColumnForAction(action)

  const row = await db
    .prepare(`SELECT ${col} as c FROM musashi_usage_daily WHERE user_id = ? AND day = ?`)
    .bind(userId, day)
    .first()

  const count = row?.c != null ? Number(row.c) : 0
  const max = dailyLimitForAction(limits, action)

  if (count >= max) {
    throw new Error('DAILY_QUOTA')
  }

  const now = new Date().toISOString()

  await db
    .prepare(
      'INSERT INTO musashi_usage_daily (user_id, day, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET updated_at = excluded.updated_at'
    )
    .bind(userId, day, now)
    .run()

  await db
    .prepare(`UPDATE musashi_usage_daily SET ${col} = ${col} + 1, updated_at = ? WHERE user_id = ? AND day = ?`)
    .bind(now, userId, day)
    .run()
}

export const enforceUsage = async (req: Request, action: MusashiAction) => {
  if (process.env.MUSASHI_DISABLE_AUTH === '1') {
    return {
      id: 'dev',
      email: 'dev@local',
      role: 'shogun' as MusashiRole,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  const user = await requireUser(req)
  const limits = await resolveLimits(user.id, user.role)

  await enforceRateLimit(user.id, limits.perMinute)
  await enforceDailyUsage(user.id, limits, action)

  return user
}
