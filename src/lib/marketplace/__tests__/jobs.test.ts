import { describe, expect, test } from 'vitest'
import {
  DEFAULT_CLAIM_DEADLINE_MS,
  DEFAULT_DELIVERY_DEADLINE_MS,
  defaultClaimDeadlineAt,
  defaultDeliveryDeadlineAt,
} from '../deadlines'
import { createJob, fundJob, preflightFundJob } from '../jobs'
import { getJobBalance } from '../ledger'
import { createMockD1 } from '../mockD1'

async function seedEnabledAnalyst(db: ReturnType<typeof createMockD1>, userId: string) {
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
}

describe('marketplace deadlines', () => {
  test('default claim deadline is ~7 days out', () => {
    const from = Date.parse('2026-01-01T00:00:00.000Z')
    const at = Date.parse(defaultClaimDeadlineAt(from))
    expect(at - from).toBe(DEFAULT_CLAIM_DEADLINE_MS)
  })

  test('default delivery deadline is 72h out', () => {
    const from = Date.parse('2026-01-01T00:00:00.000Z')
    const at = Date.parse(defaultDeliveryDeadlineAt(from))
    expect(at - from).toBe(DEFAULT_DELIVERY_DEADLINE_MS)
  })
})

describe('direct hire auto-claim on fund', () => {
  test('funded direct hire reaches CLAIMED with delivery deadline', async () => {
    const db = createMockD1()
    const analystId = 'test_analyst_direct'
    await seedEnabledAnalyst(db, analystId)
    const before = Date.now()

    const job = await createJob(db, {
      fighterId: 'dev',
      jobType: 'direct_hire',
      title: 'Direct hire test',
      brief: 'brief',
      amountCents: 5000,
      analystId,
      clientRequestId: 'test_direct_hire_claim',
    })

    const funded = await fundJob(db, { jobId: job.id, actorUserId: 'dev' })

    expect(funded.status).toBe('CLAIMED')
    expect(funded.analyst_id).toBe(analystId)
    expect(funded.delivery_deadline_at).toBeTruthy()
    const deliveryMs = Date.parse(funded.delivery_deadline_at!) - before
    expect(deliveryMs).toBeGreaterThanOrEqual(DEFAULT_DELIVERY_DEADLINE_MS - 5000)
    expect(deliveryMs).toBeLessThanOrEqual(DEFAULT_DELIVERY_DEADLINE_MS + 5000)
  })
})

describe('fundJob capacity preflight (no escrow stranded)', () => {
  test('throws before holding funds when the analyst is at capacity', async () => {
    const db = createMockD1()
    const analystId = 'test_analyst_full'
    await seedEnabledAnalyst(db, analystId)
    // Force the test analyst to zero capacity so the preflight rejects.
    await db
      .prepare('UPDATE analyst_profiles SET max_capacity = 0 WHERE user_id = ?')
      .bind(analystId)
      .run()

    const job = await createJob(db, {
      fighterId: 'dev',
      jobType: 'direct_hire',
      title: 'Capacity preflight test',
      brief: 'brief',
      amountCents: 5000,
      analystId,
      clientRequestId: 'test_capacity_preflight',
    })

    await expect(
      fundJob(db, { jobId: job.id, actorUserId: 'dev' }),
    ).rejects.toThrow(/capacity full/i)

    // The job must stay CREATED and NO money may have been held.
    const row = await db
      .prepare('SELECT status FROM marketplace_jobs WHERE id = ?')
      .bind(job.id)
      .first<{ status: string }>()
    expect(row?.status).toBe('CREATED')

    const balance = await getJobBalance(db, job.id)
    expect(balance.balanceCents).toBe(0)
    expect(balance.pendingCents).toBe(0)
  })
})

describe('marketplace funding provider seam', () => {
  test('preflight validates funding without writing escrow rows', async () => {
    const db = createMockD1()
    const job = await createJob(db, {
      fighterId: 'dev',
      jobType: 'open_bounty',
      title: 'Preflight-only funding',
      brief: '',
      amountCents: 2500,
      clientRequestId: 'test_preflight_funding',
    })

    const checked = await preflightFundJob(db, { jobId: job.id, actorUserId: 'dev' })
    expect(checked.id).toBe(job.id)

    const balance = await getJobBalance(db, job.id)
    expect(balance.balanceCents).toBe(0)
    expect(balance.pendingCents).toBe(0)
  })

  test('Stripe-completed funding records a succeeded hold with payment intent id', async () => {
    const db = createMockD1()
    const job = await createJob(db, {
      fighterId: 'dev',
      jobType: 'open_bounty',
      title: 'Stripe completed funding',
      brief: '',
      amountCents: 3500,
      clientRequestId: 'test_stripe_completed_funding',
    })

    const funded = await fundJob(db, {
      jobId: job.id,
      actorUserId: 'dev',
      transactionStatus: 'succeeded',
      stripePaymentIntentId: 'pi_marketplace_test',
    })
    expect(funded.status).toBe('FUNDED')

    const txn = await db
      .prepare('SELECT status, stripe_payment_intent_id FROM marketplace_transactions WHERE job_id = ? AND type = ?')
      .bind(job.id, 'HOLD')
      .first<{ status: string; stripe_payment_intent_id: string }>()
    expect(txn?.status).toBe('succeeded')
    expect(txn?.stripe_payment_intent_id).toBe('pi_marketplace_test')
  })
})

describe('createJob deadline defaults', () => {
  test('sets claim_deadline_at when omitted', async () => {
    const db = createMockD1()
    const before = Date.now()
    const job = await createJob(db, {
      fighterId: 'dev',
      jobType: 'open_bounty',
      title: 'Bounty with deadline',
      brief: '',
      amountCents: 2000,
      clientRequestId: 'test_claim_deadline_default',
    })
    expect(job.claim_deadline_at).toBeTruthy()
    const claimMs = Date.parse(job.claim_deadline_at!) - before
    expect(claimMs).toBeGreaterThanOrEqual(DEFAULT_CLAIM_DEADLINE_MS - 5000)
    expect(claimMs).toBeLessThanOrEqual(DEFAULT_CLAIM_DEADLINE_MS + 5000)
  })
})
