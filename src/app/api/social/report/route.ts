import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { requireUser } from '@/lib/musashiAuth'

type ReportBody = {
  targetType?: string
  targetId?: string
  reason?: string
  details?: string
}

const TARGET_TYPES = new Set(['job', 'profile', 'message', 'product', 'other'])
const REASONS = new Set(['spam', 'harassment', 'inappropriate', 'scam', 'ip', 'other'])

/** POST /api/social/report — flag marketplace / social UGC for admin review. */
export async function POST(req: Request) {
  let user
  try {
    user = await requireUser(req)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: ReportBody
  try {
    body = (await req.json()) as ReportBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const targetType = String(body.targetType || '').trim()
  const targetId = String(body.targetId || '').trim().slice(0, 128)
  const reason = String(body.reason || '').trim()
  const details = body.details ? String(body.details).trim().slice(0, 2000) : null

  if (!TARGET_TYPES.has(targetType)) {
    return NextResponse.json({ error: 'Invalid targetType' }, { status: 400 })
  }
  if (!targetId) {
    return NextResponse.json({ error: 'targetId is required' }, { status: 400 })
  }
  if (!REASONS.has(reason)) {
    return NextResponse.json({ error: 'Invalid reason' }, { status: 400 })
  }

  try {
    const db = getDb()
    const id = crypto.randomUUID()
    await db
      .prepare(
        `INSERT INTO musashi_content_reports
          (id, reporter_user_id, target_type, target_id, reason, details, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'open', ?)`,
      )
      .bind(id, user.id, targetType, targetId, reason, details, new Date().toISOString())
      .run()

    return NextResponse.json({ ok: true, reportId: id }, { status: 201 })
  } catch (err) {
    console.error('content report error:', err)
    return NextResponse.json({ error: 'Could not save report' }, { status: 500 })
  }
}

/** GET /api/social/report — shogun lists open reports. */
export async function GET(req: Request) {
  try {
    await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : ''
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const db = getDb()
    const url = new URL(req.url)
    const status = url.searchParams.get('status') || 'open'
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)))

    const rows = await db
      .prepare(
        `SELECT id, reporter_user_id, target_type, target_id, reason, details, status, created_at
         FROM musashi_content_reports
         WHERE status = ?
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .bind(status, limit)
      .all()

    return NextResponse.json({ reports: rows.results ?? [] })
  } catch (err) {
    console.error('list reports error:', err)
    return NextResponse.json({ error: 'Could not list reports' }, { status: 500 })
  }
}
