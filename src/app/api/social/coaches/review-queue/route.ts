/**
 * GET /api/social/coaches/review-queue — coaches whose metrics qualify them for a
 * review-gated belt (Black+), awaiting a Musashi Quality Review.
 * Visible to shogun and appointed Quality Reviewers.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { buildPromotionState, canQualityReview } from '@/lib/marketplace/coachRankStore'
import { coachTitle, type BeltColorKey } from '@/lib/marketplace/coachRank'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const db = getDb()
    if (!(await canQualityReview(db, user))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rows = await db
      .prepare(
        `SELECT cr.user_id, cr.earned_belt_key, cr.pending_review_belt, cr.held_since, cr.updated_at,
                fp.display_name, fp.discipline, mu.display_name AS mu_name, mu.email
           FROM coach_ranks cr
           LEFT JOIN fighter_profiles fp ON fp.user_id = cr.user_id
           LEFT JOIN musashi_users mu ON mu.id = cr.user_id
          WHERE cr.pending_review_belt IS NOT NULL
          ORDER BY cr.updated_at ASC`,
      )
      .bind()
      .all<{
        user_id: string
        earned_belt_key: BeltColorKey
        pending_review_belt: BeltColorKey
        held_since: string
        updated_at: string
        display_name: string | null
        discipline: string | null
        mu_name: string | null
        email: string | null
      }>()

    const queue = await Promise.all((rows.results || []).map(async (r) => {
      const state = await buildPromotionState(db, r.user_id, {
        user_id: r.user_id,
        earned_belt_key: r.earned_belt_key,
        earned_rank_index: 0,
        held_since: r.held_since,
        promoted_at: null,
        status: 'active',
        pending_review_belt: r.pending_review_belt,
        created_at: r.held_since,
        updated_at: r.updated_at,
      })

      return {
        userId: r.user_id,
        displayName: r.display_name?.trim() || r.mu_name?.trim() || r.email?.split('@')[0] || 'Coach',
        discipline: r.discipline?.trim() || '',
        currentBelt: r.earned_belt_key,
        pendingBelt: r.pending_review_belt,
        pendingTitle: coachTitle({ beltKey: r.pending_review_belt, degree: r.pending_review_belt === 'black' ? 1 : 0 }),
        heldSince: r.held_since,
        queuedAt: r.updated_at,
        metrics: {
          positiveReviews: state.positiveReviews,
          recentAvgRating: Number(state.avgRating.toFixed(2)),
          daysInGrade: Math.floor(state.daysInGrade),
          activeRecently: state.activeRecently,
        },
      }
    }))

    return NextResponse.json({ queue })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    return NextResponse.json({ error: code || 'Failed to load review queue' }, { status: 400 })
  }
}
