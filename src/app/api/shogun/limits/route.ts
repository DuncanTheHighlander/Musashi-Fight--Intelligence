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
  const { results } = await db
    .prepare(
      'SELECT u.id, u.email, u.role, l.daily_analyze_limit, l.daily_chat_limit, l.daily_reflex_limit, l.daily_track_limit, l.per_minute_limit, l.updated_at FROM musashi_users u LEFT JOIN musashi_user_limits l ON u.id = l.user_id ORDER BY u.created_at DESC'
    )
    .bind()
    .all()

  return NextResponse.json({ users: results || [] }, { status: 200 })
}

export async function POST(req: Request) {
  try {
    await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as {
    userId?: string
    dailyAnalyze?: number | null
    dailyChat?: number | null
    dailyReflex?: number | null
    dailyTrack?: number | null
    perMinute?: number | null
  }

  const userId = String(body?.userId || '').trim()
  if (!userId) return NextResponse.json({ error: 'Missing userId' }, { status: 400 })

  const db = getDb()
  const now = new Date().toISOString()

  await db
    .prepare(
      'INSERT INTO musashi_user_limits (user_id, daily_analyze_limit, daily_chat_limit, daily_reflex_limit, daily_track_limit, per_minute_limit, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET daily_analyze_limit=excluded.daily_analyze_limit, daily_chat_limit=excluded.daily_chat_limit, daily_reflex_limit=excluded.daily_reflex_limit, daily_track_limit=excluded.daily_track_limit, per_minute_limit=excluded.per_minute_limit, updated_at=excluded.updated_at'
    )
    .bind(
      userId,
      body.dailyAnalyze ?? null,
      body.dailyChat ?? null,
      body.dailyReflex ?? null,
      body.dailyTrack ?? null,
      body.perMinute ?? null,
      now
    )
    .run()

  return NextResponse.json({ ok: true }, { status: 200 })
}
