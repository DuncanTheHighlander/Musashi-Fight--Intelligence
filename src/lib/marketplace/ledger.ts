/**
 * marketplace/ledger.ts
 *
 * Event-sourced money ledger for marketplace_jobs. Every money event — even
 * pending ones — writes a row. When Stripe is wired later the same rows get
 * back-filled with real IDs and their status flips from 'pending_stripe' to
 * 'succeeded'.
 *
 * IMPORTANT: Sign convention
 *   Positive cents = IN  to the platform escrow (fighter funding)
 *   Negative cents = OUT of the platform escrow (analyst payout, refund)
 *
 * Running balance = SUM(amount_cents WHERE status = 'succeeded')
 * A correctly operated job ends at balance 0.
 */

import type { D1Database, MarketplaceTransactionRow } from './types'

export type TxnType =
  | 'HOLD'
  | 'CAPTURE'
  | 'RELEASE'
  | 'PLATFORM_FEE'
  | 'REFUND'
  | 'PARTIAL_REFUND'
  | 'PAYOUT'
  | 'CHARGEBACK'
  | 'ADJUSTMENT'

export type TxnStatus =
  | 'pending_stripe'
  | 'processing'
  | 'succeeded'
  | 'failed'
  | 'reversed'

export interface AppendTxnInput {
  jobId: string
  type: TxnType
  amountCents: number          // signed per the convention above
  currency?: string
  actorUserId?: string | null
  idempotencyKey: string       // caller-supplied; dedup for retries
  metadata?: Record<string, unknown>
  stripePaymentIntentId?: string | null
  stripeChargeId?: string | null
  stripeTransferId?: string | null
  stripeRefundId?: string | null
  // Default is 'pending_stripe' so we can ledger-first and reconcile later.
  status?: TxnStatus
}

const newId = () => {
  try {
    return crypto.randomUUID()
  } catch {
    return `txn_${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

/**
 * Append a transaction row. Idempotent by idempotencyKey: if a row with the
 * same key already exists the existing row is returned instead of inserting.
 */
export async function appendTransaction(
  db: D1Database,
  input: AppendTxnInput,
): Promise<MarketplaceTransactionRow> {
  const existing = await db
    .prepare('SELECT * FROM marketplace_transactions WHERE idempotency_key = ?')
    .bind(input.idempotencyKey)
    .first<MarketplaceTransactionRow>()
  if (existing) return existing

  const id = newId()
  const now = new Date().toISOString()
  const status = input.status ?? 'pending_stripe'
  const metadata = JSON.stringify(input.metadata ?? {})

  await db
    .prepare(
      `INSERT INTO marketplace_transactions (
        id, job_id, type, amount_cents, currency,
        stripe_payment_intent_id, stripe_charge_id, stripe_transfer_id, stripe_refund_id,
        status, idempotency_key, actor_user_id, metadata,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.jobId,
      input.type,
      Math.trunc(input.amountCents),
      input.currency ?? 'USD',
      input.stripePaymentIntentId ?? null,
      input.stripeChargeId ?? null,
      input.stripeTransferId ?? null,
      input.stripeRefundId ?? null,
      status,
      input.idempotencyKey,
      input.actorUserId ?? null,
      metadata,
      now,
      now,
    )
    .run()

  const row = await db
    .prepare('SELECT * FROM marketplace_transactions WHERE id = ?')
    .bind(id)
    .first<MarketplaceTransactionRow>()
  if (!row) throw new Error('Transaction insert succeeded but row not found')
  return row
}

/**
 * Mark a previously-written transaction as succeeded. Called by the Stripe
 * webhook handler (later) to flip a 'pending_stripe' row to 'succeeded'
 * once the real money movement completes.
 */
export async function markTransactionSucceeded(
  db: D1Database,
  idempotencyKey: string,
  stripeIds: {
    paymentIntentId?: string
    chargeId?: string
    transferId?: string
    refundId?: string
  } = {},
): Promise<void> {
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE marketplace_transactions
         SET status = 'succeeded',
             stripe_payment_intent_id = COALESCE(?, stripe_payment_intent_id),
             stripe_charge_id = COALESCE(?, stripe_charge_id),
             stripe_transfer_id = COALESCE(?, stripe_transfer_id),
             stripe_refund_id = COALESCE(?, stripe_refund_id),
             updated_at = ?
       WHERE idempotency_key = ?`,
    )
    .bind(
      stripeIds.paymentIntentId ?? null,
      stripeIds.chargeId ?? null,
      stripeIds.transferId ?? null,
      stripeIds.refundId ?? null,
      now,
      idempotencyKey,
    )
    .run()
}

/** Minimum platform commission per marketplace transaction (in cents). $10. */
export const MIN_PLATFORM_FEE_CENTS = 1000

/**
 * Compute fee split for a job. Returns integer cents (no float drift).
 *   platformFee = max(floor(amount * bps / 10_000), minFeeCents), capped at amount
 *   analystPayout = amount - platformFee
 */
export function computeFeeSplit(
  amountCents: number,
  feeBps: number,
  minFeeCents: number = MIN_PLATFORM_FEE_CENTS,
): {
  platformFeeCents: number
  analystPayoutCents: number
} {
  const amt = Math.max(0, Math.trunc(amountCents))
  const bps = Math.max(0, Math.trunc(feeBps))
  const rawFeeCents = Math.floor((amt * bps) / 10_000)
  const floorCents = Math.max(0, Math.trunc(minFeeCents))
  const platformFeeCents = Math.min(amt, Math.max(rawFeeCents, floorCents))
  const analystPayoutCents = Math.max(0, amt - platformFeeCents)
  return { platformFeeCents, analystPayoutCents }
}

/**
 * High-level money operations. Each writes ledger rows in 'pending_stripe'
 * status; a later Stripe webhook flips them to 'succeeded'.
 *
 * If you need to actually call Stripe, do it AFTER these — and use the
 * returned idempotency keys so retries are safe.
 */

export interface HoldFundsResult {
  holdIdempotencyKey: string
  holdTxnId: string
}

/**
 * Fighter funds the escrow when the job is FUNDED. Writes a single HOLD row
 * (positive: money into escrow).
 */
export async function recordHold(
  db: D1Database,
  args: {
    jobId: string
    amountCents: number
    currency?: string
    actorUserId: string
    status?: TxnStatus
    stripePaymentIntentId?: string | null
    stripeChargeId?: string | null
  },
): Promise<HoldFundsResult> {
  const key = `job_${args.jobId}_hold`
  const row = await appendTransaction(db, {
    jobId: args.jobId,
    type: 'HOLD',
    amountCents: Math.abs(args.amountCents),
    currency: args.currency,
    actorUserId: args.actorUserId,
    idempotencyKey: key,
    status: args.status,
    stripePaymentIntentId: args.stripePaymentIntentId,
    stripeChargeId: args.stripeChargeId,
    metadata: { origin: 'fund' },
  })
  return { holdIdempotencyKey: key, holdTxnId: row.id }
}

/**
 * On APPROVE/RELEASE: split escrow into platform fee + analyst payout.
 * Writes THREE rows: PLATFORM_FEE (negative), PAYOUT (negative), RELEASE
 * (the logical "escrow emptied" marker — zero-sum).
 */
export async function recordRelease(
  db: D1Database,
  args: {
    jobId: string
    amountCents: number
    platformFeeCents: number
    analystPayoutCents: number
    currency?: string
    actorUserId?: string | null
  },
): Promise<{
  feeIdempotencyKey: string
  payoutIdempotencyKey: string
  releaseIdempotencyKey: string
}> {
  const feeKey = `job_${args.jobId}_fee`
  const payoutKey = `job_${args.jobId}_payout`
  const releaseKey = `job_${args.jobId}_release`

  await appendTransaction(db, {
    jobId: args.jobId,
    type: 'PLATFORM_FEE',
    amountCents: -Math.abs(args.platformFeeCents),
    currency: args.currency,
    actorUserId: args.actorUserId,
    idempotencyKey: feeKey,
    metadata: { origin: 'release' },
  })
  await appendTransaction(db, {
    jobId: args.jobId,
    type: 'PAYOUT',
    amountCents: -Math.abs(args.analystPayoutCents),
    currency: args.currency,
    actorUserId: args.actorUserId,
    idempotencyKey: payoutKey,
    metadata: { origin: 'release' },
  })
  await appendTransaction(db, {
    jobId: args.jobId,
    type: 'RELEASE',
    amountCents: 0, // logical marker row
    currency: args.currency,
    actorUserId: args.actorUserId,
    idempotencyKey: releaseKey,
    metadata: { origin: 'release', total: args.amountCents },
  })

  return {
    feeIdempotencyKey: feeKey,
    payoutIdempotencyKey: payoutKey,
    releaseIdempotencyKey: releaseKey,
  }
}

/**
 * Full refund path (dispute resolved in fighter's favor, or cancellation
 * before claim).
 */
export async function recordRefund(
  db: D1Database,
  args: {
    jobId: string
    amountCents: number
    reason: string
    currency?: string
    actorUserId?: string | null
  },
): Promise<{ refundIdempotencyKey: string }> {
  const key = `job_${args.jobId}_refund`
  await appendTransaction(db, {
    jobId: args.jobId,
    type: 'REFUND',
    amountCents: -Math.abs(args.amountCents),
    currency: args.currency,
    actorUserId: args.actorUserId,
    idempotencyKey: key,
    metadata: { reason: args.reason },
  })
  return { refundIdempotencyKey: key }
}

/**
 * Split resolution (dispute resolved with partial refund + partial payout).
 * All three rows write with unique keys suffixed by 'split'.
 */
export async function recordSplit(
  db: D1Database,
  args: {
    jobId: string
    refundAmountCents: number
    payoutAmountCents: number
    platformFeeCents: number
    currency?: string
    actorUserId?: string | null
  },
): Promise<void> {
  await appendTransaction(db, {
    jobId: args.jobId,
    type: 'PARTIAL_REFUND',
    amountCents: -Math.abs(args.refundAmountCents),
    currency: args.currency,
    actorUserId: args.actorUserId,
    idempotencyKey: `job_${args.jobId}_split_refund`,
    metadata: { origin: 'dispute_split' },
  })
  if (args.platformFeeCents > 0) {
    await appendTransaction(db, {
      jobId: args.jobId,
      type: 'PLATFORM_FEE',
      amountCents: -Math.abs(args.platformFeeCents),
      currency: args.currency,
      actorUserId: args.actorUserId,
      idempotencyKey: `job_${args.jobId}_split_fee`,
      metadata: { origin: 'dispute_split' },
    })
  }
  await appendTransaction(db, {
    jobId: args.jobId,
    type: 'PAYOUT',
    amountCents: -Math.abs(args.payoutAmountCents),
    currency: args.currency,
    actorUserId: args.actorUserId,
    idempotencyKey: `job_${args.jobId}_split_payout`,
    metadata: { origin: 'dispute_split' },
  })
}

/**
 * Compute the current escrow balance for a job from succeeded rows.
 * Exposed mainly for admin dashboards + reconciliation jobs.
 */
export async function fetchTransactionByIdempotencyKey(
  db: D1Database,
  idempotencyKey: string,
): Promise<MarketplaceTransactionRow | null> {
  return db
    .prepare('SELECT * FROM marketplace_transactions WHERE idempotency_key = ?')
    .bind(idempotencyKey)
    .first<MarketplaceTransactionRow>()
}

const sanitizeProviderFailure = (reason: string): string =>
  String(reason || 'Provider request failed')
    .replace(/sk_(test|live)_[A-Za-z0-9_]+/g, 'sk_***')
    .slice(0, 500)

export async function markTransactionFailed(
  db: D1Database,
  idempotencyKey: string,
  reason: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE marketplace_transactions
          SET status = 'failed', failure_reason = ?, updated_at = ?
        WHERE idempotency_key = ?`,
    )
    .bind(sanitizeProviderFailure(reason), new Date().toISOString(), idempotencyKey)
    .run()
}

export async function getJobBalance(
  db: D1Database,
  jobId: string,
): Promise<{ balanceCents: number; pendingCents: number }> {
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN status = 'succeeded'     THEN amount_cents ELSE 0 END), 0) AS bal,
         COALESCE(SUM(CASE WHEN status = 'pending_stripe' OR status = 'processing' THEN amount_cents ELSE 0 END), 0) AS pend
       FROM marketplace_transactions
       WHERE job_id = ?`,
    )
    .bind(jobId)
    .first<{ bal: number; pend: number }>()
  return {
    balanceCents: Number(row?.bal ?? 0),
    pendingCents: Number(row?.pend ?? 0),
  }
}
