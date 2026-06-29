import { afterEach, describe, expect, test, vi } from 'vitest'
import { createJob, fundJob } from '../jobs'
import { createMockD1 } from '../mockD1'
import { recordSplit } from '../ledger'
import { executeJobSplitMoneyMovement } from '../moneyMovement'

async function seedAnalyst(db: ReturnType<typeof createMockD1>, userId: string) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT OR IGNORE INTO users (id, role, email, password_hash, first_name, last_name, created_at, updated_at)
       VALUES (?, 'client', ?, '', 'Test', 'Analyst', ?, ?)`,
    )
    .bind(userId, `${userId}@example.test`, now, now)
    .run()
  await db
    .prepare(
      `INSERT OR IGNORE INTO analyst_profiles (
         user_id, is_analyst_enabled, bio, specialties, languages, turnaround_hours,
         direct_hire_enabled, direct_hire_rate_cents, belt_tier, belt_score,
         current_capacity, max_capacity, created_at, updated_at
       ) VALUES (?, 1, '', '["boxing"]', '["en"]', 72, 1, 5000, 'blue', 0, 0, 3, ?, ?)`,
    )
    .bind(userId, now, now)
    .run()
  await db
    .prepare('UPDATE analyst_profiles SET stripe_connect_id = ?, stripe_payouts_enabled = 1 WHERE user_id = ?')
    .bind('acct_split', userId)
    .run()
}

describe('dispute split money movement', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('marks split ledger rows succeeded with provider ids', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    vi.stubEnv('MUSASHI_MARKETPLACE_PAYMENTS', 'stripe')
    const db = createMockD1()
    const analystId = 'analyst_split'
    await seedAnalyst(db, analystId)

    const job = await createJob(db, {
      fighterId: 'dev',
      analystId,
      jobType: 'direct_hire',
      title: 'Split dispute',
      brief: '',
      amountCents: 5000,
      clientRequestId: 'split_happy',
    })
    await fundJob(db, {
      jobId: job.id,
      actorUserId: 'dev',
      transactionStatus: 'succeeded',
      stripePaymentIntentId: 'pi_split',
    })

    await recordSplit(db, {
      jobId: job.id,
      refundAmountCents: 1000,
      payoutAmountCents: 1700,
      platformFeeCents: 300,
      actorUserId: 'dev',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/v1/refunds')) {
          return Response.json({ id: 're_split' })
        }
        if (String(url).includes('/v1/transfers')) {
          return Response.json({ id: 'tr_split' })
        }
        return Response.json({})
      }),
    )

    await executeJobSplitMoneyMovement(db, job.id)

    const refund = await db
      .prepare('SELECT status, stripe_refund_id FROM marketplace_transactions WHERE idempotency_key = ?')
      .bind(`job_${job.id}_split_refund`)
      .first<{ status: string; stripe_refund_id: string }>()
    const payout = await db
      .prepare('SELECT status, stripe_transfer_id FROM marketplace_transactions WHERE idempotency_key = ?')
      .bind(`job_${job.id}_split_payout`)
      .first<{ status: string; stripe_transfer_id: string }>()
    const fee = await db
      .prepare('SELECT status FROM marketplace_transactions WHERE idempotency_key = ?')
      .bind(`job_${job.id}_split_fee`)
      .first<{ status: string }>()

    expect(refund?.status).toBe('succeeded')
    expect(refund?.stripe_refund_id).toBe('re_split')
    expect(payout?.status).toBe('succeeded')
    expect(payout?.stripe_transfer_id).toBe('tr_split')
    expect(fee?.status).toBe('succeeded')
  })

  test('sanitizes Stripe failure reason without leaking secret key', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    vi.stubEnv('MUSASHI_MARKETPLACE_PAYMENTS', 'stripe')
    const db = createMockD1()
    const analystId = 'analyst_split_fail'
    await seedAnalyst(db, analystId)

    const job = await createJob(db, {
      fighterId: 'dev',
      analystId,
      jobType: 'direct_hire',
      title: 'Split fail',
      brief: '',
      amountCents: 5000,
      clientRequestId: 'split_fail',
    })
    await fundJob(db, {
      jobId: job.id,
      actorUserId: 'dev',
      transactionStatus: 'succeeded',
      stripePaymentIntentId: 'pi_split_fail',
    })

    await recordSplit(db, {
      jobId: job.id,
      refundAmountCents: 800,
      payoutAmountCents: 1000,
      platformFeeCents: 200,
      actorUserId: 'dev',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/v1/refunds')) {
          return new Response(
            JSON.stringify({ error: { message: 'card declined sk_test_leaked_secret failed' } }),
            { status: 402, headers: { 'content-type': 'application/json' } },
          )
        }
        return Response.json({ id: 'tr_unused' })
      }),
    )

    await expect(executeJobSplitMoneyMovement(db, job.id)).rejects.toThrow()

    const refund = await db
      .prepare('SELECT status, failure_reason FROM marketplace_transactions WHERE idempotency_key = ?')
      .bind(`job_${job.id}_split_refund`)
      .first<{ status: string; failure_reason: string }>()

    expect(refund?.status).toBe('failed')
    expect(refund?.failure_reason).not.toContain('sk_test_leaked_secret')
    expect(refund?.failure_reason).not.toMatch(/sk_test_[A-Za-z0-9_]+/)
  })
})
