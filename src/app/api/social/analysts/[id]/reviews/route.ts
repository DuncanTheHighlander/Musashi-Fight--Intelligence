/**
 * GET /api/social/analysts/[id]/reviews — public reviews for an analyst.
 * Also returns aggregate stats so a single call powers the profile page.
 */
import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/marketplace/types'
import type { AnalystProfileRow, MarketplaceReviewRow } from '@/lib/marketplace/types'

type Params = { id: string }

export async function GET(req: Request, context: { params: Promise<Params> }) {
  try {
    await enforceUsage(req, 'chat')
    const { id } = await context.params
    const { searchParams } = new URL(req.url)
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 20), 1), 100)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

    const db = getDb()

    const reviewsResult = await db
      .prepare(
        `SELECT r.*, fp.display_name as reviewer_name
           FROM marketplace_reviews r
           LEFT JOIN fighter_profiles fp ON fp.user_id = r.reviewer_id
          WHERE r.analyst_id = ? AND r.is_hidden = 0
          ORDER BY r.created_at DESC
          LIMIT ? OFFSET ?`,
      )
      .bind(id, limit, offset)
      .all<MarketplaceReviewRow & { reviewer_name?: string }>()

    const profile = await db
      .prepare('SELECT * FROM analyst_profiles WHERE user_id = ?')
      .bind(id)
      .first<AnalystProfileRow>()

    return NextResponse.json({
      reviews: (reviewsResult.results || []).map((r) => ({
        id: r.id,
        jobId: r.job_id,
        reviewerId: r.reviewer_id,
        reviewerName: (r as { reviewer_name?: string }).reviewer_name ?? null,
        tacticalAccuracy: r.tactical_accuracy,
        actionability: r.actionability,
        communication: r.communication,
        avgScore: r.avg_score,
        comment: r.comment,
        wouldHireAgain: Boolean(r.would_hire_again),
        createdAt: r.created_at,
      })),
      aggregate: profile
        ? {
            reviewCount: profile.review_count,
            avgTacticalAccuracy: profile.avg_tactical_accuracy,
            avgActionability: profile.avg_actionability,
            avgCommunication: profile.avg_communication,
            avgOverall: profile.avg_overall,
            beltTier: profile.belt_tier,
            beltScore: profile.belt_score,
            jobsCompleted: profile.jobs_completed,
          }
        : null,
      limit,
      offset,
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to fetch reviews' }, { status: 400 })
  }
}
