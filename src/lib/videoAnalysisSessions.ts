import { getDb } from '@/lib/db'
import type { MusashiRole } from '@/lib/musashiAuth'
import {
  enforceVideoAnalysis,
  isProSubscriber,
  resolveVideoTierLimits,
} from '@/lib/musashiUsage'
import { VIDEO_DURATION_TOLERANCE_SEC } from '@/lib/videoTierLimits'

const RESERVATION_MS = 15 * 60 * 1000

export type VideoCreditBalance = {
  limit: number
  used: number
  reserved: number
  remaining: number
  tier: 'free' | 'pro' | 'shogun'
}

type SessionRow = {
  id: string
  state: 'reserved' | 'consumed' | 'released'
  clip_duration_sec: number
  clip_key: string | null
  expires_at: string
}

const weekStartKey = (): string => {
  const now = new Date()
  const day = now.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff))
    .toISOString()
    .slice(0, 10)
}

const isAuthBypass = () =>
  process.env.MUSASHI_DISABLE_AUTH === '1' && process.env.NODE_ENV !== 'production'

const asCount = (value: unknown): number => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}

const validateSessionInput = (sessionId: string, clipDurationSec: number) => {
  if (!/^[A-Za-z0-9_-]{12,160}$/.test(sessionId)) throw new Error('VIDEO_SESSION_REQUIRED')
  if (!Number.isFinite(clipDurationSec) || clipDurationSec <= 0) {
    throw new Error('VIDEO_CONTEXT_REQUIRED')
  }
}

const resolveTier = async (userId: string, role: MusashiRole) => {
  if (role === 'shogun') return 'shogun' as const
  return (await isProSubscriber(userId, role)) ? 'pro' as const : 'free' as const
}

export const getVideoCreditBalance = async (
  userId: string,
  role: MusashiRole,
): Promise<VideoCreditBalance> => {
  if (isAuthBypass() || role === 'shogun') {
    return { limit: 10_000, used: 0, reserved: 0, remaining: 10_000, tier: 'shogun' }
  }

  const db = getDb()
  const tier = await resolveTier(userId, role)
  const limits = await resolveVideoTierLimits(userId, role)
  const now = new Date().toISOString()

  if (tier === 'free') {
    const [usage, holds] = await Promise.all([
      db.prepare('SELECT free_videos_used FROM musashi_video_lifetime WHERE user_id = ?').bind(userId).first(),
      db.prepare("SELECT COUNT(*) AS c FROM musashi_video_analysis_sessions WHERE user_id = ? AND state = 'reserved' AND tier = 'free' AND expires_at > ?").bind(userId, now).first(),
    ])
    const used = asCount(usage?.free_videos_used)
    const reserved = asCount(holds?.c)
    const limit = limits.lifetimeFreeVideos
    return { limit, used, reserved, remaining: Math.max(0, limit - used - reserved), tier }
  }

  const weekStart = weekStartKey()
  const [usage, holds] = await Promise.all([
    db.prepare('SELECT video_count FROM musashi_video_weekly WHERE user_id = ? AND week_start = ?').bind(userId, weekStart).first(),
    db.prepare("SELECT COUNT(*) AS c FROM musashi_video_analysis_sessions WHERE user_id = ? AND state = 'reserved' AND tier = 'pro' AND week_start = ? AND expires_at > ?").bind(userId, weekStart, now).first(),
  ])
  const used = asCount(usage?.video_count)
  const reserved = asCount(holds?.c)
  const limit = limits.weeklyVideos
  return { limit, used, reserved, remaining: Math.max(0, limit - used - reserved), tier }
}

/** Reserve one credit for an upload attempt. Reusing a session id is idempotent. */
export const reserveVideoAnalysisCredit = async (
  userId: string,
  role: MusashiRole,
  input: { sessionId: string; clipDurationSec: number },
): Promise<VideoCreditBalance> => {
  const sessionId = String(input.sessionId || '').trim()
  const clipDurationSec = Number(input.clipDurationSec)
  validateSessionInput(sessionId, clipDurationSec)

  if (isAuthBypass()) return getVideoCreditBalance(userId, role)

  const limits = await resolveVideoTierLimits(userId, role)
  if (clipDurationSec > limits.maxDurationSec + VIDEO_DURATION_TOLERANCE_SEC) {
    throw new Error('VIDEO_DURATION_EXCEEDED')
  }

  const db = getDb()
  const existing = await db
    .prepare('SELECT id, state, clip_duration_sec, expires_at FROM musashi_video_analysis_sessions WHERE id = ? AND user_id = ?')
    .bind(sessionId, userId)
    .first<SessionRow>()
  if (existing?.state === 'consumed') return getVideoCreditBalance(userId, role)
  if (existing?.state === 'reserved' && new Date(existing.expires_at).getTime() > Date.now()) {
    return getVideoCreditBalance(userId, role)
  }

  const balance = await getVideoCreditBalance(userId, role)
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + RESERVATION_MS).toISOString()
  const weekStart = balance.tier === 'pro' ? weekStartKey() : null
  if (balance.tier === 'shogun') {
    await db
      .prepare(
        `INSERT INTO musashi_video_analysis_sessions
          (id, user_id, state, tier, clip_duration_sec, week_start, reserved_at, expires_at)
         VALUES (?, ?, 'reserved', ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           state = 'reserved', tier = excluded.tier, clip_duration_sec = excluded.clip_duration_sec,
           week_start = excluded.week_start, reserved_at = excluded.reserved_at,
           expires_at = excluded.expires_at, clip_key = NULL, consumed_at = NULL,
           released_at = NULL, failure_code = NULL`,
      )
      .bind(sessionId, userId, balance.tier, clipDurationSec, weekStart, now, expiresAt)
      .run()
    return getVideoCreditBalance(userId, role)
  }

  // This is one conditional write, so simultaneous tabs cannot reserve more
  // credits than the tier cap between a separate SELECT and INSERT.
  const usageSql = balance.tier === 'free'
    ? "COALESCE((SELECT free_videos_used FROM musashi_video_lifetime WHERE user_id = ?), 0) + (SELECT COUNT(*) FROM musashi_video_analysis_sessions WHERE user_id = ? AND state = 'reserved' AND tier = 'free' AND expires_at > ?)"
    : "COALESCE((SELECT video_count FROM musashi_video_weekly WHERE user_id = ? AND week_start = ?), 0) + (SELECT COUNT(*) FROM musashi_video_analysis_sessions WHERE user_id = ? AND state = 'reserved' AND tier = 'pro' AND week_start = ? AND expires_at > ?)"
  const usageParams = balance.tier === 'free'
    ? [userId, userId, now]
    : [userId, weekStart, userId, weekStart, now]
  const limit = balance.limit

  let changes = 0
  if (existing) {
    const result = await db
      .prepare(
        `UPDATE musashi_video_analysis_sessions
            SET state = 'reserved', tier = ?, clip_duration_sec = ?, week_start = ?,
                reserved_at = ?, expires_at = ?, clip_key = NULL, consumed_at = NULL,
                released_at = NULL, failure_code = NULL
          WHERE id = ? AND user_id = ?
            AND (state = 'released' OR expires_at <= ?)
            AND (${usageSql}) < ?`,
      )
      .bind(
        balance.tier, clipDurationSec, weekStart, now, expiresAt, sessionId, userId, now,
        ...usageParams, limit,
      )
      .run()
    changes = Number((result as { meta?: { changes?: number } }).meta?.changes || 0)
  } else {
    const result = await db
      .prepare(
        `INSERT INTO musashi_video_analysis_sessions
          (id, user_id, state, tier, clip_duration_sec, week_start, reserved_at, expires_at)
         SELECT ?, ?, 'reserved', ?, ?, ?, ?, ?
          WHERE (${usageSql}) < ?`,
      )
      .bind(sessionId, userId, balance.tier, clipDurationSec, weekStart, now, expiresAt, ...usageParams, limit)
      .run()
    changes = Number((result as { meta?: { changes?: number } }).meta?.changes || 0)
  }

  if (changes !== 1) {
    throw new Error(balance.tier === 'free' ? 'FREE_VIDEO_QUOTA' : 'WEEKLY_VIDEO_QUOTA')
  }

  return getVideoCreditBalance(userId, role)
}

/** Commit only after the provider returns a usable native-video file. */
export const commitVideoAnalysisCredit = async (
  userId: string,
  role: MusashiRole,
  input: { sessionId: string; clipKey: string },
): Promise<VideoCreditBalance> => {
  const sessionId = String(input.sessionId || '').trim()
  const clipKey = String(input.clipKey || '').trim().slice(0, 256)
  if (!sessionId || !clipKey) throw new Error('VIDEO_CONTEXT_REQUIRED')

  if (isAuthBypass()) return getVideoCreditBalance(userId, role)

  const db = getDb()
  const session = await db
    .prepare('SELECT id, state, clip_duration_sec, clip_key, expires_at FROM musashi_video_analysis_sessions WHERE id = ? AND user_id = ?')
    .bind(sessionId, userId)
    .first<SessionRow>()
  if (!session) throw new Error('VIDEO_SESSION_REQUIRED')
  if (session.state === 'consumed') return getVideoCreditBalance(userId, role)
  if (session.state !== 'reserved' || new Date(session.expires_at).getTime() <= Date.now()) {
    await releaseVideoAnalysisCredit(userId, sessionId, 'VIDEO_ANALYSIS_SESSION_EXPIRED')
    throw new Error('VIDEO_ANALYSIS_SESSION_EXPIRED')
  }

  // Claim the commit before touching the legacy usage counters. Without this
  // conditional write, two simultaneous retries can both observe `reserved`
  // and charge the same clip twice before either marks the session consumed.
  const claimed = await db
    .prepare(
      `UPDATE musashi_video_analysis_sessions
          SET clip_key = ?
        WHERE id = ? AND user_id = ? AND state = 'reserved'
          AND clip_key IS NULL AND expires_at > ?`,
    )
    .bind(clipKey, sessionId, userId, new Date().toISOString())
    .run()
  const claimChanges = Number((claimed as { meta?: { changes?: number } }).meta?.changes || 0)
  if (claimChanges !== 1) {
    const current = await db
      .prepare('SELECT state FROM musashi_video_analysis_sessions WHERE id = ? AND user_id = ?')
      .bind(sessionId, userId)
      .first<{ state?: string }>()
    if (current?.state === 'consumed') return getVideoCreditBalance(userId, role)
    throw new Error('VIDEO_ANALYSIS_SESSION_BUSY')
  }

  try {
    // Existing clip-key dedupe protects retries and all later chat/stream calls.
    await enforceVideoAnalysis(userId, role, {
      clipDurationSec: Number(session.clip_duration_sec),
      clipKey,
    })
  } catch (error) {
    await releaseVideoAnalysisCredit(userId, sessionId, error instanceof Error ? error.message : 'VIDEO_ANALYSIS_FAILED')
    throw error
  }

  await db
    .prepare("UPDATE musashi_video_analysis_sessions SET state = 'consumed', consumed_at = ?, failure_code = NULL WHERE id = ? AND user_id = ? AND state = 'reserved' AND clip_key = ?")
    .bind(new Date().toISOString(), sessionId, userId, clipKey)
    .run()
  return getVideoCreditBalance(userId, role)
}

/** Failed provider uploads explicitly release their hold; they never use a credit. */
export const releaseVideoAnalysisCredit = async (
  userId: string,
  sessionId: string,
  failureCode = 'VIDEO_ANALYSIS_FAILED',
): Promise<void> => {
  if (isAuthBypass()) return
  await getDb()
    .prepare("UPDATE musashi_video_analysis_sessions SET state = 'released', clip_key = NULL, released_at = ?, failure_code = ? WHERE id = ? AND user_id = ? AND state = 'reserved'")
    .bind(new Date().toISOString(), failureCode.slice(0, 120), sessionId, userId)
    .run()
}
