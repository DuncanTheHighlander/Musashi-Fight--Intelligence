/**
 * Marketplace cron maintenance — shared by /api/cron/marketplace and the
 * Cloudflare Worker scheduled handler.
 */
import type { D1Database, MarketplaceJobRow } from './types'
import { applyTransition, releaseJob } from './jobs'
import { recordRefund } from './ledger'
import { runPromotionSweep } from './coachRankStore'

const MAX_JOBS_PER_RUN = 100

export type MarketplaceCronResult = {
  expiredClaims: number
  expiredDeliveries: number
  autoReleased: number
  coachPromotions: number
  coachReviewsQueued: number
  errors: Array<{ jobId: string; error: string }>
}

export async function runMarketplaceCron(db: D1Database): Promise<MarketplaceCronResult> {
  const now = new Date().toISOString()
  const errors: Array<{ jobId: string; error: string }> = []

  const expiredClaims = await db
    .prepare(
      `SELECT * FROM marketplace_jobs
         WHERE status = 'FUNDED'
           AND claim_deadline_at IS NOT NULL
           AND claim_deadline_at < ?
         LIMIT ?`,
    )
    .bind(now, MAX_JOBS_PER_RUN)
    .all<MarketplaceJobRow>()

  let expiredClaimCount = 0
  for (const job of expiredClaims.results || []) {
    try {
      await recordRefund(db, {
        jobId: job.id,
        amountCents: job.amount_cents,
        reason: 'claim_deadline_expired',
        currency: job.currency,
      })
      await applyTransition(db, {
        jobId: job.id,
        event: 'EXPIRE',
        payload: { reason: 'claim_deadline_expired' },
      })
      expiredClaimCount++
    } catch (e) {
      errors.push({ jobId: job.id, error: e instanceof Error ? e.message : 'unknown' })
    }
  }

  const expiredDelivery = await db
    .prepare(
      `SELECT * FROM marketplace_jobs
         WHERE status IN ('CLAIMED','IN_PROGRESS')
           AND delivery_deadline_at IS NOT NULL
           AND delivery_deadline_at < ?
         LIMIT ?`,
    )
    .bind(now, MAX_JOBS_PER_RUN)
    .all<MarketplaceJobRow>()

  let expiredDeliveryCount = 0
  for (const job of expiredDelivery.results || []) {
    try {
      await recordRefund(db, {
        jobId: job.id,
        amountCents: job.amount_cents,
        reason: 'delivery_deadline_expired',
        currency: job.currency,
      })
      await applyTransition(db, {
        jobId: job.id,
        event: 'EXPIRE',
        payload: { reason: 'delivery_deadline_expired' },
      })
      if (job.analyst_id) {
        await db
          .prepare(
            `UPDATE analyst_profiles
                SET jobs_cancelled = jobs_cancelled + 1,
                    current_capacity = MAX(0, current_capacity - 1),
                    updated_at = ?
              WHERE user_id = ?`,
          )
          .bind(new Date().toISOString(), job.analyst_id)
          .run()
      }
      expiredDeliveryCount++
    } catch (e) {
      errors.push({ jobId: job.id, error: e instanceof Error ? e.message : 'unknown' })
    }
  }

  const autoRelease = await db
    .prepare(
      `SELECT * FROM marketplace_jobs
         WHERE status = 'SUBMITTED'
           AND approval_deadline_at IS NOT NULL
           AND approval_deadline_at < ?
         LIMIT ?`,
    )
    .bind(now, MAX_JOBS_PER_RUN)
    .all<MarketplaceJobRow>()

  let autoReleasedCount = 0
  for (const job of autoRelease.results || []) {
    try {
      await releaseJob(db, { jobId: job.id, autoReleased: true })
      autoReleasedCount++
    } catch (e) {
      errors.push({ jobId: job.id, error: e instanceof Error ? e.message : 'unknown' })
    }
  }

  // Coach Rank promotions: auto-promote where gates pass, queue Black+ for review.
  let coachPromotions = 0
  let coachReviewsQueued = 0
  try {
    const sweep = await runPromotionSweep(db)
    coachPromotions = sweep.promoted
    coachReviewsQueued = sweep.queued
    for (const e of sweep.errors) errors.push({ jobId: `coach:${e.userId}`, error: e.error })
  } catch (e) {
    errors.push({ jobId: 'coach:sweep', error: e instanceof Error ? e.message : 'unknown' })
  }

  return {
    expiredClaims: expiredClaimCount,
    expiredDeliveries: expiredDeliveryCount,
    autoReleased: autoReleasedCount,
    coachPromotions,
    coachReviewsQueued,
    errors,
  }
}
