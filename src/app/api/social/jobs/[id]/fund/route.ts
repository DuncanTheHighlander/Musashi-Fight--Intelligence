/**
 * POST /api/social/jobs/[id]/fund — fighter funds the escrow.
 *
 * mock mode: records escrow immediately (no card charge).
 * stripe mode: try saved card first; else Checkout URL (job stays CREATED until webhook).
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { completeJobFunding, fundJob, preflightFundJob } from '@/lib/marketplace/jobs'
import {
  createMarketplaceCheckoutSession,
  mockMarketplaceFundingSession,
  resolveMarketplacePaymentMode,
  tryChargeMarketplaceWithSavedCard,
} from '@/lib/marketplace/payments'
import { ensureStripeCustomer } from '@/lib/stripe/customer'

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await requireUser(req)
    const { id } = await context.params
    const db = getDb()

    let body: Record<string, unknown> = {}
    try {
      const raw = await req.text()
      body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    } catch {
      body = {}
    }

    if ((await resolveMarketplacePaymentMode()) === 'stripe') {
      const job = await preflightFundJob(db, { jobId: id, actorUserId: user.id })

      const preferCheckout = body.preferCheckout === true
      if (!preferCheckout) {
        const saved = await tryChargeMarketplaceWithSavedCard({
          job,
          actor: { id: user.id, email: user.email },
        })
        if (saved?.fundedInline) {
          const funded = await completeJobFunding(db, {
            jobId: job.id,
            actorUserId: user.id,
            stripePaymentIntentId: saved.paymentIntentId,
          })
          return NextResponse.json({
            jobId: funded.id,
            status: funded.status,
            amountCents: funded.amount_cents,
            payment: saved,
            stripe: { pending: false, fundedInline: true },
          })
        }
      }

      let customerId: string | null = null
      try {
        customerId = await ensureStripeCustomer({ id: user.id, email: user.email })
      } catch {
        customerId = null
      }

      const payment = await createMarketplaceCheckoutSession({
        req,
        job,
        actor: user,
        successUrl: body.successUrl ? String(body.successUrl) : null,
        cancelUrl: body.cancelUrl ? String(body.cancelUrl) : null,
        customerId,
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
