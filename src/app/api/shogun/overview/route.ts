/**
 * GET /api/shogun/overview — admin dashboard stats. Shogun-only.
 *
 * Totals plus one row per user: tier (pro = active/trialing Stripe sub),
 * successful video analyses (consumed sessions), verification and signup info.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

export async function GET(req: Request) {
  try {
    await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getDb()
  const nowIso = new Date().toISOString()

  const { results } = await db
    .prepare(
      `SELECT
         u.id,
         u.email,
         u.role,
         u.created_at,
         u.email_verified_at,
         COALESCE(v.consumed_count, 0) AS videos_analyzed,
         v.last_analysis_at,
         CASE WHEN s.user_id IS NOT NULL THEN 1 ELSE 0 END AS is_pro
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
       ORDER BY u.created_at DESC`
    )
    .bind(nowIso)
    .all()

  const users = (results || []) as Array<{
    id: string
    email: string
    role: string
    created_at: string
    email_verified_at: string | null
    videos_analyzed: number
    last_analysis_at: string | null
    is_pro: number
  }>

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const totals = {
    users: users.length,
    verified: users.filter((u) => u.email_verified_at).length,
    pro: users.filter((u) => u.is_pro === 1).length,
    videosAnalyzed: users.reduce((sum, u) => sum + Number(u.videos_analyzed || 0), 0),
    activeLast7d: users.filter((u) => u.last_analysis_at && u.last_analysis_at >= sevenDaysAgo).length,
  }

  return NextResponse.json({ totals, users }, { status: 200 })
}
