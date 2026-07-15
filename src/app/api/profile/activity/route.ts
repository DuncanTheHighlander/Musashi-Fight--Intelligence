import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireUser } from '@/lib/musashiAuth'

type CountRow = { count?: number | string | null }

const countOf = (row: CountRow | null): number => {
  const value = Number(row?.count || 0)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** Authenticated, server-authoritative lifetime activity for the profile card. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const db = getDb()

    const [videos, questions, techniques, sessions] = await Promise.all([
      db
        .prepare('SELECT COUNT(*) AS count FROM musashi_video_clips_consumed WHERE user_id = ?')
        .bind(user.id)
        .first<CountRow>(),
      db
        .prepare('SELECT COALESCE(SUM(chat_count), 0) AS count FROM musashi_usage_daily WHERE user_id = ?')
        .bind(user.id)
        .first<CountRow>(),
      db
        .prepare('SELECT COUNT(*) AS count FROM user_technique_history WHERE user_id = ?')
        .bind(user.id)
        .first<CountRow>(),
      db
        .prepare("SELECT COUNT(*) AS count FROM fight_sessions WHERE user_id = ? AND status = 'completed'")
        .bind(user.id)
        .first<CountRow>(),
    ])

    return NextResponse.json(
      {
        videosAnalyzed: countOf(videos),
        aiQuestions: countOf(questions),
        techniquesTracked: countOf(techniques),
        trainingSessions: countOf(sessions),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    if (/unauthorized|invalid session|no session/i.test(code)) {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    console.error('Failed to load profile activity:', error)
    return NextResponse.json({ error: 'Could not load activity totals' }, { status: 503 })
  }
}
