/**
 * POST /api/social/jobs/[id]/fund — fighter funds the escrow.
 *
 * Stripe is not yet wired. This writes a HOLD row with status='pending_stripe'
 * and flips the job to FUNDED. When the Stripe webhook lands later, the HOLD
 * row flips to 'succeeded' and the money becomes real. The UX can still
 * proceed end-to-end in dev/test with the pending row.
 */
import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/marketplace/types'
import { fundJob } from '@/lib/marketplace/jobs'

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await enforceUsage(req, 'chat')
    const { id } = await context.params
    const db = getDb()
    const job = await fundJob(db, { jobId: id, actorUserId: user.id })
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      amountCents: job.amount_cents,
      // TODO(stripe): return a client_secret here when PaymentIntent lands.
      stripe: { pending: true },
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to fund' }, { status: 400 })
  }
}
