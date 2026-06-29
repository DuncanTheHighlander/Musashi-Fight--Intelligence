/**
 * Quality Reviewer roster — shogun appoints other coaches or staff who may then
 * approve/hold promotions. Shogun-only.
 *   GET    — list current reviewers
 *   POST   { userId? , email? } — appoint a reviewer (email is looked up)
 *   DELETE ?userId=… — revoke
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { grantReviewer, revokeReviewer } from '@/lib/marketplace/coachRankStore'

export async function GET(req: Request) {
  try {
    await requireUser(req, { role: 'shogun' })
    const db = getDb()
    const rows = await db
      .prepare(
        `SELECT crr.user_id, crr.granted_at, mu.display_name, mu.email
           FROM coach_rank_reviewers crr
           LEFT JOIN musashi_users mu ON mu.id = crr.user_id
          ORDER BY crr.granted_at DESC`,
      )
      .bind()
      .all<{ user_id: string; granted_at: string; display_name: string | null; email: string | null }>()
    const reviewers = (rows.results || []).map((r) => ({
      userId: r.user_id,
      displayName: r.display_name?.trim() || r.email?.split('@')[0] || r.user_id,
      email: r.email || '',
      grantedAt: r.granted_at,
    }))
    return NextResponse.json({ reviewers })
  } catch (e) {
    return authError(e, 'Failed to list reviewers')
  }
}

export async function POST(req: Request) {
  try {
    const admin = await requireUser(req, { role: 'shogun' })
    const db = getDb()
    const body = (await req.json()) as Record<string, unknown>

    let userId = String(body?.userId || '').trim()
    const email = String(body?.email || '').trim().toLowerCase()
    if (!userId && email) {
      const row = await db
        .prepare('SELECT id FROM musashi_users WHERE email = ?')
        .bind(email)
        .first<{ id: string }>()
      if (!row?.id) return NextResponse.json({ error: 'No account with that email' }, { status: 404 })
      userId = row.id
    }
    if (!userId) return NextResponse.json({ error: 'userId or email required' }, { status: 400 })

    await grantReviewer(db, { userId, grantedBy: admin.id })
    return NextResponse.json({ ok: true, userId })
  } catch (e) {
    return authError(e, 'Failed to appoint reviewer')
  }
}

export async function DELETE(req: Request) {
  try {
    const admin = await requireUser(req, { role: 'shogun' })
    const db = getDb()
    const userId = new URL(req.url).searchParams.get('userId')?.trim() || ''
    if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
    await revokeReviewer(db, { userId, actorUserId: admin.id })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return authError(e, 'Failed to revoke reviewer')
  }
}

function authError(e: unknown, fallback: string) {
  const code = e instanceof Error ? e.message : 'UNKNOWN'
  if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
  if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  return NextResponse.json({ error: code || fallback }, { status: 400 })
}
