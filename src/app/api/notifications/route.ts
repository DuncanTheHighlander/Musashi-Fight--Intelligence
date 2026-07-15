import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const { searchParams } = new URL(req.url)
    const unreadOnly = searchParams.get('unread') === 'true'
    const limit = Math.min(Number(searchParams.get('limit') || 20), 100)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

    const db = getDb()
    const where = unreadOnly ? 'WHERE is_read = 0' : ''
    
    const rows = await db
      .prepare(
        `
        SELECT id, type, title, body, payload, is_read, created_at, read_at
        FROM musashi_notifications
        WHERE user_id = ? ${unreadOnly ? 'AND is_read = 0' : ''}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        `
      )
      .bind(user.id, limit, offset)
      .all()

    const notifications = (rows.results || []).map((row: any) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : {},
      isRead: Boolean(row.is_read),
      createdAt: row.created_at,
      readAt: row.read_at,
    }))

    const unreadCountRow = await db
      .prepare('SELECT COUNT(*) as count FROM musashi_notifications WHERE user_id = ? AND is_read = 0')
      .bind(user.id)
      .first()

    const unreadCount = Number(unreadCountRow?.count || 0)

    return NextResponse.json({ notifications, unreadCount })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to fetch notifications' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json() as Record<string, any>
    const { searchParams } = new URL(req.url)
    const notificationId = searchParams.get('id')
    const action = body?.action

    if (!notificationId || !action) {
      return NextResponse.json({ error: 'Missing notification id or action' }, { status: 400 })
    }

    const db = getDb()

    if (action === 'mark-read') {
      const row = await db
        .prepare('SELECT user_id FROM musashi_notifications WHERE id = ?')
        .bind(notificationId)
        .first()

      if (!row || row.user_id !== user.id) {
        return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
      }

      await db
        .prepare('UPDATE musashi_notifications SET is_read = 1, read_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), notificationId)
        .run()

      return NextResponse.json({ success: true })
    }

    if (action === 'mark-all-read') {
      await db
        .prepare('UPDATE musashi_notifications SET is_read = 1, read_at = ? WHERE user_id = ? AND is_read = 0')
        .bind(new Date().toISOString(), user.id)
        .run()

      return NextResponse.json({ success: true })
    }

    if (action === 'delete') {
      const row = await db
        .prepare('SELECT user_id FROM musashi_notifications WHERE id = ?')
        .bind(notificationId)
        .first()

      if (!row || row.user_id !== user.id) {
        return NextResponse.json({ error: 'Notification not found' }, { status: 404 })
      }

      await db
        .prepare('DELETE FROM musashi_notifications WHERE id = ?')
        .bind(notificationId)
        .run()

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to update notification' }, { status: 500 })
  }
}
