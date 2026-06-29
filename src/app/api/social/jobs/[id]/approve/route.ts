/**
 * POST /api/social/jobs/[id]/approve — fighter accepts the deliverable.
 *
 * Convenience: runs APPROVE then RELEASE in sequence so the analyst sees
 * an immediate payout event. If you need to split these later (e.g. a
 * "release N days after approval" cooling period) you can remove the second
 * call and run it from cron.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { approveJob, releaseJob } from '@/lib/marketplace/jobs'
import { executeJobReleaseMoneyMovement } from '@/lib/marketplace/moneyMovement'

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await requireUser(req)
    const { id } = await context.params
    const db = getDb()
    await approveJob(db, { jobId: id, actorUserId: user.id })
    const job = await releaseJob(db, { jobId: id, actorUserId: user.id, autoReleased: false })
    try {
      await executeJobReleaseMoneyMovement(db, id)
    } catch (e) {
      return NextResponse.json(
        {
          jobId: job.id,
          status: job.status,
          releasedAt: job.released_at,
          analystPayoutCents: job.analyst_payout_cents,
          paymentWarning: e instanceof Error ? e.message : 'Payout provider failed',
        },
        { status: 200 },
      )
    }
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      releasedAt: job.released_at,
      analystPayoutCents: job.analyst_payout_cents,
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to approve' }, { status: 400 })
  }
}
