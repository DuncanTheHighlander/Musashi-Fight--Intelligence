import { getDb } from '@/lib/db'
import { isProSubscriber } from '@/lib/musashiUsage'
import type { MusashiRole } from '@/lib/musashiAuth'

export type AdminUserRow = {
  id: string
  email: string
  role: string
  created_at: string
  email_verified_at: string | null
  account_status: string
  status_reason: string | null
  support_notes: string | null
  comp_pro_until: string | null
  bonus_video_credits: number
  consent_ai_training: number
  consent_at: string | null
  consent_privacy_version: string | null
  videos_analyzed: number
  last_analysis_at: string | null
  is_pro: number
  free_videos_used: number
}

const nowIso = () => new Date().toISOString()

export async function listAdminUsers(): Promise<AdminUserRow[]> {
  const db = getDb()
  const now = nowIso()
  const { results } = await db
    .prepare(
      `SELECT
         u.id,
         u.email,
         u.role,
         u.created_at,
         u.email_verified_at,
         COALESCE(u.account_status, 'active') AS account_status,
         u.status_reason,
         u.support_notes,
         u.comp_pro_until,
         COALESCE(u.bonus_video_credits, 0) AS bonus_video_credits,
         COALESCE(u.consent_ai_training, 0) AS consent_ai_training,
         u.consent_at,
         u.consent_privacy_version,
         COALESCE(v.consumed_count, 0) AS videos_analyzed,
         v.last_analysis_at,
         CASE
           WHEN u.role = 'shogun' THEN 1
           WHEN u.comp_pro_until IS NOT NULL AND u.comp_pro_until >= ? THEN 1
           WHEN s.user_id IS NOT NULL THEN 1
           ELSE 0
         END AS is_pro,
         COALESCE(lt.free_videos_used, 0) AS free_videos_used
       FROM musashi_users u
       LEFT JOIN (
         SELECT user_id,
                COUNT(*) AS consumed_count,
                MAX(consumed_at) AS last_analysis_at
         FROM musashi_video_analysis_sessions
         WHERE state = 'consumed'
         GROUP BY user_id
       ) v ON v.user_id = u.id
       LEFT JOIN (
         SELECT DISTINCT user_id
         FROM musashi_stripe_subscriptions
         WHERE status IN ('active', 'trialing')
           AND (current_period_end IS NULL OR current_period_end >= ?)
       ) s ON s.user_id = u.id
       LEFT JOIN musashi_video_lifetime lt ON lt.user_id = u.id
       ORDER BY u.created_at DESC`,
    )
    .bind(now, now)
    .all()

  return (results || []) as AdminUserRow[]
}

export async function getAdminUser(userId: string): Promise<AdminUserRow | null> {
  const rows = await listAdminUsers()
  return rows.find((u) => u.id === userId) || null
}

export async function assertUserNotBanned(userId: string, role: MusashiRole): Promise<void> {
  if (role === 'shogun') return
  try {
    const db = getDb()
    const row = await db
      .prepare('SELECT account_status FROM musashi_users WHERE id = ?')
      .bind(userId)
      .first<{ account_status: string | null }>()
    const status = String(row?.account_status || 'active')
    if (status === 'banned' || status === 'suspended') {
      throw new Error(status === 'banned' ? 'ACCOUNT_BANNED' : 'ACCOUNT_SUSPENDED')
    }
  } catch (e) {
    if (e instanceof Error && (e.message === 'ACCOUNT_BANNED' || e.message === 'ACCOUNT_SUSPENDED')) {
      throw e
    }
  }
}

export async function hasCompPro(userId: string): Promise<boolean> {
  try {
    const db = getDb()
    const row = await db
      .prepare('SELECT comp_pro_until FROM musashi_users WHERE id = ?')
      .bind(userId)
      .first<{ comp_pro_until: string | null }>()
    const until = row?.comp_pro_until
    return Boolean(until && String(until) >= nowIso())
  } catch {
    return false
  }
}

export async function grantBonusCredits(userId: string, amount: number): Promise<number> {
  const n = Math.max(0, Math.floor(amount))
  if (!n) return 0
  const db = getDb()
  const now = nowIso()
  await db
    .prepare(
      `UPDATE musashi_users
       SET bonus_video_credits = COALESCE(bonus_video_credits, 0) + ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(n, now, userId)
    .run()
  // Also claw back spent free lifetime credits when possible (instant relief for free users).
  await db
    .prepare(
      `UPDATE musashi_video_lifetime
       SET free_videos_used = MAX(0, free_videos_used - ?), updated_at = ?
       WHERE user_id = ?`,
    )
    .bind(n, now, userId)
    .run()
  const row = await db
    .prepare('SELECT COALESCE(bonus_video_credits, 0) AS c FROM musashi_users WHERE id = ?')
    .bind(userId)
    .first<{ c: number }>()
  return Number(row?.c || 0)
}

export async function effectiveIsPro(userId: string, role: MusashiRole): Promise<boolean> {
  if (await isProSubscriber(userId, role)) return true
  return hasCompPro(userId)
}
