import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'
import { requireStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'

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

  let secretKey: string
  try {
    secretKey = await requireStripeSecretKey()
  } catch {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 501 })
  }

  const db = getDb()
  const row = await db
    .prepare('SELECT stripe_customer_id FROM musashi_stripe_customers WHERE user_id = ?')
    .bind(user.id)
    .first()

  const customerId = row?.stripe_customer_id ? String(row.stripe_customer_id) : ''
  if (!customerId) {
    return NextResponse.json({ error: 'No billing customer found' }, { status: 404 })
  }

  const origin = new URL(req.url).origin
  const bodyJson = (await req.json().catch(() => ({}))) as { returnUrl?: string }
  const returnUrl = String(bodyJson?.returnUrl || '').trim() || `${origin}/`

  const form = new URLSearchParams()
  form.set('customer', customerId)
  form.set('return_url', returnUrl)

  try {
    const session = await stripeRequest(secretKey, 'POST', '/v1/billing_portal/sessions', form)
    return NextResponse.json({ url: session.url }, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Stripe error' }, { status: 500 })
  }
}
