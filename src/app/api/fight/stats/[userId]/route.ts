import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

type RouteParams = { userId: string }

function resolveTargetUserId(args: {
  pathUserId: string | undefined
  queryUserId: string | null
  sessionUserId: string
  role: string
}): { userId: string } | { error: 'forbidden' | 'conflict' } {
  const fromPath = args.pathUserId?.trim()
  const fromQuery = args.queryUserId?.trim()

  if (fromQuery && fromPath && fromQuery !== fromPath) {
    return { error: 'conflict' }
  }

  const requested = fromPath || fromQuery || args.sessionUserId

  if (requested !== args.sessionUserId && args.role !== 'shogun') {
    return { error: 'forbidden' }
  }
  return { userId: requested }
}

export async function GET(req: Request, context: { params: Promise<RouteParams> }) {
  try {
    const user = await requireUser(req)
    const { searchParams } = new URL(req.url)
    const { userId: pathUserId } = await context.params
    const resolved = resolveTargetUserId({
      pathUserId,
      queryUserId: searchParams.get('userId'),
      sessionUserId: user.id,
      role: user.role,
    })
    if ('error' in resolved) {
      return NextResponse.json(
        { error: resolved.error === 'conflict' ? 'Conflicting userId parameters' : 'Forbidden' },
        { status: 403 }
      )
    }
    const userId = resolved.userId
    const period = searchParams.get('period') || '30' // days
    const includeTechniques = searchParams.get('includeTechniques') === 'true'

    const db = getDb()
    const parsedPeriod = Number.parseInt(period, 10)
    const daysAgo = Number.isFinite(parsedPeriod) ? Math.min(365, Math.max(1, parsedPeriod)) : 30
    const cutoffDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString()

    // Get overall stats
    const stats = await db.prepare(`
      SELECT 
        COUNT(DISTINCT fs.id) as total_sessions,
        COALESCE(SUM(fs.duration_seconds), 0) as total_duration_seconds,
        COALESCE(AVG(pm.avg_hand_speed_bwps), 0) as avg_hand_speed_bwps,
        COALESCE(MAX(pm.max_hand_speed_bwps), 0) as max_hand_speed_bwps,
        COALESCE(AVG(pm.avg_power_index), 0) as avg_power_index,
        COALESCE(MAX(pm.max_power_index), 0) as max_power_index,
        COALESCE(SUM(pm.total_strikes), 0) as total_strikes,
        COALESCE(AVG(pm.technique_diversity_score), 0) as avg_technique_diversity,
        COALESCE(AVG(pm.consistency_score), 0) as avg_consistency_score,
        COALESCE(AVG(pm.efficiency_score), 0) as avg_efficiency_score
      FROM fight_sessions fs
      LEFT JOIN performance_metrics pm ON fs.id = pm.session_id
      WHERE fs.user_id = ? 
        AND fs.start_time >= ?
        AND fs.status = 'completed'
    `).bind(userId, cutoffDate).first()

    // Get session breakdown by ruleset
    const { results: rulesetStats } = await db.prepare(`
      SELECT 
        fs.ruleset,
        COUNT(*) as session_count,
        COALESCE(AVG(pm.avg_hand_speed_bwps), 0) as avg_speed,
        COALESCE(AVG(pm.avg_power_index), 0) as avg_power,
        COALESCE(SUM(pm.total_strikes), 0) as total_strikes
      FROM fight_sessions fs
      LEFT JOIN performance_metrics pm ON fs.id = pm.session_id
      WHERE fs.user_id = ? 
        AND fs.start_time >= ?
        AND fs.status = 'completed'
      GROUP BY fs.ruleset
      ORDER BY session_count DESC
    `).bind(userId, cutoffDate).all()

    // Get performance trends over time
    const { results: trends } = await db.prepare(`
      SELECT 
        DATE(fs.start_time) as date,
        COUNT(*) as sessions,
        COALESCE(AVG(pm.avg_hand_speed_bwps), 0) as avg_speed,
        COALESCE(AVG(pm.avg_power_index), 0) as avg_power,
        COALESCE(SUM(pm.total_strikes), 0) as total_strikes
      FROM fight_sessions fs
      LEFT JOIN performance_metrics pm ON fs.id = pm.session_id
      WHERE fs.user_id = ? 
        AND fs.start_time >= ?
        AND fs.status = 'completed'
      GROUP BY DATE(fs.start_time)
      ORDER BY date DESC
      LIMIT 30
    `).bind(userId, cutoffDate).all()

    let techniqueStats: any[] = []
    if (includeTechniques) {
      const { results } = await db.prepare(`
        SELECT 
          ta.technique_name,
          ta.technique_category,
          COUNT(*) as execution_count,
          COALESCE(AVG(ta.avg_speed_bwps), 0) as avg_speed,
          COALESCE(AVG(ta.avg_power_index), 0) as avg_power,
          COALESCE(AVG(ta.success_rate), 0) as avg_success_rate
        FROM technique_analysis ta
        JOIN fight_sessions fs ON ta.session_id = fs.id
        WHERE fs.user_id = ? 
          AND fs.start_time >= ?
          AND fs.status = 'completed'
        GROUP BY ta.technique_name, ta.technique_category
        ORDER BY execution_count DESC
        LIMIT 20
      `).bind(userId, cutoffDate).all()
      techniqueStats = results
    }

    // Get recent sessions
    const { results: recentSessions } = await db.prepare(`
      SELECT 
        fs.id,
        fs.title,
        fs.ruleset,
        fs.start_time,
        fs.duration_seconds,
        pm.avg_hand_speed_bwps,
        pm.avg_power_index,
        pm.total_strikes
      FROM fight_sessions fs
      LEFT JOIN performance_metrics pm ON fs.id = pm.session_id
      WHERE fs.user_id = ? 
        AND fs.start_time >= ?
        AND fs.status = 'completed'
      ORDER BY fs.start_time DESC
      LIMIT 10
    `).bind(userId, cutoffDate).all()

    return NextResponse.json({
      period: `${period} days`,
      userId,
      summary: {
        totalSessions: stats?.total_sessions || 0,
        totalDurationSeconds: stats?.total_duration_seconds || 0,
        avgHandSpeedBwps: parseFloat(stats?.avg_hand_speed_bwps || '0'),
        maxHandSpeedBwps: parseFloat(stats?.max_hand_speed_bwps || '0'),
        avgPowerIndex: parseFloat(stats?.avg_power_index || '0'),
        maxPowerIndex: parseFloat(stats?.max_power_index || '0'),
        totalStrikes: stats?.total_strikes || 0,
        avgTechniqueDiversity: parseFloat(stats?.avg_technique_diversity || '0'),
        avgConsistencyScore: parseFloat(stats?.avg_consistency_score || '0'),
        avgEfficiencyScore: parseFloat(stats?.avg_efficiency_score || '0')
      },
      rulesetBreakdown: rulesetStats,
      trends: trends,
      techniques: techniqueStats,
      recentSessions: recentSessions
    })
  } catch (error) {
    console.error('Failed to fetch fight stats:', error)
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
