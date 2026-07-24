import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMockD1 } from '../mockD1'
import { appendTransaction } from '../ledger'

describe('appendTransaction idempotency', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('returns existing row for duplicate idempotency key', async () => {
    const db = createMockD1()
    const first = await appendTransaction(db, {
      jobId: 'job_1',
      type: 'HOLD',
      amountCents: 5000,
      idempotencyKey: 'job_job_1_hold',
    })
    const second = await appendTransaction(db, {
      jobId: 'job_1',
      type: 'HOLD',
      amountCents: 5000,
      idempotencyKey: 'job_job_1_hold',
    })
    expect(second.id).toBe(first.id)
  })

  test('returns raced row when insert hits UNIQUE constraint', async () => {
    const db = createMockD1()
    const first = await appendTransaction(db, {
      jobId: 'job_2',
      type: 'HOLD',
      amountCents: 2500,
      idempotencyKey: 'job_job_2_hold',
    })

    const originalPrepare = db.prepare.bind(db)
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      const stmt = originalPrepare(sql)
      if (sql.includes('INSERT INTO marketplace_transactions')) {
        return {
          ...stmt,
          run: (...args: unknown[]) => {
            throw new Error('UNIQUE constraint failed: marketplace_transactions.idempotency_key')
          },
        }
      }
      return stmt
    })

    const raced = await appendTransaction(db, {
      jobId: 'job_2',
      type: 'HOLD',
      amountCents: 2500,
      idempotencyKey: 'job_job_2_hold',
    })
    expect(raced.id).toBe(first.id)
  })
})
