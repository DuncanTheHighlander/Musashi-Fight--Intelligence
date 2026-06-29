import type { D1Database } from '@/lib/db'
import { newId } from '@/lib/marketplace/types'
import {
  mockMarketplaceFundingSession,
  resolveMarketplacePaymentMode,
  type MarketplaceFundingSession,
} from '@/lib/marketplace/payments'
import { getStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'

export type ContentProductRow = {
  id: string
  creator_id: string
  title: string
  price: number
  currency: string
  is_published: number | boolean
  video_url: string | null
}

export async function fetchPublishedProduct(
  db: D1Database,
  productId: string,
): Promise<ContentProductRow | null> {
  return db
    .prepare(
      `SELECT id, creator_id, title, price, currency, is_published, video_url
       FROM content_products WHERE id = ? AND is_published = 1`,
    )
    .bind(productId)
    .first<ContentProductRow>()
}

export async function userOwnsProduct(
  db: D1Database,
  buyerId: string,
  productId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM purchases
       WHERE buyer_id = ? AND product_id = ? AND status = 'completed' LIMIT 1`,
    )
    .bind(buyerId, productId)
    .first()
  return Boolean(row?.id)
}

export async function completeContentPurchase(
  db: D1Database,
  args: { purchaseId: string; productId: string; buyerId: string },
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(`UPDATE purchases SET status = 'completed' WHERE id = ? AND status = 'pending'`)
    .bind(args.purchaseId)
    .run()
  await db
    .prepare(
      `UPDATE content_products SET sales_count = sales_count + 1, updated_at = ? WHERE id = ?`,
    )
    .bind(now, args.productId)
    .run()
}

export async function purchaseContentProduct(args: {
  db: D1Database
  req: Request
  productId: string
  buyer: { id: string; email?: string | null }
  successUrl?: string | null
  cancelUrl?: string | null
}): Promise<{
  purchaseId: string
  payment: MarketplaceFundingSession
  videoUrl: string | null
  alreadyOwned: boolean
}> {
  const product = await fetchPublishedProduct(args.db, args.productId)
  if (!product) throw new Error('Product not found')
  if (product.creator_id === args.buyer.id) throw new Error('Cannot purchase your own content')

  if (await userOwnsProduct(args.db, args.buyer.id, args.productId)) {
    return {
      purchaseId: '',
      payment: mockMarketplaceFundingSession(),
      videoUrl: product.video_url ? String(product.video_url) : null,
      alreadyOwned: true,
    }
  }

  const priceUsd = Number(product.price) || 0
  const amountCents = Math.max(0, Math.round(priceUsd * 100))
  const purchaseId = newId('purchase')
  const now = new Date().toISOString()

  await args.db
    .prepare(
      `INSERT INTO purchases (id, buyer_id, product_id, amount, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(
      purchaseId,
      args.buyer.id,
      args.productId,
      priceUsd,
      String(product.currency || 'USD').toUpperCase(),
      now,
    )
    .run()

  if (amountCents === 0 || (await resolveMarketplacePaymentMode()) === 'mock') {
    await completeContentPurchase(args.db, {
      purchaseId,
      productId: args.productId,
      buyerId: args.buyer.id,
    })
    return {
      purchaseId,
      payment: mockMarketplaceFundingSession(),
      videoUrl: product.video_url ? String(product.video_url) : null,
      alreadyOwned: false,
    }
  }

  const origin = new URL(args.req.url).origin
  const successUrl =
    args.successUrl || `${origin}/?section=marketplace&purchase=success&productId=${args.productId}`
  const cancelUrl =
    args.cancelUrl || `${origin}/?section=marketplace&purchase=cancelled&productId=${args.productId}`

  const payment = await createContentCheckoutSession({
    req: args.req,
    product,
    purchaseId,
    buyer: args.buyer,
    amountCents,
    successUrl,
    cancelUrl,
  })

  return {
    purchaseId,
    payment,
    videoUrl: null,
    alreadyOwned: false,
  }
}

async function createContentCheckoutSession(args: {
  req: Request
  product: ContentProductRow
  purchaseId: string
  buyer: { id: string; email?: string | null }
  amountCents: number
  successUrl: string
  cancelUrl: string
}): Promise<MarketplaceFundingSession> {
  const secretKey = await getStripeSecretKey()
  if (!secretKey) throw new Error('STRIPE_NOT_CONFIGURED')

  const form = new URLSearchParams()
  form.set('mode', 'payment')
  form.set('success_url', args.successUrl)
  form.set('cancel_url', args.cancelUrl)
  form.set('client_reference_id', args.purchaseId)
  form.set('line_items[0][quantity]', '1')
  form.set('line_items[0][price_data][currency]', String(args.product.currency || 'USD').toLowerCase())
  form.set('line_items[0][price_data][unit_amount]', String(args.amountCents))
  form.set(
    'line_items[0][price_data][product_data][name]',
    `Musashi content: ${String(args.product.title).slice(0, 120)}`,
  )
  form.set('metadata[musashi_kind]', 'content_product_purchase')
  form.set('metadata[musashi_content_product_id]', args.product.id)
  form.set('metadata[musashi_purchase_id]', args.purchaseId)
  form.set('metadata[musashi_user_id]', args.buyer.id)
  form.set('payment_intent_data[metadata][musashi_kind]', 'content_product_purchase')
  form.set('payment_intent_data[metadata][musashi_content_product_id]', args.product.id)
  form.set('payment_intent_data[metadata][musashi_purchase_id]', args.purchaseId)
  form.set('payment_intent_data[metadata][musashi_user_id]', args.buyer.id)

  const email = String(args.buyer.email || '').trim()
  if (email && email !== 'dev@local') form.set('customer_email', email)

  const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `content_purchase_${args.purchaseId}_checkout`,
    },
    body: form.toString(),
  })
  const data = (await resp.json()) as {
    id?: string
    url?: string | null
    error?: { message?: string }
  }
  if (!resp.ok) {
    throw new Error(data?.error?.message || 'Stripe error')
  }
  const checkoutUrl = data.url ? String(data.url) : ''
  if (!checkoutUrl) throw new Error('Stripe did not return a checkout URL')

  return {
    provider: 'stripe',
    requiresRedirect: true,
    checkoutUrl,
    checkoutSessionId: data.id ? String(data.id) : null,
    message: 'Redirect to Stripe Checkout to complete your purchase.',
  }
}

export async function completeContentPurchaseFromCheckout(
  db: D1Database,
  metadata: Record<string, unknown>,
): Promise<boolean> {
  if (metadata?.musashi_kind !== 'content_product_purchase') return false

  const purchaseId = String(metadata?.musashi_purchase_id || '').trim()
  const productId = String(metadata?.musashi_content_product_id || '').trim()
  const buyerId = String(metadata?.musashi_user_id || '').trim()
  if (!purchaseId || !productId || !buyerId) {
    throw new Error('Content checkout missing metadata')
  }

  await completeContentPurchase(db, { purchaseId, productId, buyerId })
  return true
}
