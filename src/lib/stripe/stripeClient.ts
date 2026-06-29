import { requireStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'

export const STRIPE_API_VERSION = '2024-11-20.acacia'

type StripeBody = Record<string, string | number | boolean | null | undefined>

export function encodeStripeForm(body: StripeBody): URLSearchParams {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue
    form.set(key, String(value))
  }
  return form
}

export async function stripeFormRequest<T = Record<string, unknown>>(
  path: string,
  args: { method?: string; body?: StripeBody; idempotencyKey?: string } = {},
): Promise<T> {
  // Stripe key from Secrets Store binding SECRET_STRIPE (store name "Stripe")
  const secretKey = await requireStripeSecretKey()

  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': STRIPE_API_VERSION,
  }
  const method = args.method || 'POST'
  let body: string | undefined
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = encodeStripeForm(args.body || {}).toString()
  }
  if (args.idempotencyKey) headers['Idempotency-Key'] = args.idempotencyKey

  const resp = await fetch(`https://api.stripe.com${path}`, { method, headers, body })
  const data = (await resp.json().catch(() => ({}))) as {
    error?: { message?: string }
  } & T
  if (!resp.ok) {
    const message =
      typeof data?.error?.message === 'string' ? data.error.message : 'Stripe request failed'
    throw new Error(message)
  }
  return data as T
}
