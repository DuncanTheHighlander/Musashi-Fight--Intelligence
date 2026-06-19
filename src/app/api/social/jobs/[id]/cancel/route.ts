/**
 * POST /api/social/jobs/[id]/cancel — fighter (or analyst, limited) cancels.
 * Body: { reason?: string }
 *
 * Legal transitions:
 *   CREATED / FUNDED / CLAIMED / IN_PROGRESS → CANCELLED
 *   (After SUBMITTED the fighter must go through APPROVE or DISPUTE instead.)
 *
 * Auto-refund is appended to the ledger if the job was already FUNDED.
 */
import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/marketplace/types'
import { cancelJob, fetchJob } from '@/lib/marketplace/jobs'

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await enforceUsage(req, 'chat')
    const { id } = await context.params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const reason = String(body?.reason || '').trim() || undefined

    const db = getDb()
    const job = await fetchJob(db, id)
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Fighter can always cancel pre-approval. Analyst can abandon CLAIMED/IN_PROGRESS
    // but loses capacity penalty (tracked via jobs_cancelled stat).
    const isFighter = job.fighter_id === user.id
    const isAnalyst = job.analyst_id === user.id
    if (!isFighter && !isAnalyst) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const next = await cancelJob(db, { jobId: id, actorUserId: user.id, reason })

    // Analyst-initiated cancels bump the jobs_cancelled + free capacity
    if (isAnalyst && !isFighter && job.analyst_id) {
      await db
        .prepare(
          `UPDATE analyst_profiles
              SET jobs_cancelled = jobs_cancelled + 1,
                  current_capacity = MAX(0, current_capacity - 1),
                  updated_at = ?
            WHERE user_id = ?`,
        )
        .bind(new Date().toISOString(), job.analyst_id)
        .run()
    }

    return NextResponse.json({ jobId: next.id, status: next.status })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to cancel' }, { status: 400 })
  }
}
