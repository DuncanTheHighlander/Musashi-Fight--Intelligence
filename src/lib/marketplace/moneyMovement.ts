import { stripeFormRequest } from '@/lib/stripe/stripeClient'
import { resolveMarketplacePaymentMode } from './payments'
import { ensureAnalystProfile, fetchJob } from './jobs'
import {
  fetchTransactionByIdempotencyKey,
  markTransactionFailed,
  markTransactionSucceeded,
} from './ledger'
import type { D1Database } from './types'

async function findHoldPaymentIntent(db: D1Database, jobId: string): Promise<string> {
  const hold = await db
    .prepare(
      `SELECT stripe_payment_intent_id FROM marketplace_transactions
        WHERE job_id = ? AND type = 'HOLD' AND stripe_payment_intent_id IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(jobId)
    .first<{ stripe_payment_intent_id: string | null }>()
  const pi = String(hold?.stripe_payment_intent_id || '').trim()
  if (!pi) throw new Error('PAYMENT_INTENT_MISSING')
  return pi
}

async function executeTransfer(args: {
  db: D1Database
  jobId: string
  idempotencyKey: string
  amountCents: number
  currency: string
  destination: string
}): Promise<void> {
  const txn = await fetchTransactionByIdempotencyKey(args.db, args.idempotencyKey)
  if (!txn || txn.status === 'succeeded') return

  try {
    const transfer = await stripeFormRequest<{ id: string }>('/v1/transfers', {
      body: {
        amount: Math.abs(args.amountCents),
        currency: args.currency.toLowerCase(),
        destination: args.destination,
        'metadata[musashi_marketplace_job_id]': args.jobId,
      },
      idempotencyKey: args.idempotencyKey,
    })
    await markTransactionSucceeded(args.db, args.idempotencyKey, {
      transferId: transfer.id,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Transfer failed'
    await markTransactionFailed(args.db, args.idempotencyKey, msg)
    throw e
  }
}

async function executeRefund(args: {
  db: D1Database
  jobId: string
  idempotencyKey: string
  amountCents: number
  paymentIntentId: string
}): Promise<void> {
  const txn = await fetchTransactionByIdempotencyKey(args.db, args.idempotencyKey)
  if (!txn || txn.status === 'succeeded') return

  try {
    const refund = await stripeFormRequest<{ id: string }>('/v1/refunds', {
      body: {
        payment_intent: args.paymentIntentId,
        amount: Math.abs(args.amountCents),
        'metadata[musashi_marketplace_job_id]': args.jobId,
      },
      idempotencyKey: args.idempotencyKey,
    })
    await markTransactionSucceeded(args.db, args.idempotencyKey, {
      refundId: refund.id,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Refund failed'
    await markTransactionFailed(args.db, args.idempotencyKey, msg)
    throw e
  }
}

async function markLedgerKeysSucceeded(db: D1Database, keys: string[]): Promise<void> {
  for (const key of keys) {
    const txn = await fetchTransactionByIdempotencyKey(db, key)
    if (txn && txn.status !== 'succeeded') {
      await markTransactionSucceeded(db, key, {})
    }
  }
}

export async function executeJobReleaseMoneyMovement(
  db: D1Database,
  jobId: string,
): Promise<void> {
  if ((await resolveMarketplacePaymentMode()) !== 'stripe') return

  const job = await fetchJob(db, jobId)
  if (!job?.analyst_id) throw new Error('No analyst assigned')

  const analyst = await ensureAnalystProfile(db, job.analyst_id)
  const connectId = String(analyst.stripe_connect_id || '').trim()
  if (!connectId) throw new Error('CONNECT_ACCOUNT_MISSING')

  const payoutKey = `job_${jobId}_payout`
  const payout = await fetchTransactionByIdempotencyKey(db, payoutKey)
  if (!payout) return

  await executeTransfer({
    db,
    jobId,
    idempotencyKey: payoutKey,
    amountCents: payout.amount_cents,
    currency: payout.currency,
    destination: connectId,
  })
  await markLedgerKeysSucceeded(db, [`job_${jobId}_fee`, `job_${jobId}_release`])
}

export async function executeJobRefundMoneyMovement(
  db: D1Database,
  jobId: string,
): Promise<void> {
  if ((await resolveMarketplacePaymentMode()) !== 'stripe') return

  const refundKey = `job_${jobId}_refund`
  const refund = await fetchTransactionByIdempotencyKey(db, refundKey)
  if (!refund) return

  const paymentIntentId = await findHoldPaymentIntent(db, jobId)
  await executeRefund({
    db,
    jobId,
    idempotencyKey: refundKey,
    amountCents: refund.amount_cents,
    paymentIntentId,
  })
}

export async function executeJobSplitMoneyMovement(
  db: D1Database,
  jobId: string,
): Promise<void> {
  if ((await resolveMarketplacePaymentMode()) !== 'stripe') return

  const job = await fetchJob(db, jobId)
  if (!job?.analyst_id) throw new Error('No analyst assigned')

  const analyst = await ensureAnalystProfile(db, job.analyst_id)
  const connectId = String(analyst.stripe_connect_id || '').trim()
  if (!connectId) throw new Error('CONNECT_ACCOUNT_MISSING')

  const paymentIntentId = await findHoldPaymentIntent(db, jobId)
  const refundKey = `job_${jobId}_split_refund`
  const payoutKey = `job_${jobId}_split_payout`
  const feeKey = `job_${jobId}_split_fee`

  const refund = await fetchTransactionByIdempotencyKey(db, refundKey)
  if (refund && refund.status !== 'succeeded') {
    await executeRefund({
      db,
      jobId,
      idempotencyKey: refundKey,
      amountCents: refund.amount_cents,
      paymentIntentId,
    })
  }

  const payout = await fetchTransactionByIdempotencyKey(db, payoutKey)
  if (payout && payout.status !== 'succeeded') {
    await executeTransfer({
      db,
      jobId,
      idempotencyKey: payoutKey,
      amountCents: payout.amount_cents,
      currency: payout.currency,
      destination: connectId,
    })
  }

  await markLedgerKeysSucceeded(db, [feeKey])
}
