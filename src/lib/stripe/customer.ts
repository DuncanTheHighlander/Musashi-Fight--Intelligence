import { getDb } from '@/lib/db'
import { requireStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'

type StripeJson = {
  id?: string
  error?: { message?: string }
  [key: string]: unknown
}

export async function stripeFormRequest(
  secretKey: string,
  method: string,
  path: string,
  body?: URLSearchParams,
  idempotencyKey?: string,
): Promise<StripeJson> {
  const resp = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? body.toString() : undefined,
  })
  const data = (await resp.json()) as StripeJson
  if (!resp.ok) {
    const msg = data?.error?.message ? String(data.error.message) : 'Stripe error'
    throw new Error(msg)
  }
  return data
}

/** Get or create a Stripe Customer for this Musashi user (no Pro required). */
export async function ensureStripeCustomer(user: {
  id: string
  email: string
}): Promise<string> {
  const secretKey = await requireStripeSecretKey()
  const db = getDb()
  const existing = await db
    .prepare('SELECT stripe_customer_id FROM musashi_stripe_customers WHERE user_id = ?')
    .bind(user.id)
    .first()

  const existingId = existing?.stripe_customer_id != null ? String(existing.stripe_customer_id) : ''
  if (existingId) return existingId

  const createCustomer = new URLSearchParams()
  createCustomer.set('email', user.email)
  createCustomer.set('metadata[musashi_user_id]', user.id)
  const customer = await stripeFormRequest(secretKey, 'POST', '/v1/customers', createCustomer)
  const customerId = String(customer.id || '')
  if (!customerId) throw new Error('Stripe did not return a customer id')

  const now = new Date().toISOString()
  await db
    .prepare(
      'INSERT INTO musashi_stripe_customers (user_id, stripe_customer_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id, updated_at=excluded.updated_at',
    )
    .bind(user.id, customerId, now)
    .run()

  return customerId
}

export type SavedCard = {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  isDefault: boolean
}

export async function listCustomerCards(customerId: string): Promise<SavedCard[]> {
  const secretKey = await requireStripeSecretKey()
  const customer = await stripeFormRequest(secretKey, 'GET', `/v1/customers/${customerId}`)
  const defaultPm =
    typeof customer.invoice_settings === 'object' && customer.invoice_settings
      ? String((customer.invoice_settings as { default_payment_method?: string }).default_payment_method || '')
      : ''

  const list = await stripeFormRequest(
    secretKey,
    'GET',
    `/v1/payment_methods?customer=${encodeURIComponent(customerId)}&type=card&limit=20`,
  )
  const data = Array.isArray(list.data) ? list.data : []
  return data.map((pm: any) => {
    const card = pm?.card || {}
    return {
      id: String(pm.id),
      brand: String(card.brand || 'card'),
      last4: String(card.last4 || '????'),
      expMonth: Number(card.exp_month || 0),
      expYear: Number(card.exp_year || 0),
      isDefault: String(pm.id) === defaultPm || (!defaultPm && data[0]?.id === pm.id),
    }
  })
}

export async function getDefaultPaymentMethodId(customerId: string): Promise<string | null> {
  const cards = await listCustomerCards(customerId)
  const def = cards.find((c) => c.isDefault) || cards[0]
  return def?.id || null
}
