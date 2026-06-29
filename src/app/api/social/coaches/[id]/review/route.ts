/**
 * POST /api/social/coaches/[id]/review — a Quality Reviewer (shogun or appointed)
 * approves or holds a queued belt promotion.
 * Body: { decision: 'approve' | 'hold', notes?: string }
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { canQualityReview, decideReview } from '@/lib/marketplace/coachRankStore'

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await requireUser(req)
    const { id } = await context.params
    const db = getDb()
    if (!(await canQualityReview(db, user))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await req.json()) as Record<string, unknown>
    const decision = String(body?.decision || '')
    if (decision !== 'approve' && decision !== 'hold') {
      return NextResponse.json({ error: "decision must be 'approve' or 'hold'" }, { status: 400 })
    }
    const notes = String(body?.notes || '').slice(0, 4000)

    const updated = await decideReview(db, { userId: id, decision, actorUserId: user.id, notes })
    return NextResponse.json({
      userId: updated.user_id,
      earnedBelt: updated.earned_belt_key,
      pendingReviewBelt: updated.pending_review_belt,
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    return NextResponse.json({ error: code || 'Failed to record decision' }, { status: 400 })
  }
}
