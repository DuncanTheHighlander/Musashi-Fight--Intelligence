import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

interface KinematicsSnapshot {
  sessionId: string
  timestamp?: string
  frameNumber?: number
  
  // Speed metrics (body-widths per second)
  handSpeedBwps?: number
  handBurstBwps?: number
  footSpeedBwps?: number
  hipSpeedBwps?: number
  
  // Power and force metrics
  powerIndex?: number
  strikeForceEstimate?: number
  
  // Range and positioning
  rangeDistanceBw?: number
  rangeClosingBwps?: number
  rangeState?: 'long' | 'mid' | 'close' | 'clinched' | 'grounded'
  
  // Technique classification
  techniqueType?: string
  techniqueConfidence?: number
  combinationSequence?: string[]
  
  // Pose data
  poseKeypoints?: any
  poseConfidence?: number
  
  // Fighter identification
  fighterId?: string
  fighterStance?: 'orthodox' | 'southpaw' | 'switch' | 'unknown'
  
  // Raw kinematics data
  rawKinematics?: any
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const kinematicsData = await req.json() as KinematicsSnapshot

    if (!kinematicsData.sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
    }

    const snapshotId = `snapshot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    const db = getDb()

    // Verify session belongs to user
    const session = await db.prepare(`
      SELECT id FROM fight_sessions WHERE id = ? AND user_id = ? AND status = 'active'
    `).bind(kinematicsData.sessionId, user.id).first()

    if (!session) {
      return NextResponse.json({ error: 'Invalid or inactive session' }, { status: 404 })
    }

    await db.prepare(`
      INSERT INTO kinematics_snapshots (
        id, session_id, timestamp, frame_number,
        hand_speed_bwps, hand_burst_bwps, foot_speed_bwps, hip_speed_bwps,
        power_index, strike_force_estimate,
        range_distance_bw, range_closing_bwps, range_state,
        technique_type, technique_confidence, combination_sequence,
        pose_keypoints, pose_confidence,
        fighter_id, fighter_stance, raw_kinematics
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      snapshotId,
      kinematicsData.sessionId,
      kinematicsData.timestamp || new Date().toISOString(),
      kinematicsData.frameNumber || null,
      kinematicsData.handSpeedBwps || null,
      kinematicsData.handBurstBwps || null,
      kinematicsData.footSpeedBwps || null,
      kinematicsData.hipSpeedBwps || null,
      kinematicsData.powerIndex || null,
      kinematicsData.strikeForceEstimate || null,
      kinematicsData.rangeDistanceBw || null,
      kinematicsData.rangeClosingBwps || null,
      kinematicsData.rangeState || null,
      kinematicsData.techniqueType || null,
      kinematicsData.techniqueConfidence || null,
      kinematicsData.combinationSequence ? JSON.stringify(kinematicsData.combinationSequence) : null,
      kinematicsData.poseKeypoints ? JSON.stringify(kinematicsData.poseKeypoints) : null,
      kinematicsData.poseConfidence || null,
      kinematicsData.fighterId || null,
      kinematicsData.fighterStance || null,
      kinematicsData.rawKinematics ? JSON.stringify(kinematicsData.rawKinematics) : null
    ).run()

    return NextResponse.json({
      snapshotId,
      sessionId: kinematicsData.sessionId,
      timestamp: kinematicsData.timestamp || new Date().toISOString()
    })
  } catch (error) {
    console.error('Failed to store kinematics snapshot:', error)
    return NextResponse.json({ error: 'Failed to store snapshot' }, { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get('sessionId')
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = parseInt(searchParams.get('offset') || '0')
    const fighterId = searchParams.get('fighterId')

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
    }

    const db = getDb()

    // Verify session belongs to user
    const session = await db.prepare(`
      SELECT id FROM fight_sessions WHERE id = ? AND user_id = ?
    `).bind(sessionId, user.id).first()

    if (!session) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 404 })
    }

    let query = `
      SELECT 
        id, timestamp, frame_number,
        hand_speed_bwps, hand_burst_bwps, foot_speed_bwps, hip_speed_bwps,
        power_index, strike_force_estimate,
        range_distance_bw, range_closing_bwps, range_state,
        technique_type, technique_confidence, combination_sequence,
        pose_confidence, fighter_id, fighter_stance, raw_kinematics,
        created_at
      FROM kinematics_snapshots 
      WHERE session_id = ?
    `
    const params = [sessionId]

    if (fighterId) {
      query += ' AND fighter_id = ?'
      params.push(fighterId)
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?'
    params.push(String(limit), String(offset))

    const { results: snapshots } = await db.prepare(query).bind(...params).all()

    // Parse JSON fields
    const processedSnapshots = snapshots.map((snapshot: any) => ({
      ...snapshot,
      combinationSequence: snapshot.combination_sequence ? JSON.parse(snapshot.combination_sequence) : null,
      rawKinematics: snapshot.raw_kinematics ? JSON.parse(snapshot.raw_kinematics) : null
    }))

    return NextResponse.json({ 
      sessionId,
      snapshots: processedSnapshots 
    })
  } catch (error) {
    console.error('Failed to fetch kinematics snapshots:', error)
    return NextResponse.json({ error: 'Failed to fetch snapshots' }, { status: 500 })
  }
}
