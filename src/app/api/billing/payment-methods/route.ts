import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import {
  ensureStripeCustomer,
  listCustomerCards,
  stripeFormRequest,
} from '@/lib/stripe/customer'
import { requireStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'

/** GET — list saved cards for the current user (empty if none). */
export async function GET(req: Request) {
  let user
  try {
    user = await requireUser(req)
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    await requireStripeSecretKey()
  } catch {
    return NextResponse.json({ cards: [], stripeConfigured: false }, { status: 200 })
  }

  try {
    const customerId = await ensureStripeCustomer({ id: user.id, email: user.email })
    const cards = await listCustomerCards(customerId)
    return NextResponse.json({ cards, customerId, stripeConfigured: true }, { status: 200 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to list cards' },
      { status: 500 },
    )
  }
}

/** DELETE — detach a payment method from the customer. */
export async function DELETE(req: Request) {
  let user
  try {
    user = await requireUser(req)
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let secretKey: string
  try {
    secretKey = await requireStripeSecretKey()
  } catch {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 501 })
  }

  const body = (await req.json().catch(() => ({}))) as { paymentMethodId?: string }
  const paymentMethodId = String(body.paymentMethodId || '').trim()
  if (!paymentMethodId) {
    return NextResponse.json({ error: 'paymentMethodId required' }, { status: 400 })
  }

  try {
    const customerId = await ensureStripeCustomer({ id: user.id, email: user.email })
    const pm = await stripeFormRequest(secretKey, 'GET', `/v1/payment_methods/${paymentMethodId}`)
    const pmCustomer = pm.customer ? String(pm.customer) : ''
    if (pmCustomer && pmCustomer !== customerId) {
      return NextResponse.json({ error: 'Payment method not found' }, { status: 404 })
    }
    await stripeFormRequest(secretKey, 'POST', `/v1/payment_methods/${paymentMethodId}/detach`)
    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to remove card' },
      { status: 500 },
    )
  }
}
