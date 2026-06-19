import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/db'

const parseJsonArray = (value: any): string[] => {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
  } catch {
    return []
  }
}

const createNotification = async (userId: string, type: string, title: string, body: string, payload: any) => {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()
  await db
    .prepare(
      'INSERT INTO musashi_notifications (id, user_id, type, title, body, payload, is_read, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
    )
    .bind(id, userId, type, title, body, JSON.stringify(payload), now)
    .run()
}

export async function GET(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const { searchParams } = new URL(req.url)
    const partnerId = searchParams.get('conversationUserId')
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)
    const action = searchParams.get('action')

    const db = getDb()

    if (action === 'mark-read' && partnerId) {
      await db
        .prepare(
          'UPDATE messages SET is_read = 1, read_at = ? WHERE receiver_id = ? AND sender_id = ? AND is_read = 0'
        )
        .bind(new Date().toISOString(), user.id, partnerId)
        .run()
      return NextResponse.json({ success: true })
    }

    if (partnerId) {
      const rows = await db
        .prepare(
          `
          SELECT *
          FROM messages
          WHERE (sender_id = ? AND receiver_id = ?)
             OR (sender_id = ? AND receiver_id = ?)
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?
        `
        )
        .bind(user.id, partnerId, partnerId, user.id, limit, offset)
        .all()

      const messages = (rows.results || []).reverse().map((row: any) => ({
        id: row.id,
        senderId: row.sender_id,
        receiverId: row.receiver_id,
        content: row.content,
        attachments: parseJsonArray(row.attachments),
        messageType: row.message_type || 'text',
        analysisData: row.analysis_data ? JSON.parse(row.analysis_data) : null,
        isRead: Boolean(row.is_read),
        readAt: row.read_at,
        createdAt: row.created_at,
      }))

      return NextResponse.json({ messages })
    }

    const summaryRows = await db
      .prepare(
        `
        WITH partner_messages AS (
          SELECT
            CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS partner_id,
            MAX(created_at) AS last_message_at,
            COUNT(CASE WHEN receiver_id = ? AND is_read = 0 THEN 1 END) AS unread_count
          FROM messages
          WHERE sender_id = ? OR receiver_id = ?
          GROUP BY partner_id
        )
        SELECT
          m.*,
          pm.partner_id,
          pm.unread_count,
          fp.display_name AS partner_name,
          fp.social_links,
          fp.is_verified
        FROM partner_messages pm
        JOIN messages m
          ON ((m.sender_id = ? AND m.receiver_id = pm.partner_id)
           OR (m.receiver_id = ? AND m.sender_id = pm.partner_id))
         AND m.created_at = pm.last_message_at
        LEFT JOIN fighter_profiles fp ON fp.user_id = pm.partner_id
        ORDER BY m.created_at DESC
        LIMIT ? OFFSET ?
      `
      )
      .bind(user.id, user.id, user.id, user.id, user.id, user.id, limit, offset)
      .all()

    const conversations = (summaryRows.results || []).map((row: any) => ({
      partnerId: row.partner_id,
      partnerName: row.partner_name || `User ${row.partner_id.slice(0, 8)}`,
      lastMessage: {
        id: row.id,
        content: row.content,
        createdAt: row.created_at,
        senderId: row.sender_id,
        messageType: row.message_type || 'text',
        hasAnalysis: !!row.analysis_data,
        isRead: Boolean(row.is_read),
      },
      unreadCount: Number(row.unread_count || 0),
      attachments: parseJsonArray(row.attachments),
      isVerified: Boolean(row.is_verified),
    }))

    return NextResponse.json({ conversations })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const body = await req.json() as Record<string, any>
    const receiverId = String(body?.receiverId || '').trim()
    const content = String(body?.content || '').trim()
    const messageType = String(body?.messageType || 'text').trim() // 'text', 'analysis', 'technique', 'scouting'

    if (!receiverId || !content) {
      return NextResponse.json({ error: 'Missing receiver or content' }, { status: 400 })
    }

    if (receiverId === user.id) {
      return NextResponse.json({ error: 'Cannot message yourself' }, { status: 400 })
    }

    const attachments = Array.isArray(body?.attachments) ? body.attachments.map((a: any) => String(a)) : []
    
    // Enhanced attachments for fight analysis sharing
    const analysisData = body?.analysisData ? {
      sessionId: body.analysisData.sessionId,
      kinematics: body.analysisData.kinematics, // Speed, power, accuracy metrics
      techniqueAnalysis: body.analysisData.techniqueAnalysis, // Technique breakdown
      performanceMetrics: body.analysisData.performanceMetrics, // Session stats
      videoFrames: body.analysisData.videoFrames, // Key frames for context
      aiInsights: body.analysisData.aiInsights // Coaching recommendations
    } : null
    
    const db = getDb()
    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    await db
      .prepare(
        `
        INSERT INTO messages (id, sender_id, receiver_id, content, attachments, message_type, analysis_data, is_read, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
      `
      )
      .bind(id, user.id, receiverId, content, JSON.stringify(attachments), messageType, JSON.stringify(analysisData), now)
      .run()

    const receiverRow = await db
      .prepare('SELECT email FROM musashi_users WHERE id = ?')
      .bind(receiverId)
      .first()

    if (receiverRow) {
      const notificationTitle = messageType === 'analysis' ? 'Fight Analysis Shared' : 
                               messageType === 'technique' ? 'Technique Breakthrough' :
                               messageType === 'scouting' ? 'Scouting Report' : 'New Message'
      
      await createNotification(
        receiverId,
        'message',
        notificationTitle,
        `${messageType === 'analysis' ? 'Fight analysis' : 'Message'} from ${user.email}`,
        { messageId: id, senderId: user.id, senderEmail: user.email, messageType, hasAnalysis: !!analysisData }
      )
    }

    return NextResponse.json({
      id,
      senderId: user.id,
      receiverId,
      content,
      attachments,
      messageType,
      analysisData,
      isRead: false,
      createdAt: now,
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const body = await req.json() as Record<string, any>
    const { searchParams } = new URL(req.url)
    const messageId = searchParams.get('id')
    const action = body?.action

    if (!messageId || !action) {
      return NextResponse.json({ error: 'Missing message id or action' }, { status: 400 })
    }

    const db = getDb()

    if (action === 'mark-read') {
      const row = await db
        .prepare('SELECT receiver_id FROM messages WHERE id = ?')
        .bind(messageId)
        .first()

      if (!row || row.receiver_id !== user.id) {
        return NextResponse.json({ error: 'Message not found or not receiver' }, { status: 404 })
      }

      await db
        .prepare('UPDATE messages SET is_read = 1, read_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), messageId)
        .run()

      return NextResponse.json({ success: true })
    }

    if (action === 'delete') {
      const row = await db
        .prepare('SELECT sender_id, receiver_id FROM messages WHERE id = ?')
        .bind(messageId)
        .first()

      if (!row || (row.sender_id !== user.id && row.receiver_id !== user.id)) {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 })
      }

      await db.prepare('DELETE FROM messages WHERE id = ?').bind(messageId).run()

      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to update message' }, { status: 500 })
  }
}
