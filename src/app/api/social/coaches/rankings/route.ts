import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/db'

// Coach Ranking Weights (separate from fighter rankings)
const COACH_WEIGHTS = {
  preFightQuality: 0.40,       // 40% - Average pre-fight review rating
  adviceEffectiveness: 0.25,   // 25% - Post-fight advice effectiveness score
  winCorrelation: 0.15,        // 15% - Win rate of coached fighters
  volume: 0.10,                // 10% - Number of breakdowns delivered
  responseSpeed: 0.10,         // 10% - Response rate + delivery speed
}

const calculateCoachScore = (metrics: {
  avgPreFightRating: number
  avgEffectiveness: number
  winRate: number
  completedOffers: number
  avgResponseDays: number
}): number => {
  const qualityScore = (metrics.avgPreFightRating / 5) // Normalize 0-1
  const effectivenessScore = (metrics.avgEffectiveness / 5) // Normalize 0-1
  const winScore = metrics.winRate // Already 0-1
  const volumeScore = Math.min(metrics.completedOffers / 50, 1) // Cap at 50 completed
  const speedScore = metrics.avgResponseDays > 0
    ? Math.max(0, 1 - (metrics.avgResponseDays / 14)) // 14 days = 0 score
    : 0.5 // Default if no data

  return (
    qualityScore * COACH_WEIGHTS.preFightQuality +
    effectivenessScore * COACH_WEIGHTS.adviceEffectiveness +
    winScore * COACH_WEIGHTS.winCorrelation +
    volumeScore * COACH_WEIGHTS.volume +
    speedScore * COACH_WEIGHTS.responseSpeed
  ) * 1000 // Scale to 0-1000
}

const getCoachTier = (score: number): string => {
  if (score >= 850) return 'Legendary'
  if (score >= 700) return 'Master Coach'
  if (score >= 550) return 'Expert Coach'
  if (score >= 400) return 'Skilled Coach'
  if (score >= 250) return 'Rising Coach'
  if (score >= 100) return 'New Coach'
  return 'Unranked'
}

export async function GET(req: Request) {
  try {
    await enforceUsage(req, 'chat')

    const { searchParams } = new URL(req.url)
    const discipline = searchParams.get('discipline')?.trim() || 'all'
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

    const db = getDb()

    // Find all users who have completed at least one breakdown offer (= coaches)
    let coachQuery = `
      SELECT
        bo.coach_id,
        fp.display_name,
        fp.discipline,
        fp.weight_class,
        fp.is_verified,
        fp.is_pro,
        fp.followers,
        fp.location,
        -- Offer stats
        COUNT(DISTINCT CASE WHEN bo.status = 'completed' THEN bo.id END) as completed_offers,
        COUNT(DISTINCT CASE WHEN bo.status IN ('pending','accepted','completed') THEN bo.id END) as total_offers,
        -- Average response time (days between request creation and offer creation)
        AVG(
          CASE WHEN bo.status = 'completed'
          THEN julianday(bo.created_at) - julianday(sr.created_at)
          ELSE NULL END
        ) as avg_response_days,
        -- Pre-fight review stats
        AVG(CASE WHEN r.review_phase = 'pre_fight' THEN r.rating ELSE NULL END) as avg_pre_fight_rating,
        COUNT(CASE WHEN r.review_phase = 'pre_fight' THEN 1 END) as pre_fight_review_count,
        -- Post-fight review stats
        AVG(CASE WHEN r.review_phase = 'post_fight' THEN r.rating ELSE NULL END) as avg_post_fight_rating,
        AVG(CASE WHEN r.review_phase = 'post_fight' THEN r.advice_effectiveness ELSE NULL END) as avg_effectiveness,
        COUNT(CASE WHEN r.review_phase = 'post_fight' THEN 1 END) as post_fight_review_count,
        -- Fight outcomes from post-fight reviews
        COUNT(CASE WHEN r.fight_outcome = 'win' THEN 1 END) as wins,
        COUNT(CASE WHEN r.fight_outcome = 'loss' THEN 1 END) as losses,
        COUNT(CASE WHEN r.fight_outcome = 'draw' THEN 1 END) as draws
      FROM breakdown_offers bo
      JOIN fighter_profiles fp ON fp.user_id = bo.coach_id
      JOIN scouting_requests sr ON sr.id = bo.request_id
      LEFT JOIN reviews r ON r.target_id = bo.coach_id AND r.target_type = 'user'
        AND r.coaching_session_id = bo.id
      WHERE bo.status IN ('completed', 'accepted')
    `

    const params: any[] = []

    if (discipline !== 'all') {
      coachQuery += ' AND fp.discipline = ?'
      params.push(discipline)
    }

    coachQuery += `
      GROUP BY bo.coach_id
      ORDER BY completed_offers DESC, avg_pre_fight_rating DESC
      LIMIT ? OFFSET ?
    `
    params.push(limit, offset)

    const results = await db.prepare(coachQuery).bind(...params).all()

    const coaches = (results.results || []).map((row: any, index: number) => {
      const completedOffers = Number(row.completed_offers || 0)
      const avgPreFightRating = Number(row.avg_pre_fight_rating || 0)
      const avgEffectiveness = Number(row.avg_effectiveness || 0)
      const wins = Number(row.wins || 0)
      const losses = Number(row.losses || 0)
      const draws = Number(row.draws || 0)
      const totalOutcomes = wins + losses + draws
      const winRate = totalOutcomes > 0 ? wins / totalOutcomes : 0
      const avgResponseDays = Number(row.avg_response_days || 0)

      const coachScore = calculateCoachScore({
        avgPreFightRating,
        avgEffectiveness,
        winRate,
        completedOffers,
        avgResponseDays,
      })

      const coachTier = getCoachTier(coachScore)

      return {
        coachId: row.coach_id,
        displayName: row.display_name || '',
        discipline: row.discipline || '',
        weightClass: row.weight_class || '',
        isVerified: Boolean(row.is_verified),
        isPro: Boolean(row.is_pro),
        followers: Number(row.followers || 0),
        coachScore: Math.round(coachScore),
        coachTier,
        rank: offset + index + 1,
        stats: {
          completedOffers,
          totalOffers: Number(row.total_offers || 0),
          avgPreFightRating: Math.round(avgPreFightRating * 10) / 10,
          preFightReviewCount: Number(row.pre_fight_review_count || 0),
          avgPostFightRating: Math.round(Number(row.avg_post_fight_rating || 0) * 10) / 10,
          avgEffectiveness: Math.round(avgEffectiveness * 10) / 10,
          postFightReviewCount: Number(row.post_fight_review_count || 0),
          winRate: Math.round(winRate * 100),
          outcomes: { wins, losses, draws },
          avgResponseDays: Math.round(avgResponseDays * 10) / 10,
        },
      }
    })

    // Sort by coach score descending
    coaches.sort((a, b) => b.coachScore - a.coachScore)
    coaches.forEach((coach, i) => { coach.rank = offset + i + 1 })

    return NextResponse.json({
      coaches,
      weights: COACH_WEIGHTS,
      pagination: { limit, offset, hasMore: coaches.length === limit },
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to fetch coach rankings' }, { status: 500 })
  }
}
