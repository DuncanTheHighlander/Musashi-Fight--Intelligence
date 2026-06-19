import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json() as {
      title?: string
      description?: string
      ruleset?: string
      opponentId?: string
    }

    const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    const db = getDb()
    await db.prepare(`
      INSERT INTO fight_sessions (
        id, user_id, title, description, ruleset, status, opponent_id
      ) VALUES (?, ?, ?, ?, ?, 'active', ?)
    `).bind(
      sessionId,
      user.id,
      body.title || null,
      body.description || null,
      body.ruleset || 'training',
      body.opponentId || null
    ).run()

    return NextResponse.json({
      sessionId,
      status: 'active',
      startTime: new Date().toISOString()
    })
  } catch (error) {
    console.error('Failed to create fight session:', error)
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'active'
    const limit = parseInt(searchParams.get('limit') || '10')
    const offset = parseInt(searchParams.get('offset') || '0')

    const db = getDb()
    const sessions = await db.prepare(`
      SELECT 
        id, title, description, ruleset, status, 
        start_time, end_time, duration_seconds, opponent_id,
        created_at, updated_at
      FROM fight_sessions 
      WHERE user_id = ? AND status = ?
      ORDER BY start_time DESC
      LIMIT ? OFFSET ?
    `).bind(user.id, status, limit, offset).all()

    return NextResponse.json({ sessions })
  } catch (error) {
    console.error('Failed to fetch fight sessions:', error)
    return NextResponse.json({ error: 'Failed to fetch sessions' }, { status: 500 })
  }
}
