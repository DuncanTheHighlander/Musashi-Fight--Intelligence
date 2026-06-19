import { describe, expect, test } from 'vitest'
import {
  DEFAULT_CLAIM_DEADLINE_MS,
  DEFAULT_DELIVERY_DEADLINE_MS,
  defaultClaimDeadlineAt,
  defaultDeliveryDeadlineAt,
} from '../deadlines'
import { createJob, fundJob } from '../jobs'
import { getJobBalance } from '../ledger'
import { createMockD1 } from '../mockD1'

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
    const before = Date.now()

    const job = await createJob(db, {
      fighterId: 'dev',
      jobType: 'direct_hire',
      title: 'Direct hire test',
      brief: 'brief',
      amountCents: 5000,
      analystId: 'analyst_demo',
      clientRequestId: 'test_direct_hire_claim',
    })

    const funded = await fundJob(db, { jobId: job.id, actorUserId: 'dev' })

    expect(funded.status).toBe('CLAIMED')
    expect(funded.analyst_id).toBe('analyst_demo')
    expect(funded.delivery_deadline_at).toBeTruthy()
    const deliveryMs = Date.parse(funded.delivery_deadline_at!) - before
    expect(deliveryMs).toBeGreaterThanOrEqual(DEFAULT_DELIVERY_DEADLINE_MS - 5000)
    expect(deliveryMs).toBeLessThanOrEqual(DEFAULT_DELIVERY_DEADLINE_MS + 5000)
  })
})

describe('fundJob capacity preflight (no escrow stranded)', () => {
  test('throws before holding funds when the analyst is at capacity', async () => {
    const db = createMockD1()
    // Force the demo analyst to zero capacity so the preflight rejects.
    await db
      .prepare('UPDATE analyst_profiles SET max_capacity = 0 WHERE user_id = ?')
      .bind('analyst_demo')
      .run()

    const job = await createJob(db, {
      fighterId: 'dev',
      jobType: 'direct_hire',
      title: 'Capacity preflight test',
      brief: 'brief',
      amountCents: 5000,
      analystId: 'analyst_demo',
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
