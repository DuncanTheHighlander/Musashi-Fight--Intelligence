/**
 * GET /api/social/analysts — leaderboard of opted-in analysts.
 *
 * Filters:
 *   ?beltTier=blue           — minimum belt tier (blue+ by default)
 *   ?directHire=1            — only analysts with direct-hire enabled
 *   ?specialty=boxing        — match one of the specialties
 *   ?sort=belt|reviews|recent
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import type { AnalystProfileRow } from '@/lib/marketplace/types'
import { BELT_ORDER } from '@/lib/marketplace/beltTier'
import type { BeltTier } from '@/lib/marketplace/beltTier'

export async function GET(req: Request) {
  try {
    await requireUser(req)
    const { searchParams } = new URL(req.url)
    const beltTier = searchParams.get('beltTier') as BeltTier | null
    const directHire = searchParams.get('directHire') === '1'
    const specialty = searchParams.get('specialty')?.toLowerCase() || null
    const sort = searchParams.get('sort') || 'belt'
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 200)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

    const where: string[] = ['ap.is_analyst_enabled = 1']
    const params: unknown[] = []

    if (beltTier && BELT_ORDER.includes(beltTier)) {
      // "at least" filter — include this belt and higher
      const allowed = BELT_ORDER.slice(BELT_ORDER.indexOf(beltTier))
      where.push(`ap.belt_tier IN (${allowed.map(() => '?').join(',')})`)
      params.push(...allowed)
    }

    if (directHire) {
      where.push('ap.direct_hire_enabled = 1 AND ap.direct_hire_rate_cents > 0')
    }

    let orderBy = 'ap.belt_score DESC, ap.jobs_completed DESC'
    if (sort === 'reviews') orderBy = 'ap.review_count DESC, ap.avg_overall DESC'
    if (sort === 'recent') orderBy = 'ap.updated_at DESC'

    const sql = `
      SELECT ap.*, fp.display_name, fp.discipline, fp.is_verified, fp.is_pro
        FROM analyst_profiles ap
        LEFT JOIN fighter_profiles fp ON fp.user_id = ap.user_id
       WHERE ${where.join(' AND ')}
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?
    `
    params.push(limit, offset)

    const db = getDb()
    const result = await db.prepare(sql).bind(...params).all<AnalystProfileRow & {
      display_name?: string
      discipline?: string
      is_verified?: number
      is_pro?: number
    }>()

    let rows = result.results || []

    // Specialty filter (client-side JSON parse — low volume in MVP)
    if (specialty) {
      rows = rows.filter((r) => {
        try {
          const arr = JSON.parse(r.specialties || '[]') as string[]
          return arr.map((s) => s.toLowerCase()).includes(specialty)
        } catch {
          return false
        }
      })
    }

    const analysts = rows.map((r) => {
      let specialties: string[] = []
      let languages: string[] = []
      try { specialties = JSON.parse(r.specialties || '[]') } catch {}
      try { languages = JSON.parse(r.languages || '[]') } catch {}
      return {
        userId: r.user_id,
        displayName: r.display_name ?? '',
        discipline: r.discipline ?? '',
        isVerified: Boolean(r.is_verified),
        isPro: Boolean(r.is_pro),
        beltTier: r.belt_tier,
        beltScore: r.belt_score,
        avgOverall: r.avg_overall,
        reviewCount: r.review_count,
        jobsCompleted: r.jobs_completed,
        turnaroundHours: r.turnaround_hours,
        directHireEnabled: Boolean(r.direct_hire_enabled),
        directHireRateCents: r.direct_hire_rate_cents,
        specialties,
        languages,
        bio: r.bio,
      }
    })

    return NextResponse.json({ analysts, limit, offset })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to list analysts' }, { status: 400 })
  }
}
