#!/usr/bin/env node
/**
 * One-command Stripe setup for Musashi billing.
 *
 * Creates (idempotently) in the Stripe account of the given secret key:
 *   1. Product "Musashi Pro"
 *   2. Three recurring prices: $19/mo, $99/6mo, $179/yr
 *   3. (with --domain) a webhook endpoint for /api/billing/webhook with the
 *      events src/app/api/billing/webhook/route.ts consumes
 * Then prints the exact env vars to set. Safe to re-run: existing product,
 * prices, and endpoint are found and reused, never duplicated.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/setup-stripe.mjs --domain https://app.example.com
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe.mjs            # prices only
 */

const PRODUCT_NAME = 'Musashi Pro'
const PLANS = [
  { env: 'MUSASHI_STRIPE_PRICE_ID_PRO', nickname: 'Pro monthly', unit_amount: 1900, interval: 'month', interval_count: 1 },
  { env: 'MUSASHI_STRIPE_PRICE_ID_PRO_6MO', nickname: 'Pro 6-month', unit_amount: 9900, interval: 'month', interval_count: 6 },
  { env: 'MUSASHI_STRIPE_PRICE_ID_PRO_YEARLY', nickname: 'Pro yearly', unit_amount: 17900, interval: 'year', interval_count: 1 },
]
// Keep in sync with the handlers in src/app/api/billing/webhook/route.ts
const WEBHOOK_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'account.updated',
]

const secretKey = (process.env.STRIPE_SECRET_KEY || '').trim()
if (!secretKey.startsWith('sk_')) {
  console.error('Set STRIPE_SECRET_KEY (sk_test_... or sk_live_...) in the environment first.')
  console.error('Get it from https://dashboard.stripe.com/apikeys')
  process.exit(1)
}
const domainArgIdx = process.argv.indexOf('--domain')
const domain = domainArgIdx > -1 ? String(process.argv[domainArgIdx + 1] || '').replace(/\/$/, '') : ''
if (domainArgIdx > -1 && !/^https:\/\//.test(domain)) {
  console.error('--domain must be a full https:// origin, e.g. --domain https://app.example.com')
  process.exit(1)
}

async function stripe(method, path, body) {
  const resp = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? new URLSearchParams(body).toString() : undefined,
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    throw new Error(`${method} ${path} → ${data?.error?.message || resp.status}`)
  }
  return data
}

async function findOrCreateProduct() {
  const existing = await stripe('GET', '/v1/products?active=true&limit=100')
  const hit = (existing.data || []).find((p) => p.name === PRODUCT_NAME)
  if (hit) {
    console.log(`product: reusing "${PRODUCT_NAME}" (${hit.id})`)
    return hit
  }
  const created = await stripe('POST', '/v1/products', {
    name: PRODUCT_NAME,
    'metadata[app]': 'musashi',
  })
  console.log(`product: created "${PRODUCT_NAME}" (${created.id})`)
  return created
}

async function findOrCreatePrice(productId, plan) {
  const existing = await stripe('GET', `/v1/prices?product=${productId}&active=true&limit=100`)
  const hit = (existing.data || []).find(
    (p) =>
      p.currency === 'usd' &&
      p.unit_amount === plan.unit_amount &&
      p.recurring?.interval === plan.interval &&
      (p.recurring?.interval_count ?? 1) === plan.interval_count,
  )
  if (hit) {
    console.log(`price: reusing ${plan.nickname} (${hit.id})`)
    return hit
  }
  const created = await stripe('POST', '/v1/prices', {
    product: productId,
    nickname: plan.nickname,
    currency: 'usd',
    unit_amount: plan.unit_amount,
    'recurring[interval]': plan.interval,
    'recurring[interval_count]': plan.interval_count,
  })
  console.log(`price: created ${plan.nickname} (${created.id}) — $${(plan.unit_amount / 100).toFixed(2)} / ${plan.interval_count > 1 ? plan.interval_count + ' ' : ''}${plan.interval}`)
  return created
}

async function findOrCreateWebhook() {
  const url = `${domain}/api/billing/webhook`
  const existing = await stripe('GET', '/v1/webhook_endpoints?limit=100')
  const hit = (existing.data || []).find((w) => w.url === url && w.status === 'enabled')
  if (hit) {
    const missing = WEBHOOK_EVENTS.filter((e) => !hit.enabled_events.includes(e) && !hit.enabled_events.includes('*'))
    if (missing.length > 0) {
      const body = {}
      const all = [...new Set([...hit.enabled_events, ...missing])]
      all.forEach((e, i) => { body[`enabled_events[${i}]`] = e })
      await stripe('POST', `/v1/webhook_endpoints/${hit.id}`, body)
      console.log(`webhook: updated ${url} — added events: ${missing.join(', ')}`)
    } else {
      console.log(`webhook: reusing ${url} (${hit.id})`)
    }
    // Stripe only reveals the signing secret at creation time.
    console.log('webhook: signing secret NOT shown for existing endpoints — read it in the dashboard: https://dashboard.stripe.com/webhooks')
    return { endpoint: hit, secret: null }
  }
  const body = { url, description: 'Musashi billing + marketplace' }
  WEBHOOK_EVENTS.forEach((e, i) => { body[`enabled_events[${i}]`] = e })
  const created = await stripe('POST', '/v1/webhook_endpoints', body)
  console.log(`webhook: created ${url} (${created.id})`)
  return { endpoint: created, secret: created.secret || null }
}

const mode = secretKey.startsWith('sk_live_') ? 'LIVE' : 'TEST'
console.log(`Stripe setup — ${mode} mode\n`)

const product = await findOrCreateProduct()
const prices = []
for (const plan of PLANS) {
  prices.push({ env: plan.env, id: (await findOrCreatePrice(product.id, plan)).id })
}
let webhookSecret = null
if (domain) {
  webhookSecret = (await findOrCreateWebhook()).secret
} else {
  console.log('webhook: skipped (pass --domain https://your-domain to create it)')
}

console.log('\n=== Set these values ===')
console.log('# Local: .env.local | Production: wrangler secret put <NAME> (or [vars] for non-secrets)')
for (const p of prices) console.log(`${p.env}=${p.id}`)
if (webhookSecret) console.log(`STRIPE_WEBHOOK_SECRET=${webhookSecret}`)
else if (domain) console.log('STRIPE_WEBHOOK_SECRET=<copy from https://dashboard.stripe.com/webhooks>')
console.log('MUSASHI_MARKETPLACE_PAYMENTS=stripe   # flips marketplace escrow from mock to real Stripe')
console.log('\nThe secret key itself lives in Cloudflare Secrets Store (binding SECRET_STRIPE, store name "Stripe") — already wired in wrangler.toml.')
