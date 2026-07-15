import { getStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'
import {
  ensureStripeCustomer,
  getDefaultPaymentMethodId,
  stripeFormRequest,
} from '@/lib/stripe/customer'
import type { MarketplaceJobRow } from './types'

export type MarketplacePaymentMode = 'mock' | 'stripe'

export type MarketplaceFundingSession = {
  provider: MarketplacePaymentMode
  requiresRedirect: boolean
  checkoutUrl: string | null
  checkoutSessionId: string | null
  message: string
  /** Set when a saved card charged successfully (no redirect). */
  fundedInline?: boolean
  paymentIntentId?: string | null
}

type StripeCheckoutSession = {
  id?: string
  url?: string | null
}

const stripeRequest = async (
  secretKey: string,
  method: string,
  path: string,
  body: URLSearchParams,
  idempotencyKey: string,
): Promise<StripeCheckoutSession> => {
  const resp = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': idempotencyKey,
    },
    body: body.toString(),
  })
  const data = (await resp.json()) as {
    id?: string
    url?: string | null
    error?: { message?: string }
  }
  if (!resp.ok) {
    const msg = data?.error?.message ? String(data.error.message) : 'Stripe error'
    throw new Error(msg)
  }
  return data
}

export async function resolveMarketplacePaymentMode(): Promise<MarketplacePaymentMode> {
  const forced = String(process.env.MUSASHI_MARKETPLACE_PAYMENTS || 'mock').toLowerCase()
  if (forced !== 'stripe') return 'mock'
  if (await getStripeSecretKey()) return 'stripe'
  // Production must fail loudly if stripe mode is set without keys.
  if (process.env.NODE_ENV === 'production') return 'stripe'
  return 'mock'
}

export function mockMarketplaceFundingSession(): MarketplaceFundingSession {
  return {
    provider: 'mock',
    requiresRedirect: false,
    checkoutUrl: null,
    checkoutSessionId: null,
    message: 'Mock escrow recorded. No real card was charged.',
    fundedInline: true,
  }
}

export async function createMarketplaceCheckoutSession(args: {
  req: Request
  job: MarketplaceJobRow
  actor: { id: string; email?: string | null }
  successUrl?: string | null
  cancelUrl?: string | null
  customerId?: string | null
}): Promise<MarketplaceFundingSession> {
  const secretKey = await getStripeSecretKey()
  if (!secretKey) throw new Error('STRIPE_NOT_CONFIGURED')

  const origin = new URL(args.req.url).origin
  const successUrl =
    args.successUrl ||
    `${origin}/marketplace/jobs/${args.job.id}?funding=success`
  const cancelUrl =
    args.cancelUrl ||
    `${origin}/marketplace/jobs/${args.job.id}?funding=cancelled`

  const form = new URLSearchParams()
  form.set('mode', 'payment')
  form.set('success_url', successUrl)
  form.set('cancel_url', cancelUrl)
  form.set('client_reference_id', args.job.id)
  form.set('line_items[0][quantity]', '1')
  form.set('line_items[0][price_data][currency]', args.job.currency.toLowerCase())
  form.set('line_items[0][price_data][unit_amount]', String(args.job.amount_cents))
  form.set(
    'line_items[0][price_data][product_data][name]',
    `Musashi marketplace job: ${args.job.title.slice(0, 120)}`,
  )
  form.set('metadata[musashi_kind]', 'marketplace_job_funding')
  form.set('metadata[musashi_marketplace_job_id]', args.job.id)
  form.set('metadata[musashi_user_id]', args.actor.id)
  form.set('payment_intent_data[metadata][musashi_kind]', 'marketplace_job_funding')
  form.set('payment_intent_data[metadata][musashi_marketplace_job_id]', args.job.id)
  form.set('payment_intent_data[metadata][musashi_user_id]', args.actor.id)

  if (args.customerId) {
    form.set('customer', args.customerId)
  } else {
    const email = String(args.actor.email || '').trim()
    if (email && email !== 'dev@local') form.set('customer_email', email)
  }

  const session = await stripeRequest(
    secretKey,
    'POST',
    '/v1/checkout/sessions',
    form,
    `marketplace_job_${args.job.id}_checkout`,
  )

  const checkoutUrl = session.url ? String(session.url) : ''
  if (!checkoutUrl) throw new Error('Stripe did not return a checkout URL')

  return {
    provider: 'stripe',
    requiresRedirect: true,
    checkoutUrl,
    checkoutSessionId: session.id ? String(session.id) : null,
    message: 'Redirect to Stripe Checkout to fund this job.',
  }
}

/**
 * Charge the fighter's default saved card. Returns fundedInline on success;
 * otherwise null so the caller can fall back to Checkout.
 */
export async function tryChargeMarketplaceWithSavedCard(args: {
  job: MarketplaceJobRow
  actor: { id: string; email: string }
}): Promise<MarketplaceFundingSession | null> {
  const secretKey = await getStripeSecretKey()
  if (!secretKey) return null

  let customerId: string
  try {
    customerId = await ensureStripeCustomer(args.actor)
  } catch {
    return null
  }

  const paymentMethodId = await getDefaultPaymentMethodId(customerId)
  if (!paymentMethodId) return null

  const form = new URLSearchParams()
  form.set('amount', String(args.job.amount_cents))
  form.set('currency', args.job.currency.toLowerCase())
  form.set('customer', customerId)
  form.set('payment_method', paymentMethodId)
  form.set('confirm', 'true')
  form.set('off_session', 'true')
  form.set('metadata[musashi_kind]', 'marketplace_job_funding')
  form.set('metadata[musashi_marketplace_job_id]', args.job.id)
  form.set('metadata[musashi_user_id]', args.actor.id)

  try {
    const pi = await stripeFormRequest(
      secretKey,
      'POST',
      '/v1/payment_intents',
      form,
      `marketplace_job_${args.job.id}_pi_saved`,
    )
    const status = String(pi.status || '')
    if (status === 'succeeded') {
      return {
        provider: 'stripe',
        requiresRedirect: false,
        checkoutUrl: null,
        checkoutSessionId: null,
        fundedInline: true,
        paymentIntentId: pi.id ? String(pi.id) : null,
        message: 'Charged saved card — escrow funded.',
      }
    }
    // 3DS / requires_action → fall back to Checkout
    return null
  } catch {
    return null
  }
}
