import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

export async function GET(req: Request) {
  let user
  try {
    user = await requireUser(req)
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getDb()
  const nowIso = new Date().toISOString()

  const row = await db
    .prepare(
      "SELECT stripe_subscription_id, status, price_id, product_id, cancel_at_period_end, current_period_end FROM musashi_stripe_subscriptions WHERE user_id = ? AND status IN ('active','trialing') AND (current_period_end IS NULL OR current_period_end >= ?) ORDER BY updated_at DESC LIMIT 1"
    )
    .bind(user.id, nowIso)
    .first()

  if (!row?.stripe_subscription_id) {
    return NextResponse.json({ active: false }, { status: 200 })
  }

  return NextResponse.json(
    {
      active: true,
      subscriptionId: String(row.stripe_subscription_id),
      status: String(row.status),
      priceId: row.price_id != null ? String(row.price_id) : null,
      productId: row.product_id != null ? String(row.product_id) : null,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
      currentPeriodEnd: row.current_period_end != null ? String(row.current_period_end) : null,
    },
    { status: 200 }
  )
}
