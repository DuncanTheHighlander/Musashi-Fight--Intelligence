/**
 * GET /api/social/coaches/[id]/rank — a single coach's belt rank + the signals
 * behind it. Public read (no quota), used for the profile badge.
 */
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/marketplace/types'
import { getCoachRankForUser } from '@/lib/marketplace/coachLeaderboard'
import { coachTitle } from '@/lib/marketplace/coachRank'

type Params = { id: string }

export async function GET(_req: Request, context: { params: Promise<Params> }) {
  try {
    const { id } = await context.params
    const db = getDb()
    const entry = await getCoachRankForUser(db, id)
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      userId: entry.userId,
      displayName: entry.displayName,
      discipline: entry.discipline,
      title: coachTitle(entry.rank),
      belt: {
        key: entry.rank.beltKey,
        label: entry.rank.beltLabel,
        stripes: entry.rank.stripes,
        degree: entry.rank.degree,
        rankLabel: entry.rank.label,
        rankIndex: entry.rank.rankIndex,
      },
      score: Number(entry.rank.score.toFixed(2)),
      stats: {
        qualityRating: Number(entry.signals.qualityRating.toFixed(2)),
        reviewCount: entry.signals.totalReviews,
        jobsCompleted: entry.signals.jobsCompleted,
        salesCount: entry.signals.salesCount,
        prepFeeling: Number(entry.signals.prepFeeling.toFixed(2)),
        prepResponses: entry.signals.prepResponses,
        wins: entry.signals.wins,
        losses: entry.signals.losses,
        draws: entry.signals.draws,
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load coach rank'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
