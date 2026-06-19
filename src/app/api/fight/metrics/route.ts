import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json() as {
      sessionId: string
      metrics: {
        avgHandSpeedBwps?: number
        maxHandSpeedBwps?: number
        avgHandBurstBwps?: number
        maxHandBurstBwps?: number
        avgFootSpeedBwps?: number
        maxFootSpeedBwps?: number
        avgHipSpeedBwps?: number
        maxHipSpeedBwps?: number
        avgPowerIndex?: number
        maxPowerIndex?: number
        totalStrikes?: number
        totalPowerScore?: number
        avgRangeDistanceBw?: number
        timeInCloseRangeSeconds?: number
        timeInMidRangeSeconds?: number
        timeInLongRangeSeconds?: number
        uniqueTechniquesCount?: number
        techniqueDiversityScore?: number
        consistencyScore?: number
        efficiencyScore?: number
        fatigueRate?: number
        totalFramesAnalyzed?: number
        dataQualityScore?: number
      }
    }

    if (!body.sessionId || !body.metrics) {
      return NextResponse.json({ error: 'Session ID and metrics required' }, { status: 400 })
    }

    const db = getDb()

    // Verify session belongs to user
    const session = await db.prepare(`
      SELECT id FROM fight_sessions WHERE id = ? AND user_id = ?
    `).bind(body.sessionId, user.id).first()

    if (!session) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 404 })
    }

    const metricsId = `metrics_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    await db.prepare(`
      INSERT INTO performance_metrics (
        id, session_id, user_id,
        avg_hand_speed_bwps, max_hand_speed_bwps,
        avg_hand_burst_bwps, max_hand_burst_bwps,
        avg_foot_speed_bwps, max_foot_speed_bwps,
        avg_hip_speed_bwps, max_hip_speed_bwps,
        avg_power_index, max_power_index,
        total_strikes, total_power_score,
        avg_range_distance_bw,
        time_in_close_range_seconds, time_in_mid_range_seconds, time_in_long_range_seconds,
        unique_techniques_count, technique_diversity_score,
        consistency_score, efficiency_score, fatigue_rate,
        total_frames_analyzed, data_quality_score
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      metricsId,
      body.sessionId,
      user.id,
      body.metrics.avgHandSpeedBwps || null,
      body.metrics.maxHandSpeedBwps || null,
      body.metrics.avgHandBurstBwps || null,
      body.metrics.maxHandBurstBwps || null,
      body.metrics.avgFootSpeedBwps || null,
      body.metrics.maxFootSpeedBwps || null,
      body.metrics.avgHipSpeedBwps || null,
      body.metrics.maxHipSpeedBwps || null,
      body.metrics.avgPowerIndex || null,
      body.metrics.maxPowerIndex || null,
      body.metrics.totalStrikes || null,
      body.metrics.totalPowerScore || null,
      body.metrics.avgRangeDistanceBw || null,
      body.metrics.timeInCloseRangeSeconds || null,
      body.metrics.timeInMidRangeSeconds || null,
      body.metrics.timeInLongRangeSeconds || null,
      body.metrics.uniqueTechniquesCount || null,
      body.metrics.techniqueDiversityScore || null,
      body.metrics.consistencyScore || null,
      body.metrics.efficiencyScore || null,
      body.metrics.fatigueRate || null,
      body.metrics.totalFramesAnalyzed || null,
      body.metrics.dataQualityScore || null
    ).run()

    return NextResponse.json({
      metricsId,
      sessionId: body.sessionId,
      createdAt: new Date().toISOString()
    })
  } catch (error) {
    console.error('Failed to store performance metrics:', error)
    return NextResponse.json({ error: 'Failed to store metrics' }, { status: 500 })
  }
}
