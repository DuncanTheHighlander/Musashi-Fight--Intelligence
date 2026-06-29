import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  approveJob,
  applyTransition,
  createJob,
  fundJob,
  releaseJob,
  submitJob,
} from '../jobs'
import { createMockD1 } from '../mockD1'
import { executeJobReleaseMoneyMovement, executeJobRefundMoneyMovement } from '../moneyMovement'
import { cancelJob } from '../jobs'

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
    .prepare(
      'UPDATE analyst_profiles SET stripe_connect_id = ?, stripe_payouts_enabled = 1 WHERE user_id = ?',
    )
    .bind('acct_123', userId)
    .run()
}

describe('marketplace money movement', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('transfers analyst payout to connected account and marks payout succeeded', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    vi.stubEnv('MUSASHI_MARKETPLACE_PAYMENTS', 'stripe')
    const db = createMockD1()
    const analystId = 'analyst_1'
    await seedAnalyst(db, analystId)

    const job = await createJob(db, {
      fighterId: 'dev',
      analystId,
      jobType: 'direct_hire',
      title: 'Release payout',
      brief: '',
      amountCents: 5000,
      clientRequestId: 'money_release',
    })
    const funded = await fundJob(db, {
      jobId: job.id,
      actorUserId: 'dev',
      transactionStatus: 'succeeded',
      stripePaymentIntentId: 'pi_123',
    })
    await applyTransition(db, {
      jobId: funded.id,
      event: 'START',
      actorUserId: analystId,
    })
    await submitJob(db, {
      jobId: funded.id,
      analystId,
      deliverableUrl: 'https://example.com/breakdown',
    })
    await approveJob(db, { jobId: funded.id, actorUserId: 'dev' })
    await releaseJob(db, { jobId: funded.id, actorUserId: 'dev' })

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'tr_123' })))

    await executeJobReleaseMoneyMovement(db, funded.id)

    const payout = await db
      .prepare('SELECT status, stripe_transfer_id FROM marketplace_transactions WHERE idempotency_key = ?')
      .bind(`job_${funded.id}_payout`)
      .first<{ status: string; stripe_transfer_id: string }>()
    expect(payout?.status).toBe('succeeded')
    expect(payout?.stripe_transfer_id).toBe('tr_123')
  })

  test('refunds fighter on cancel in stripe mode', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    vi.stubEnv('MUSASHI_MARKETPLACE_PAYMENTS', 'stripe')
    const db = createMockD1()
    const job = await createJob(db, {
      fighterId: 'dev',
      jobType: 'open_bounty',
      title: 'Refund test',
      brief: '',
      amountCents: 5000,
      clientRequestId: 'money_refund',
    })
    await fundJob(db, {
      jobId: job.id,
      actorUserId: 'dev',
      transactionStatus: 'succeeded',
      stripePaymentIntentId: 'pi_refund_test',
    })

    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 're_123' })))

    await cancelJob(db, { jobId: job.id, actorUserId: 'dev', reason: 'test' })
    await executeJobRefundMoneyMovement(db, job.id)

    const refund = await db
      .prepare('SELECT status, stripe_refund_id FROM marketplace_transactions WHERE idempotency_key = ?')
      .bind(`job_${job.id}_refund`)
      .first<{ status: string; stripe_refund_id: string }>()
    expect(refund?.status).toBe('succeeded')
    expect(refund?.stripe_refund_id).toBe('re_123')
  })

  test('no-ops in mock payment mode', async () => {
    vi.stubEnv('MUSASHI_MARKETPLACE_PAYMENTS', 'mock')
    const db = createMockD1()
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await executeJobReleaseMoneyMovement(db, 'missing')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
