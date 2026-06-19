/**
 * GET /api/social/coaches/leaderboard — public coach ranking.
 *
 * Ranks the unified coach population (analysts, content creators, reviewed
 * users) on the BJJ-style belt ladder. Public read: no auth gate and no usage
 * quota consumed, so the leaderboard is browsable logged-out.
 *   ?limit=50&offset=0
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/marketplace/types'
import { getCoachLeaderboard } from '@/lib/marketplace/coachLeaderboard'
import { coachTitle } from '@/lib/marketplace/coachRank'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 200)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

    const db = getDb()
    const entries = await getCoachLeaderboard(db, { limit, offset })

    const coaches = entries.map((e, i) => ({
      position: offset + i + 1,
      userId: e.userId,
      displayName: e.displayName,
      discipline: e.discipline,
      isVerified: e.isVerified,
      isPro: e.isPro,
      title: coachTitle(e.rank),
      belt: {
        key: e.rank.beltKey,
        label: e.rank.beltLabel,
        stripes: e.rank.stripes,
        degree: e.rank.degree,
        rankLabel: e.rank.label,
        rankIndex: e.rank.rankIndex,
      },
      score: Number(e.rank.score.toFixed(2)),
      stats: {
        qualityRating: Number(e.signals.qualityRating.toFixed(2)),
        reviewCount: e.signals.totalReviews,
        jobsCompleted: e.signals.jobsCompleted,
        salesCount: e.signals.salesCount,
        prepFeeling: Number(e.signals.prepFeeling.toFixed(2)),
        prepResponses: e.signals.prepResponses,
        wins: e.signals.wins,
        losses: e.signals.losses,
        draws: e.signals.draws,
      },
    }))

    return NextResponse.json({ coaches, limit, offset })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load leaderboard'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
