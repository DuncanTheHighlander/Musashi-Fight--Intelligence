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

// Skill verification thresholds based on kinematics data
const VERIFICATION_THRESHOLDS = {
  beginner: { minHandSpeed: 0.5, minPowerIndex: 1.0, minConsistency: 0.3 },
  intermediate: { minHandSpeed: 1.2, minPowerIndex: 2.5, minConsistency: 0.5 },
  advanced: { minHandSpeed: 2.0, minPowerIndex: 4.0, minConsistency: 0.7 },
  pro: { minHandSpeed: 3.0, minPowerIndex: 6.0, minConsistency: 0.85 }
}

const calculateSkillLevel = (performanceMetrics: any): string => {
  const { avgHandSpeedBwps, avgPowerIndex, consistencyScore } = performanceMetrics
  
  if (avgHandSpeedBwps >= VERIFICATION_THRESHOLDS.pro.minHandSpeed &&
      avgPowerIndex >= VERIFICATION_THRESHOLDS.pro.minPowerIndex &&
      consistencyScore >= VERIFICATION_THRESHOLDS.pro.minConsistency) {
    return 'pro'
  }
  
  if (avgHandSpeedBwps >= VERIFICATION_THRESHOLDS.advanced.minHandSpeed &&
      avgPowerIndex >= VERIFICATION_THRESHOLDS.advanced.minPowerIndex &&
      consistencyScore >= VERIFICATION_THRESHOLDS.advanced.minConsistency) {
    return 'advanced'
  }
  
  if (avgHandSpeedBwps >= VERIFICATION_THRESHOLDS.intermediate.minHandSpeed &&
      avgPowerIndex >= VERIFICATION_THRESHOLDS.intermediate.minPowerIndex &&
      consistencyScore >= VERIFICATION_THRESHOLDS.intermediate.minConsistency) {
    return 'intermediate'
  }
  
  return 'beginner'
}

const verifyTechnique = (techniqueData: any, kinematicsData: any): boolean => {
  // Verify technique execution meets biomechanical standards
  const { executionSpeed, powerIndex, accuracy } = techniqueData
  const { avgHandSpeedBwps, avgPowerIndex } = kinematicsData
  
  // Technique must be performed at least 80% of user's average capability
  const speedThreshold = avgHandSpeedBwps * 0.8
  const powerThreshold = avgPowerIndex * 0.8
  
  return executionSpeed >= speedThreshold && 
         powerIndex >= powerThreshold && 
         accuracy >= 0.75
}

export async function GET(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId') || user.id

    const db = getDb()

    // Get user's performance metrics for verification
    const performanceRow = await db
      .prepare(`
        SELECT 
          avg_hand_speed_bwps,
          max_hand_speed_bwps,
          avg_power_index,
          max_power_index,
          consistency_score,
          total_frames_analyzed,
          data_quality_score
        FROM performance_metrics 
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `)
      .bind(userId)
      .first()

    // Get user's technique analysis for skill verification
    const techniqueRows = await db
      .prepare(`
        SELECT 
          technique_name,
          technique_category,
          execution_count,
          avg_speed_bwps,
          avg_power_index,
          success_rate,
          impact_quality
        FROM technique_analysis 
        WHERE user_id = ?
        ORDER BY avg_power_index DESC
        LIMIT 20
      `)
      .bind(userId)
      .all()

    // Get fighter profile for current verification status
    const profileRow = await db
      .prepare(`
        SELECT performance_stats, skill_verification 
        FROM fighter_profiles 
        WHERE user_id = ?
      `)
      .bind(userId)
      .first()

    if (!performanceRow) {
      return NextResponse.json({
        verificationLevel: 'none',
        verifiedSkills: [],
        lastVerified: null,
        performanceMetrics: null,
        needsMoreData: true,
        message: 'No performance data available for verification'
      })
    }

    const performanceMetrics = {
      avgHandSpeedBwps: Number(performanceRow.avg_hand_speed_bwps || 0),
      maxHandSpeedBwps: Number(performanceRow.max_hand_speed_bwps || 0),
      avgPowerIndex: Number(performanceRow.avg_power_index || 0),
      maxPowerIndex: Number(performanceRow.max_power_index || 0),
      consistencyScore: Number(performanceRow.consistency_score || 0),
      totalFramesAnalyzed: Number(performanceRow.total_frames_analyzed || 0),
      dataQualityScore: Number(performanceRow.data_quality_score || 0)
    }

    // Calculate skill level
    const calculatedLevel = calculateSkillLevel(performanceMetrics)

    // Verify techniques
    const verifiedTechniques = []
    const techniques = techniqueRows.results || []
    
    for (const technique of techniques) {
      const isVerified = verifyTechnique(
        {
          executionSpeed: Number(technique.avg_speed_bwps || 0),
          powerIndex: Number(technique.avg_power_index || 0),
          accuracy: Number(technique.success_rate || 0)
        },
        performanceMetrics
      )
      
      if (isVerified) {
        verifiedTechniques.push({
          name: technique.technique_name,
          category: technique.technique_category,
          executionCount: Number(technique.execution_count || 0),
          avgSpeed: Number(technique.avg_speed_bwps || 0),
          avgPower: Number(technique.avg_power_index || 0),
          successRate: Number(technique.success_rate || 0),
          verifiedAt: new Date().toISOString()
        })
      }
    }

    // Update profile with new verification data
    const verificationData = {
      verifiedSkills: verifiedTechniques,
      verificationLevel: calculatedLevel,
      lastVerified: new Date().toISOString(),
      performanceMetrics
    }

    await db
      .prepare(`
        UPDATE fighter_profiles 
        SET skill_verification = ?, updated_at = ?
        WHERE user_id = ?
      `)
      .bind(JSON.stringify(verificationData), new Date().toISOString(), userId)
      .run()

    return NextResponse.json({
      verificationLevel: calculatedLevel,
      verifiedSkills: verifiedTechniques,
      lastVerified: verificationData.lastVerified,
      performanceMetrics,
      needsMoreData: performanceMetrics.totalFramesAnalyzed < 1000,
      message: calculatedLevel === 'none' ? 
        'Insufficient data for verification' : 
        `Verified as ${calculatedLevel} level with ${verifiedTechniques.length} techniques`
    })

  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to verify skills' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const body = await req.json() as Record<string, any>
    
    // Manual verification request for specific technique
    const { techniqueName, techniqueCategory, videoEvidence, kinematicsSnapshot } = body

    if (!techniqueName || !techniqueCategory || !kinematicsSnapshot) {
      return NextResponse.json({ error: 'Missing required verification data' }, { status: 400 })
    }

    const db = getDb()
    const now = new Date().toISOString()

    // Store verification request
    const verificationId = crypto.randomUUID()
    
    await db
      .prepare(`
        INSERT INTO skill_verifications (
          id, user_id, technique_name, technique_category, 
          video_evidence, kinematics_snapshot, status, 
          submitted_at, reviewed_at, reviewer_id
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, NULL, NULL)
      `)
      .bind(
        verificationId,
        user.id,
        techniqueName,
        techniqueCategory,
        JSON.stringify(videoEvidence || []),
        JSON.stringify(kinematicsSnapshot),
        now
      )
      .run()

    // Trigger automated verification if sufficient data
    const autoVerified = verifyTechnique(
      {
        executionSpeed: kinematicsSnapshot.handSpeedBwps || 0,
        powerIndex: kinematicsSnapshot.powerIndex || 0,
        accuracy: kinematicsSnapshot.estimatedAccuracy || 0.8
      },
      kinematicsSnapshot.userPerformance || {}
    )

    if (autoVerified) {
      await db
        .prepare(`
          UPDATE skill_verifications 
          SET status = 'approved', reviewed_at = ?, reviewer_id = ?
          WHERE id = ?
        `)
        .bind(now, 'auto-verification', verificationId)
        .run()
    }

    return NextResponse.json({
      verificationId,
      status: autoVerified ? 'approved' : 'pending',
      autoVerified,
      message: autoVerified ? 
        'Technique automatically verified' : 
        'Technique submitted for manual review'
    })

  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to submit verification' }, { status: 500 })
  }
}
