/**
 * GET /api/social/analysts/[id] — public analyst profile (aggregates + bio).
 */
import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { currentActiveJobCount } from '@/lib/marketplace/jobs'
import { maxCapacity } from '@/lib/marketplace/beltTier'
import { getDb } from '@/lib/marketplace/types'
import type { AnalystProfileRow } from '@/lib/marketplace/types'

type Params = { id: string }

export async function GET(req: Request, context: { params: Promise<Params> }) {
  try {
    await enforceUsage(req, 'chat')
    const { id } = await context.params
    const db = getDb()

    const row = await db
      .prepare(
        `SELECT ap.*, fp.display_name, fp.discipline, fp.is_verified, fp.is_pro, fp.bio as fighter_bio
           FROM analyst_profiles ap
           LEFT JOIN fighter_profiles fp ON fp.user_id = ap.user_id
          WHERE ap.user_id = ?`,
      )
      .bind(id)
      .first<AnalystProfileRow & {
        display_name?: string
        discipline?: string
        is_verified?: number
        is_pro?: number
        fighter_bio?: string
      }>()

    if (!row || !row.is_analyst_enabled) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    let specialties: string[] = []
    let languages: string[] = []
    try { specialties = JSON.parse(row.specialties || '[]') } catch {}
    try { languages = JSON.parse(row.languages || '[]') } catch {}

    const activeJobs = await currentActiveJobCount(db, row.user_id)
    const cap = Math.min(row.max_capacity, maxCapacity(row.belt_tier))

    return NextResponse.json({
      analyst: {
        userId: row.user_id,
        displayName: row.display_name ?? '',
        discipline: row.discipline ?? '',
        isVerified: Boolean(row.is_verified),
        isPro: Boolean(row.is_pro),
        bio: row.bio || row.fighter_bio || '',
        specialties,
        languages,
        turnaroundHours: row.turnaround_hours,
        beltTier: row.belt_tier,
        beltScore: row.belt_score,
        jobsCompleted: row.jobs_completed,
        reviewCount: row.review_count,
        avgOverall: row.avg_overall,
        avgTacticalAccuracy: row.avg_tactical_accuracy,
        avgActionability: row.avg_actionability,
        avgCommunication: row.avg_communication,
        directHireEnabled: Boolean(row.direct_hire_enabled),
        directHireRateCents: row.direct_hire_rate_cents,
        currentCapacity: activeJobs,
        maxCapacity: cap,
      },
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to fetch analyst' }, { status: 400 })
  }
}
