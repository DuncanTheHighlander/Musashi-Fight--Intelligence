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
import { fundJob, preflightFundJob } from '@/lib/marketplace/jobs'
import {
  createMarketplaceCheckoutSession,
  mockMarketplaceFundingSession,
  resolveMarketplacePaymentMode,
} from '@/lib/marketplace/payments'

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await enforceUsage(req, 'chat')
    const { id } = await context.params
    const db = getDb()

    let body: Record<string, unknown> = {}
    try {
      const raw = await req.text()
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      body = {}
    }

    if (resolveMarketplacePaymentMode() === 'stripe') {
      const job = await preflightFundJob(db, { jobId: id, actorUserId: user.id })
      const payment = await createMarketplaceCheckoutSession({
        req,
        job,
        actor: user,
        successUrl: body.successUrl ? String(body.successUrl) : null,
        cancelUrl: body.cancelUrl ? String(body.cancelUrl) : null,
      })
      return NextResponse.json({
        jobId: job.id,
        status: job.status,
        amountCents: job.amount_cents,
        payment,
        stripe: {
          pending: false,
          checkoutUrl: payment.checkoutUrl,
          checkoutSessionId: payment.checkoutSessionId,
        },
      })
    }

    const job = await fundJob(db, { jobId: id, actorUserId: user.id })
    const payment = mockMarketplaceFundingSession()
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      amountCents: job.amount_cents,
      payment,
      stripe: { pending: true },
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'STRIPE_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 501 })
    }
    return NextResponse.json({ error: code || 'Failed to fund' }, { status: 400 })
  }
}
