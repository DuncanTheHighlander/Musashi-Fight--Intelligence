import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

const stripeRequest = async (secretKey: string, method: string, path: string, body?: URLSearchParams) => {
  const resp = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? body.toString() : undefined,
  })
  const data: any = await resp.json()
  if (!resp.ok) {
    const msg = data?.error?.message ? String(data.error.message) : 'Stripe error'
    throw new Error(msg)
  }
  return data
}

export async function POST(req: Request) {
  let user
  try {
    user = await requireUser(req)
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 501 })
  }

  const body = (await req.json()) as {
    plan?: string
    priceId?: string
    successUrl?: string
    cancelUrl?: string
  }

  const plan = String(body?.plan || '').trim().toLowerCase()
  const explicitPriceId = String(body?.priceId || '').trim()

  const proPriceId = String(process.env.MUSASHI_STRIPE_PRICE_ID_PRO || process.env.STRIPE_PRICE_ID_PRO || '').trim()
  const allowlistRaw = String(process.env.MUSASHI_STRIPE_ALLOWED_PRICE_IDS || '').trim()
  const allowlist = allowlistRaw ? allowlistRaw.split(',').map((s) => s.trim()).filter(Boolean) : []

  let priceId = ''
  if (plan) {
    if (plan !== 'pro') {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
    }
    if (!proPriceId) {
      return NextResponse.json({ error: 'Plan not configured' }, { status: 501 })
    }
    priceId = proPriceId
  } else if (explicitPriceId) {
    if (allowlist.length > 0 && !allowlist.includes(explicitPriceId)) {
      return NextResponse.json({ error: 'Invalid price' }, { status: 400 })
    }
    priceId = explicitPriceId
  } else {
    return NextResponse.json({ error: 'Missing plan' }, { status: 400 })
  }

  const successUrl = String(body?.successUrl || '').trim() || `${new URL(req.url).origin}/`
  const cancelUrl = String(body?.cancelUrl || '').trim() || `${new URL(req.url).origin}/`

  const db = getDb()
  const existing = await db
    .prepare('SELECT stripe_customer_id FROM musashi_stripe_customers WHERE user_id = ?')
    .bind(user.id)
    .first()

  let customerId = existing?.stripe_customer_id != null ? String(existing.stripe_customer_id) : ''

  if (!customerId) {
    const createCustomer = new URLSearchParams()
    createCustomer.set('email', user.email)
    createCustomer.set('metadata[musashi_user_id]', user.id)
    const customer = await stripeRequest(secretKey, 'POST', '/v1/customers', createCustomer)
    customerId = String(customer.id)
    const now = new Date().toISOString()
    await db
      .prepare(
        'INSERT INTO musashi_stripe_customers (user_id, stripe_customer_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id, updated_at=excluded.updated_at'
      )
      .bind(user.id, customerId, now)
      .run()
  }

  const form = new URLSearchParams()
  form.set('mode', 'subscription')
  form.set('customer', customerId)
  form.set('line_items[0][price]', priceId)
  form.set('line_items[0][quantity]', '1')
  form.set('success_url', successUrl)
  form.set('cancel_url', cancelUrl)

  form.set('client_reference_id', user.id)
  form.set('metadata[musashi_user_id]', user.id)
  form.set('subscription_data[metadata][musashi_user_id]', user.id)

  try {
    const session = await stripeRequest(secretKey, 'POST', '/v1/checkout/sessions', form)
    return NextResponse.json({ id: session.id, url: session.url }, { status: 200 })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Stripe error' }, { status: 500 })
  }
}
