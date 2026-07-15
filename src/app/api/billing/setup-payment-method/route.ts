import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { ensureStripeCustomer, stripeFormRequest } from '@/lib/stripe/customer'
import { requireStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'

/** POST — start Stripe Checkout in setup mode to save a card (no Pro required). */
export async function POST(req: Request) {
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

  try {
    const customerId = await ensureStripeCustomer({ id: user.id, email: user.email })
    const origin = new URL(req.url).origin
    const body = (await req.json().catch(() => ({}))) as {
      successUrl?: string
      cancelUrl?: string
    }
    const successUrl =
      String(body.successUrl || '').trim() ||
      `${origin}/marketplace/settings?card=success`
    const cancelUrl =
      String(body.cancelUrl || '').trim() ||
      `${origin}/marketplace/settings?card=cancelled`

    const form = new URLSearchParams()
    form.set('mode', 'setup')
    form.set('customer', customerId)
    form.set('success_url', successUrl)
    form.set('cancel_url', cancelUrl)
    form.set('payment_method_types[0]', 'card')
    form.set('client_reference_id', user.id)
    form.set('metadata[musashi_kind]', 'payment_method_setup')
    form.set('metadata[musashi_user_id]', user.id)

    const session = await stripeFormRequest(
      secretKey,
      'POST',
      '/v1/checkout/sessions',
      form,
      `setup_pm_${user.id}_${Date.now()}`,
    )
    const url = session.url ? String(session.url) : ''
    if (!url) return NextResponse.json({ error: 'Stripe did not return a setup URL' }, { status: 500 })
    return NextResponse.json({ url, customerId }, { status: 200 })
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Unable to start card setup' },
      { status: 500 },
    )
  }
}
