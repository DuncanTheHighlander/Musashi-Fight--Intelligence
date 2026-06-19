import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

export async function POST(req: Request) {
  try {
    const body = await req.json() as { userId?: string }
    const { userId } = body

    if (!userId) {
      return NextResponse.json({ error: 'User ID required' }, { status: 400 })
    }

    const db = getDb()

    // Get aggregated performance stats for the user
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
        COALESCE(AVG(pm.efficiency_score), 0) as avg_efficiency_score,
        COALESCE(AVG(pm.data_quality_score), 0) as avg_data_quality_score
      FROM fight_sessions fs
      LEFT JOIN performance_metrics pm ON fs.id = pm.session_id
      WHERE fs.user_id = ? 
        AND fs.status = 'completed'
    `).bind(userId).first()

    // Get top techniques
    const { results: topTechniques } = await db.prepare(`
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
        AND fs.status = 'completed'
      GROUP BY ta.technique_name, ta.technique_category
      ORDER BY execution_count DESC
      LIMIT 10
    `).bind(userId).all()

    // Get recent performance trend (last 10 sessions)
    const { results: recentTrend } = await db.prepare(`
      SELECT 
        fs.start_time,
        pm.avg_hand_speed_bwps,
        pm.avg_power_index,
        pm.total_strikes,
        pm.consistency_score
      FROM fight_sessions fs
      LEFT JOIN performance_metrics pm ON fs.id = pm.session_id
      WHERE fs.user_id = ? 
        AND fs.status = 'completed'
      ORDER BY fs.start_time DESC
      LIMIT 10
    `).bind(userId).all()

    // Calculate ranking (simple percentile based on total strikes)
    const rankingData = await db.prepare(`
      SELECT 
        COUNT(*) as total_fighters,
        SUM(CASE WHEN user_total_strikes >= my_stats.total_strikes THEN 1 ELSE 0 END) as fighters_better
      FROM (
        SELECT 
          fs.user_id,
          COALESCE(SUM(pm.total_strikes), 0) as total_strikes
        FROM fight_sessions fs
        LEFT JOIN performance_metrics pm ON fs.id = pm.session_id
        WHERE fs.status = 'completed'
        GROUP BY fs.user_id
      ) all_fighters,
      (
        SELECT 
          COALESCE(SUM(pm.total_strikes), 0) as total_strikes
        FROM fight_sessions fs
        LEFT JOIN performance_metrics pm ON fs.id = pm.session_id
        WHERE fs.user_id = ? 
          AND fs.status = 'completed'
      ) my_stats
    `).bind(userId).first()

    const totalFighters = rankingData?.total_fighters || 1
    const fightersBetter = rankingData?.fighters_better || 0
    const rankingPercentile = Math.round(((totalFighters - fightersBetter) / totalFighters) * 100)

    const performanceStats = {
      avgHandSpeedBwps: parseFloat(stats?.avg_hand_speed_bwps || '0'),
      maxHandSpeedBwps: parseFloat(stats?.max_hand_speed_bwps || '0'),
      avgPowerIndex: parseFloat(stats?.avg_power_index || '0'),
      maxPowerIndex: parseFloat(stats?.max_power_index || '0'),
      totalSessions: stats?.total_sessions || 0,
      totalStrikes: stats?.total_strikes || 0,
      techniqueDiversity: parseFloat(stats?.avg_technique_diversity || '0'),
      consistencyScore: parseFloat(stats?.avg_consistency_score || '0'),
      efficiencyScore: parseFloat(stats?.avg_efficiency_score || '0'),
      dataQualityScore: parseFloat(stats?.avg_data_quality_score || '0'),
      ranking: rankingPercentile,
      topTechniques: topTechniques.map((t: any) => ({
        name: t.technique_name,
        category: t.technique_category,
        count: t.execution_count,
        avgSpeed: parseFloat(t.avg_speed || '0'),
        avgPower: parseFloat(t.avg_power || '0'),
        successRate: parseFloat(t.avg_success_rate || '0')
      })),
      recentTrend: recentTrend.map((t: any) => ({
        date: t.start_time,
        avgSpeed: parseFloat(t.avg_hand_speed_bwps || '0'),
        avgPower: parseFloat(t.avg_power_index || '0'),
        totalStrikes: t.total_strikes || 0,
        consistency: parseFloat(t.consistency_score || '0')
      }))
    }

    // Update fighter profile with new performance stats
    await db.prepare(`
      UPDATE fighter_profiles 
      SET performance_stats = ?, updated_at = ?
      WHERE user_id = ?
    `).bind(
      JSON.stringify(performanceStats),
      new Date().toISOString(),
      userId
    ).run()

    return NextResponse.json({
      userId,
      performanceStats,
      updatedAt: new Date().toISOString()
    })
  } catch (error) {
    console.error('Failed to update fighter profile performance stats:', error)
    return NextResponse.json({ error: 'Failed to update performance stats' }, { status: 500 })
  }
}
