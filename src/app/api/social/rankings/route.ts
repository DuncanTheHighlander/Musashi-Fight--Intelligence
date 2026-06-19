import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/db'

const parseJson = <T>(value: any, fallback: T): T => {
  if (typeof value !== 'string') return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

// Ranking algorithm weights
const RANKING_WEIGHTS = {
  powerIndex: 0.3,        // 30% - Raw power output
  handSpeed: 0.25,        // 25% - Hand speed
  consistency: 0.2,       // 20% - Performance consistency
  techniqueDiversity: 0.15, // 15% - Variety of techniques
  experience: 0.1        // 10% - Number of sessions/fights
}

const calculateRankingScore = (performanceMetrics: any, techniqueData: any, experienceData: any): number => {
  const powerScore = Math.min((performanceMetrics.avgPowerIndex || 0) / 10, 1) // Normalize to 0-1
  const speedScore = Math.min((performanceMetrics.avgHandSpeedBwps || 0) / 5, 1) // Normalize to 0-1
  const consistencyScore = performanceMetrics.consistencyScore || 0
  const diversityScore = Math.min((techniqueData.uniqueTechniques || 0) / 20, 1) // Normalize to 0-1
  const experienceScore = Math.min((experienceData.totalSessions || 0) / 100, 1) // Normalize to 0-1

  return (
    powerScore * RANKING_WEIGHTS.powerIndex +
    speedScore * RANKING_WEIGHTS.handSpeed +
    consistencyScore * RANKING_WEIGHTS.consistency +
    diversityScore * RANKING_WEIGHTS.techniqueDiversity +
    experienceScore * RANKING_WEIGHTS.experience
  ) * 1000 // Scale to 0-1000
}

const getRankingTier = (score: number): string => {
  if (score >= 900) return 'Elite'
  if (score >= 750) return 'Master'
  if (score >= 600) return 'Expert'
  if (score >= 450) return 'Advanced'
  if (score >= 300) return 'Intermediate'
  if (score >= 150) return 'Novice'
  return 'Beginner'
}

export async function GET(req: Request) {
  try {
    await enforceUsage(req, 'chat')

    const { searchParams } = new URL(req.url)
    const discipline = searchParams.get('discipline')?.trim() || 'all'
    const weightClass = searchParams.get('weightClass')?.trim() || 'all'
    const region = searchParams.get('region')?.trim() || 'all'
    const limit = Math.min(Number(searchParams.get('limit') || 50), 200)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

    const db = getDb()

    // Build ranking query with performance metrics
    let query = `
      SELECT 
        fp.user_id,
        fp.display_name,
        fp.weight_class,
        fp.discipline,
        fp.location,
        fp.is_verified,
        fp.is_pro,
        fp.followers,
        -- Performance metrics
        pm.avg_hand_speed_bwps,
        pm.max_hand_speed_bwps,
        pm.avg_power_index,
        pm.max_power_index,
        pm.consistency_score,
        pm.total_frames_analyzed,
        -- Experience data
        COUNT(DISTINCT fs.id) as total_sessions,
        SUM(fs.duration_seconds) as total_training_time,
        -- Technique diversity
        COUNT(DISTINCT ta.technique_name) as unique_techniques,
        AVG(ta.success_rate) as avg_technique_success,
        -- Skill verification (approved verifications only)
        COUNT(DISTINCT sv.technique_name) as verified_techniques_count,
        -- Social reputation
        COALESCE(AVG(cr.rating), 0) as avg_content_rating,
        COUNT(DISTINCT cr.id) as content_contributions
      FROM fighter_profiles fp
      LEFT JOIN performance_metrics pm ON fp.user_id = pm.user_id
      LEFT JOIN fight_sessions fs ON fp.user_id = fs.user_id AND fs.status = 'completed'
      LEFT JOIN technique_analysis ta ON fp.user_id = ta.user_id
      LEFT JOIN skill_verifications sv ON fp.user_id = sv.user_id AND sv.status = 'approved'
      LEFT JOIN content_products cr ON fp.user_id = cr.creator_id AND cr.is_published = true
      WHERE 1=1
    `

    const params: any[] = []

    if (discipline !== 'all') {
      query += ' AND fp.discipline = ?'
      params.push(discipline)
    }

    if (weightClass !== 'all') {
      query += ' AND fp.weight_class = ?'
      params.push(weightClass)
    }

    if (region !== 'all') {
      query += ' AND fp.location LIKE ?'
      params.push(`%${region}%`)
    }

    query += `
      GROUP BY fp.user_id
      HAVING pm.avg_power_index > 0 OR COUNT(DISTINCT fs.id) > 0
      ORDER BY 
        -- Primary: Ranking score calculation (MIN(x, cap) = SQLite scalar min;
        -- LEAST() does not exist in SQLite/D1)
        (
          (MIN(COALESCE(pm.avg_power_index, 0), 10) / 10.0) * 0.3 +
          (MIN(COALESCE(pm.avg_hand_speed_bwps, 0), 5) / 5.0) * 0.25 +
          (COALESCE(pm.consistency_score, 0) * 0.2) +
          (MIN(COUNT(DISTINCT ta.technique_name), 20) / 20.0) * 0.15 +
          (MIN(COUNT(DISTINCT fs.id), 100) / 100.0) * 0.1
        ) DESC,
        -- Secondary: Raw power
        pm.avg_power_index DESC,
        -- Tertiary: Experience
        COUNT(DISTINCT fs.id) DESC,
        -- Quaternary: Social verification
        fp.is_verified DESC,
        fp.followers DESC
      LIMIT ? OFFSET ?
    `

    params.push(limit, offset)

    const results = await db.prepare(query).bind(...params).all()

    // Process ranking results
    const rankings = (results.results || []).map((row: any) => {
      const performanceMetrics = {
        avgHandSpeedBwps: Number(row.avg_hand_speed_bwps || 0),
        maxHandSpeedBwps: Number(row.max_hand_speed_bwps || 0),
        avgPowerIndex: Number(row.avg_power_index || 0),
        maxPowerIndex: Number(row.max_power_index || 0),
        consistencyScore: Number(row.consistency_score || 0),
        totalFramesAnalyzed: Number(row.total_frames_analyzed || 0)
      }

      const techniqueData = {
        uniqueTechniques: Number(row.unique_techniques || 0),
        avgTechniqueSuccess: Number(row.avg_technique_success || 0)
      }

      const experienceData = {
        totalSessions: Number(row.total_sessions || 0),
        totalTrainingTime: Number(row.total_training_time || 0)
      }

      const rankingScore = calculateRankingScore(performanceMetrics, techniqueData, experienceData)
      const rankingTier = getRankingTier(rankingScore)

      return {
        userId: row.user_id,
        displayName: row.display_name,
        weightClass: row.weight_class,
        discipline: row.discipline,
        location: parseJson(row.location, { city: '', state: '', country: '' }),
        isVerified: Boolean(row.is_verified),
        isPro: Boolean(row.is_pro),
        followers: Number(row.followers || 0),
        rankingScore: Math.round(rankingScore),
        rankingTier,
        globalRank: 0, // Will be calculated after sorting
        performanceMetrics,
        experience: experienceData,
        techniques: techniqueData,
        reputation: {
          avgContentRating: Number(row.avg_content_rating || 0),
          contentContributions: Number(row.content_contributions || 0),
          verifiedTechniques: Number(row.verified_techniques_count || 0),
          verificationLevel: row.verification_level || 'none'
        }
      }
    })

    // Assign global ranks
    rankings.forEach((fighter, index) => {
      fighter.globalRank = offset + index + 1
    })

    // Get ranking distribution statistics
    const statsQuery = `
      SELECT 
        COUNT(*) as total_fighters,
        AVG(pm.avg_power_index) as avg_power,
        AVG(pm.avg_hand_speed_bwps) as avg_speed,
        AVG(pm.consistency_score) as avg_consistency,
        COUNT(DISTINCT fp.discipline) as disciplines_count
      FROM fighter_profiles fp
      LEFT JOIN performance_metrics pm ON fp.user_id = pm.user_id
      WHERE pm.avg_power_index > 0
    `

    const stats = await db.prepare(statsQuery).bind().first()

    return NextResponse.json({
      rankings,
      stats: {
        totalFighters: Number(stats?.total_fighters || 0),
        avgPowerIndex: Number(stats?.avg_power || 0),
        avgHandSpeed: Number(stats?.avg_speed || 0),
        avgConsistency: Number(stats?.avg_consistency || 0),
        disciplinesCount: Number(stats?.disciplines_count || 0)
      },
      filters: { discipline, weightClass, region },
      pagination: { limit, offset, hasMore: rankings.length === limit }
    })

  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to fetch rankings' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const body = await req.json() as Record<string, any>
    
    // Update user's ranking after new performance data
    const { sessionId, performanceMetrics, techniqueData } = body

    if (!sessionId || !performanceMetrics) {
      return NextResponse.json({ error: 'Missing session or performance data' }, { status: 400 })
    }

    const db = getDb()
    const now = new Date().toISOString()

    // Get user's current data
    const currentData = await db
      .prepare(`
        SELECT 
          pm.avg_power_index,
          pm.avg_hand_speed_bwps,
          pm.consistency_score,
          COUNT(DISTINCT fs.id) as total_sessions,
          COUNT(DISTINCT ta.technique_name) as unique_techniques
        FROM fighter_profiles fp
        LEFT JOIN performance_metrics pm ON fp.user_id = pm.user_id
        LEFT JOIN fight_sessions fs ON fp.user_id = fs.user_id AND fs.status = 'completed'
        LEFT JOIN technique_analysis ta ON fp.user_id = ta.user_id
        WHERE fp.user_id = ?
        GROUP BY fp.user_id
      `)
      .bind(user.id)
      .first()

    if (!currentData) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 })
    }

    // Calculate new ranking
    const newRankingScore = calculateRankingScore(
      performanceMetrics,
      techniqueData || { uniqueTechniques: Number(currentData.unique_techniques || 0) },
      { totalSessions: Number(currentData.total_sessions || 0) + 1 }
    )

    const newRankingTier = getRankingTier(newRankingScore)

    // Update user's ranking in profile
    await db
      .prepare(`
        UPDATE fighter_profiles 
        SET 
          performance_stats = JSON_SET(
            COALESCE(performance_stats, '{}'),
            '$.rankingScore', ?,
            '$.rankingTier', ?,
            '$.lastRankUpdate', ?
          ),
          updated_at = ?
        WHERE user_id = ?
      `)
      .bind(
        Math.round(newRankingScore),
        newRankingTier,
        now,
        now,
        user.id
      )
      .run()

    return NextResponse.json({
      rankingScore: Math.round(newRankingScore),
      rankingTier: newRankingTier,
      previousRankingTier: currentData.rankingTier || 'unranked',
      improvement: newRankingScore > (currentData.rankingScore || 0)
    })

  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to update ranking' }, { status: 500 })
  }
}
