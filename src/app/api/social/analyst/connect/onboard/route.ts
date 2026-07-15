/**
 * POST /api/social/analyst/connect/onboard — start Stripe Connect Express onboarding.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { createOrRefreshConnectAccount } from '@/lib/marketplace/connect'
import { resolveMarketplacePaymentMode } from '@/lib/marketplace/payments'

export async function POST(req: Request) {
  try {
    if ((await resolveMarketplacePaymentMode()) !== 'stripe') {
      return NextResponse.json(
        { error: 'Stripe Connect requires MUSASHI_MARKETPLACE_PAYMENTS=stripe' },
        { status: 501 },
      )
    }

    const user = await requireUser(req)
    const origin = process.env.MUSASHI_APP_URL?.replace(/\/$/, '') || new URL(req.url).origin
    const result = await createOrRefreshConnectAccount(getDb(), {
      userId: user.id,
      email: String(user.email || ''),
      returnUrl: `${origin}/marketplace/settings?connect=return`,
      refreshUrl: `${origin}/marketplace/settings?connect=refresh`,
    })

    return NextResponse.json({
      onboardingUrl: result.onboardingUrl,
      accountId: result.accountId,
      stripePayoutsEnabled: result.stripePayoutsEnabled,
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'STRIPE_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 501 })
    }
    return NextResponse.json({ error: code || 'Connect onboarding failed' }, { status: 400 })
  }
}
