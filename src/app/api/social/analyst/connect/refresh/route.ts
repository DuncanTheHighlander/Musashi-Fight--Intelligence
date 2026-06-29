/**
 * POST /api/social/analyst/connect/refresh — refresh Stripe Connect payout readiness.
 */
import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/marketplace/types'
import { refreshConnectPayoutStatus } from '@/lib/marketplace/connect'

export async function POST(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const result = await refreshConnectPayoutStatus(getDb(), user.id)
    return NextResponse.json({
      stripePayoutsEnabled: result.stripePayoutsEnabled,
      stripeOnboardingCompletedAt: result.stripeOnboardingCompletedAt,
      accountId: result.accountId,
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'CONNECT_ACCOUNT_MISSING') {
      return NextResponse.json({ error: 'No Connect account yet — start onboarding first' }, { status: 400 })
    }
    if (code === 'STRIPE_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'Stripe not configured' }, { status: 501 })
    }
    return NextResponse.json({ error: code || 'Failed to refresh Connect status' }, { status: 400 })
  }
}
