import { describe, expect, test } from 'vitest'
import { createMockD1 } from '../mockD1'
import {
  ensureCoachRank,
  getCoachRank,
  runPromotionSweep,
  decideReview,
  listReviewQueue,
  handAward,
  grantReviewer,
  revokeReviewer,
  canQualityReview,
} from '../coachRankStore'

const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

/** Insert n reviews of a given rating targeting a coach (user review). */
async function seedUserReviews(
  db: ReturnType<typeof createMockD1>,
  coachId: string,
  rating: number,
  n: number,
  prefix: string,
) {
  const now = new Date().toISOString()
  for (let i = 0; i < n; i++) {
    await db
      .prepare(
        `INSERT INTO reviews (id, reviewer_id, target_id, target_type, rating, comment, created_at)
         VALUES (?, ?, ?, 'user', ?, '', ?)`,
      )
      .bind(`${prefix}_${i}`, `rv_${prefix}_${i}`, coachId, rating, now)
      .run()
  }
}

/** Force the time-in-grade clock back so the time gate is satisfied. */
async function backdateHeldSince(db: ReturnType<typeof createMockD1>, userId: string, days: number) {
  await db
    .prepare('UPDATE coach_ranks SET held_since = ? WHERE user_id = ?')
    .bind(daysAgoIso(days), userId)
    .run()
}

describe('promotion sweep', () => {
  test('auto-promotes White → Gray when reviews + quality + time are met', async () => {
    const db = createMockD1()
    await ensureCoachRank(db, 'coach_a')
    await backdateHeldSince(db, 'coach_a', 30)
    await seedUserReviews(db, 'coach_a', 5, 12, 'a') // 12 positive, avg 5

    const res = await runPromotionSweep(db)
    expect(res.promoted).toBeGreaterThanOrEqual(1)

    const rank = await getCoachRank(db, 'coach_a')
    expect(rank?.earned_belt_key).toBe('gray')
    expect(rank?.pending_review_belt).toBeNull()
  })

  test('poor average blocks promotion despite high volume', async () => {
    const db = createMockD1()
    await ensureCoachRank(db, 'coach_b')
    await backdateHeldSince(db, 'coach_b', 30)
    await seedUserReviews(db, 'coach_b', 5, 12, 'bpos') // 12 positive
    await seedUserReviews(db, 'coach_b', 1, 20, 'bneg') // drags avg below 4.0

    await runPromotionSweep(db)
    const rank = await getCoachRank(db, 'coach_b')
    expect(rank?.earned_belt_key).toBe('white')
  })

  test('time-in-grade not yet served blocks promotion', async () => {
    const db = createMockD1()
    await ensureCoachRank(db, 'coach_c') // held_since = now (0 days)
    await seedUserReviews(db, 'coach_c', 5, 15, 'c')

    await runPromotionSweep(db)
    const rank = await getCoachRank(db, 'coach_c')
    expect(rank?.earned_belt_key).toBe('white')
  })
})

describe('Quality Review queue (Brown → Black)', () => {
  test('queues for review instead of auto-promoting, then approval promotes', async () => {
    const db = createMockD1()
    await ensureCoachRank(db, 'coach_d')
    await db
      .prepare(`UPDATE coach_ranks SET earned_belt_key = 'brown', earned_rank_index = 25 WHERE user_id = ?`)
      .bind('coach_d')
      .run()
    await backdateHeldSince(db, 'coach_d', 200)
    await seedUserReviews(db, 'coach_d', 5, 260, 'd') // clears the 250 bar at avg 5

    const sweep = await runPromotionSweep(db)
    expect(sweep.queued).toBeGreaterThanOrEqual(1)

    let rank = await getCoachRank(db, 'coach_d')
    expect(rank?.earned_belt_key).toBe('brown') // NOT auto-promoted
    expect(rank?.pending_review_belt).toBe('black')

    const queue = await listReviewQueue(db)
    expect(queue.some((r) => r.user_id === 'coach_d')).toBe(true)

    rank = await decideReview(db, { userId: 'coach_d', decision: 'approve', actorUserId: 'shogun_1' })
    expect(rank.earned_belt_key).toBe('black')
    expect(rank.pending_review_belt).toBeNull()
  })

  test('hold clears the queue without promoting', async () => {
    const db = createMockD1()
    await ensureCoachRank(db, 'coach_e')
    await db
      .prepare(`UPDATE coach_ranks SET earned_belt_key = 'brown', pending_review_belt = 'black' WHERE user_id = ?`)
      .bind('coach_e')
      .run()

    const rank = await decideReview(db, { userId: 'coach_e', decision: 'hold', actorUserId: 'shogun_1' })
    expect(rank.earned_belt_key).toBe('brown')
    expect(rank.pending_review_belt).toBeNull()
  })
})

describe('hand-award and reviewer grants', () => {
  test('hand-award sets a belt outside the metric path (Coral)', async () => {
    const db = createMockD1()
    const rank = await handAward(db, { userId: 'coach_f', toBelt: 'coral', actorUserId: 'shogun_1' })
    expect(rank.earned_belt_key).toBe('coral')
  })

  test('shogun can always review; granted reviewers can too; revoke removes it', async () => {
    const db = createMockD1()
    expect(await canQualityReview(db, { id: 'sh', role: 'shogun' })).toBe(true)
    expect(await canQualityReview(db, { id: 'coach_g', role: 'user' })).toBe(false)

    await grantReviewer(db, { userId: 'coach_g', grantedBy: 'sh' })
    expect(await canQualityReview(db, { id: 'coach_g', role: 'user' })).toBe(true)

    await revokeReviewer(db, { userId: 'coach_g', actorUserId: 'sh' })
    expect(await canQualityReview(db, { id: 'coach_g', role: 'user' })).toBe(false)
  })
})
