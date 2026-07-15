import { NextResponse } from 'next/server'

import { getDb, type D1Database } from '@/lib/db'
import { getStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'
import { completeJobFunding } from '@/lib/marketplace/jobs'
import { completeContentPurchaseFromCheckout } from '@/lib/marketplace/contentPurchases'
import { refreshConnectPayoutStatusByAccountId } from '@/lib/marketplace/connect'

const enc = new TextEncoder()

const toHex = (bytes: Uint8Array): string => {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

const timingSafeEqualHex = (a: string, b: string): boolean => {
  const aa = enc.encode(a)
  const bb = enc.encode(b)
  if (aa.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i]
  return diff === 0
}

const hmacSha256Hex = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return toHex(new Uint8Array(sig))
}

const parseStripeSignatureHeader = (header: string | null): { t: number; v1: string[] } | null => {
  const raw = String(header || '').trim()
  if (!raw) return null
  const parts = raw.split(',')
  const v1: string[] = []
  let t: number | null = null
  for (const p of parts) {
    const [k, v] = p.split('=')
    if (!k || !v) continue
    const kk = k.trim()
    const vv = v.trim()
    if (kk === 't') {
      const n = Number(vv)
      if (Number.isFinite(n)) t = n
    } else if (kk === 'v1') {
      v1.push(vv)
    }
  }
  if (t == null || v1.length === 0) return null
  return { t, v1 }
}

const stripeRequest = async (secretKey: string, method: string, path: string) => {
  const resp = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  })
  const data: any = await resp.json()
  if (!resp.ok) {
    const msg = data?.error?.message ? String(data.error.message) : 'Stripe error'
    throw new Error(msg)
  }
  return data
}

const upsertCustomerMapping = async (db: D1Database, userId: string, customerId: string) => {
  const now = new Date().toISOString()
  await db
    .prepare(
      'INSERT INTO musashi_stripe_customers (user_id, stripe_customer_id, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id=excluded.stripe_customer_id, updated_at=excluded.updated_at'
    )
    .bind(userId, customerId, now)
    .run()
}

const lookupUserIdByCustomerId = async (db: D1Database, customerId: string): Promise<string | null> => {
  const row = await db
    .prepare('SELECT user_id FROM musashi_stripe_customers WHERE stripe_customer_id = ?')
    .bind(customerId)
    .first()
  if (!row?.user_id) return null
  return String(row.user_id)
}

const upsertSubscription = async (db: D1Database, sub: any, fallbackUserId: string | null) => {
  const subId = String(sub?.id || '').trim()
  const customerId = String(sub?.customer || '').trim()
  if (!subId || !customerId) return

  const status = String(sub?.status || 'unknown')
  const cancelAtPeriodEnd = sub?.cancel_at_period_end ? 1 : 0
  const currentPeriodEndIso =
    typeof sub?.current_period_end === 'number' ? new Date(sub.current_period_end * 1000).toISOString() : null

  const priceId = sub?.items?.data?.[0]?.price?.id ? String(sub.items.data[0].price.id) : null
  const productId = sub?.items?.data?.[0]?.price?.product ? String(sub.items.data[0].price.product) : null

  const userId = sub?.metadata?.musashi_user_id ? String(sub.metadata.musashi_user_id) : fallbackUserId
  if (userId) {
    await upsertCustomerMapping(db, userId, customerId)
  }

  const now = new Date().toISOString()
  await db
    .prepare(
      'INSERT INTO musashi_stripe_subscriptions (stripe_subscription_id, user_id, stripe_customer_id, status, price_id, product_id, cancel_at_period_end, current_period_end, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(stripe_subscription_id) DO UPDATE SET user_id=excluded.user_id, stripe_customer_id=excluded.stripe_customer_id, status=excluded.status, price_id=excluded.price_id, product_id=excluded.product_id, cancel_at_period_end=excluded.cancel_at_period_end, current_period_end=excluded.current_period_end, updated_at=excluded.updated_at'
    )
    .bind(subId, userId ?? null, customerId, status, priceId, productId, cancelAtPeriodEnd, currentPeriodEndIso, now)
    .run()
}

const completeMarketplaceCheckoutSession = async (db: D1Database, session: any) => {
  const metadata = session?.metadata || {}
  if (metadata?.musashi_kind !== 'marketplace_job_funding') return false

  const jobId = String(metadata?.musashi_marketplace_job_id || '').trim()
  const actorUserId = String(metadata?.musashi_user_id || '').trim()
  if (!jobId || !actorUserId) throw new Error('Marketplace checkout missing metadata')

  await completeJobFunding(db, {
    jobId,
    actorUserId,
    stripePaymentIntentId: session?.payment_intent ? String(session.payment_intent) : null,
  })
  return true
}

export async function POST(req: Request) {
  const secretKey = await getStripeSecretKey()
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secretKey || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 501 })
  }

  const sigHeader = req.headers.get('stripe-signature')
  const parsed = parseStripeSignatureHeader(sigHeader)
  if (!parsed) {
    return NextResponse.json({ error: 'Invalid signature header' }, { status: 400 })
  }

  const toleranceSec = 300
  const nowSec = Math.floor(Date.now() / 1000)
  if (Math.abs(nowSec - parsed.t) > toleranceSec) {
    return NextResponse.json({ error: 'Stale signature' }, { status: 400 })
  }

  const rawBody = await req.text()
  const signedPayload = `${parsed.t}.${rawBody}`
  const expected = await hmacSha256Hex(webhookSecret, signedPayload)
  let ok = false
  for (const v of parsed.v1) {
    if (timingSafeEqualHex(expected, v)) {
      ok = true
      break
    }
  }

  if (!ok) {
    return NextResponse.json({ error: 'Signature mismatch' }, { status: 400 })
  }

  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = getDb()

  const type = String(event?.type || '')
  const obj = event?.data?.object

  try {
    if (type === 'customer.subscription.created' || type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
      const customerId = String(obj?.customer || '').trim()
      const fallbackUserId = customerId ? await lookupUserIdByCustomerId(db, customerId) : null
      await upsertSubscription(db, obj, fallbackUserId)
    } else if (type === 'account.updated') {
      const accountId = String(obj?.id || '').trim()
      if (accountId) {
        await refreshConnectPayoutStatusByAccountId(db, accountId)
      }
    } else if (type === 'payment_intent.succeeded') {
      const metadata = obj?.metadata || {}
      if (metadata?.musashi_kind === 'marketplace_job_funding') {
        const jobId = String(metadata?.musashi_marketplace_job_id || '').trim()
        const actorUserId = String(metadata?.musashi_user_id || '').trim()
        if (jobId && actorUserId) {
          await completeJobFunding(db, {
            jobId,
            actorUserId,
            stripePaymentIntentId: obj?.id ? String(obj.id) : null,
          })
        }
      }
    } else if (type === 'checkout.session.completed') {
      const handledContent = await completeContentPurchaseFromCheckout(db, obj?.metadata || {})
      if (handledContent) {
        return NextResponse.json({ received: true }, { status: 200 })
      }

      const handledMarketplace = await completeMarketplaceCheckoutSession(db, obj)
      if (handledMarketplace) {
        return NextResponse.json({ received: true }, { status: 200 })
      }

      const customerId = String(obj?.customer || '').trim()
      const sessionUserId = obj?.metadata?.musashi_user_id ? String(obj.metadata.musashi_user_id) : null
      const mode = String(obj?.mode || '')
      // Card setup (no subscription) — map customer and set default payment method.
      if (mode === 'setup' && sessionUserId && customerId) {
        await upsertCustomerMapping(db, sessionUserId, customerId)
        const setupIntentId = obj?.setup_intent ? String(obj.setup_intent) : ''
        if (setupIntentId) {
          const si = await stripeRequest(secretKey, 'GET', `/v1/setup_intents/${setupIntentId}`)
          const pmId = si?.payment_method ? String(si.payment_method) : ''
          if (pmId) {
            const form = new URLSearchParams()
            form.set('invoice_settings[default_payment_method]', pmId)
            await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${secretKey}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: form.toString(),
            })
          }
        }
      }
      const subscriptionId = obj?.subscription ? String(obj.subscription) : ''
      if (sessionUserId && customerId) {
        await upsertCustomerMapping(db, sessionUserId, customerId)
      }
      if (subscriptionId) {
        const sub = await stripeRequest(secretKey, 'GET', `/v1/subscriptions/${subscriptionId}`)
        const fallbackUserId = sessionUserId || (customerId ? await lookupUserIdByCustomerId(db, customerId) : null)
        await upsertSubscription(db, sub, fallbackUserId)
      }
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Webhook error' }, { status: 500 })
  }

  return NextResponse.json({ received: true }, { status: 200 })
}
