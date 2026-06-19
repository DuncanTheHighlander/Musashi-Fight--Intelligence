/**
 * POST /api/social/jobs/[id]/review — fighter rates the completed job.
 *
 * Body: { tacticalAccuracy: 1..5, actionability: 1..5, communication: 1..5,
 *         comment?: string, wouldHireAgain?: boolean }
 *
 * Only allowed on jobs in RELEASED or RESOLVED_RELEASE/SPLIT. Writes a
 * marketplace_reviews row AND recomputes the analyst's denormalized stats
 * (avg_* + belt_score + eligible belt_tier promotion).
 */
import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb, newId } from '@/lib/marketplace/types'
import type { MarketplaceJobRow, MarketplaceReviewRow } from '@/lib/marketplace/types'
import { computeBeltScore, computeEligibleTier } from '@/lib/marketplace/beltTier'
import type { BeltTier } from '@/lib/marketplace/beltTier'

type Params = { id: string }

const clamp1to5 = (n: unknown): number => {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return 0
  return Math.max(1, Math.min(5, v))
}

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await enforceUsage(req, 'chat')
    const { id } = await context.params
    const body = (await req.json()) as Record<string, unknown>

    const tacticalAccuracy = clamp1to5(body?.tacticalAccuracy)
    const actionability = clamp1to5(body?.actionability)
    const communication = clamp1to5(body?.communication)
    const comment = String(body?.comment || '').slice(0, 4000)
    const wouldHireAgain = body?.wouldHireAgain === false ? 0 : 1

    if (!tacticalAccuracy || !actionability || !communication) {
      return NextResponse.json({ error: 'all three scores (1-5) required' }, { status: 400 })
    }
    const avg = (tacticalAccuracy + actionability + communication) / 3

    const db = getDb()
    const job = await db
      .prepare('SELECT * FROM marketplace_jobs WHERE id = ?')
      .bind(id)
      .first<MarketplaceJobRow>()
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (job.fighter_id !== user.id) {
      return NextResponse.json({ error: 'Only the fighter can review' }, { status: 403 })
    }
    if (!job.analyst_id) {
      return NextResponse.json({ error: 'No analyst to review' }, { status: 400 })
    }
    const reviewable: string[] = ['RELEASED', 'RESOLVED_RELEASE', 'RESOLVED_SPLIT']
    if (!reviewable.includes(job.status)) {
      return NextResponse.json({ error: 'Job not reviewable yet' }, { status: 400 })
    }

    // One review per job
    const existing = await db
      .prepare('SELECT id FROM marketplace_reviews WHERE job_id = ?')
      .bind(id)
      .first<{ id: string }>()
    if (existing) {
      return NextResponse.json({ error: 'Already reviewed', reviewId: existing.id }, { status: 409 })
    }

    const reviewId = newId('rev')
    const now = new Date().toISOString()

    await db
      .prepare(
        `INSERT INTO marketplace_reviews (
           id, job_id, reviewer_id, analyst_id,
           tactical_accuracy, actionability, communication, avg_score,
           comment, would_hire_again, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        reviewId,
        id,
        user.id,
        job.analyst_id,
        tacticalAccuracy,
        actionability,
        communication,
        avg,
        comment,
        wouldHireAgain,
        now,
        now,
      )
      .run()

    // Recompute analyst denormalized stats
    const agg = await db
      .prepare(
        `SELECT
           COUNT(*) as n,
           AVG(tactical_accuracy) as ta,
           AVG(actionability)     as act,
           AVG(communication)     as com,
           AVG(avg_score)         as overall
         FROM marketplace_reviews
         WHERE analyst_id = ? AND is_hidden = 0`,
      )
      .bind(job.analyst_id)
      .first<{ n: number; ta: number; act: number; com: number; overall: number }>()

    const jobsCompletedRow = await db
      .prepare(
        `SELECT COUNT(*) as c FROM marketplace_jobs
          WHERE analyst_id = ? AND status IN ('RELEASED','RESOLVED_RELEASE','RESOLVED_SPLIT')`,
      )
      .bind(job.analyst_id)
      .first<{ c: number }>()

    const reviewCount = Number(agg?.n ?? 0)
    const ta = Number(agg?.ta ?? 0)
    const act = Number(agg?.act ?? 0)
    const com = Number(agg?.com ?? 0)
    const overall = Number(agg?.overall ?? 0)
    const jobsCompleted = Number(jobsCompletedRow?.c ?? 0)
    const beltScore = computeBeltScore(overall, jobsCompleted)

    const profileRow = await db
      .prepare('SELECT belt_tier FROM analyst_profiles WHERE user_id = ?')
      .bind(job.analyst_id)
      .first<{ belt_tier: BeltTier }>()
    const currentTier = (profileRow?.belt_tier ?? 'white') as BeltTier
    const eligibleTier = computeEligibleTier(overall, jobsCompleted, currentTier)

    await db
      .prepare(
        `UPDATE analyst_profiles
            SET avg_tactical_accuracy = ?,
                avg_actionability     = ?,
                avg_communication     = ?,
                avg_overall           = ?,
                review_count          = ?,
                belt_score            = ?,
                belt_tier             = ?,
                updated_at            = ?
          WHERE user_id = ?`,
      )
      .bind(ta, act, com, overall, reviewCount, beltScore, eligibleTier, now, job.analyst_id)
      .run()

    return NextResponse.json({
      reviewId,
      avgScore: avg,
      analystStats: {
        reviewCount,
        avgOverall: overall,
        beltScore,
        beltTier: eligibleTier,
        promoted: eligibleTier !== currentTier,
      },
    }, { status: 201 })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to submit review' }, { status: 400 })
  }
}
