import { describe, expect, test } from 'vitest'
import { createJob, fundJob } from '../jobs'
import { createMockD1 } from '../mockD1'
import { hasActiveJobBetween } from '../messagingGate'

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

/** Direct-hire funding auto-claims → CLAIMED, giving a fighter↔analyst pair on a live job. */
async function seedClaimedJob(db: ReturnType<typeof createMockD1>, fighterId: string, analystId: string) {
  await seedEnabledAnalyst(db, analystId)
  const job = await createJob(db, {
    fighterId,
    jobType: 'direct_hire',
    title: 'Gate test job',
    brief: 'brief',
    amountCents: 5000,
    analystId,
  })
  const funded = await fundJob(db, { jobId: job.id, actorUserId: fighterId })
  return funded
}

describe('messaging gate — hasActiveJobBetween', () => {
  test('false when no job links the two users', async () => {
    const db = createMockD1()
    expect(await hasActiveJobBetween(db, 'fighter1', 'analyst1')).toBe(false)
  })

  test('true while a funded job is live (either direction)', async () => {
    const db = createMockD1()
    const job = await seedClaimedJob(db, 'fighter1', 'analyst1')
    expect(job.status).toBe('CLAIMED')
    expect(await hasActiveJobBetween(db, 'fighter1', 'analyst1')).toBe(true)
    expect(await hasActiveJobBetween(db, 'analyst1', 'fighter1')).toBe(true)
  })

  test('re-closes once the job reaches a terminal state', async () => {
    const db = createMockD1()
    const job = await seedClaimedJob(db, 'fighter1', 'analyst1')
    await db
      .prepare(`UPDATE marketplace_jobs SET status = 'RELEASED' WHERE id = ?`)
      .bind(job.id)
      .run()
    expect(await hasActiveJobBetween(db, 'fighter1', 'analyst1')).toBe(false)
  })

  test('does not leak to an unrelated third party', async () => {
    const db = createMockD1()
    await seedClaimedJob(db, 'fighter1', 'analyst1')
    expect(await hasActiveJobBetween(db, 'fighter1', 'stranger')).toBe(false)
    expect(await hasActiveJobBetween(db, 'analyst1', 'stranger')).toBe(false)
  })

  test('never opens a self-conversation', async () => {
    const db = createMockD1()
    expect(await hasActiveJobBetween(db, 'fighter1', 'fighter1')).toBe(false)
  })
})
