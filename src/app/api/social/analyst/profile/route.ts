/**
 * GET  /api/social/analyst/profile — the current user's analyst profile.
 * PATCH /api/social/analyst/profile — edit bio, rate, capacity, toggles.
 *
 * Body for PATCH (all optional):
 *   {
 *     isAnalystEnabled?: boolean,
 *     bio?: string,
 *     specialties?: string[],
 *     languages?: string[],
 *     turnaroundHours?: number,
 *     directHireEnabled?: boolean,
 *     directHireRateCents?: number,
 *     maxCapacity?: number,
 *   }
 *
 * Direct-hire can only be enabled by analysts at blue belt or higher
 * (see canEnableDirectHire). Direct-hire also requires Stripe Connect to
 * be active — that check is a no-op until Stripe lands, but the flag
 * is already stored so the UI can show the right status.
 */
import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/marketplace/types'
import { ensureAnalystProfile } from '@/lib/marketplace/jobs'
import { canEnableDirectHire, maxCapacity as tierMaxCapacity } from '@/lib/marketplace/beltTier'
import { ensureCoachRank } from '@/lib/marketplace/coachRankStore'

export async function GET(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const db = getDb()
    const profile = await ensureAnalystProfile(db, user.id)

    let specialties: string[] = []
    let languages: string[] = []
    try { specialties = JSON.parse(profile.specialties || '[]') } catch {}
    try { languages = JSON.parse(profile.languages || '[]') } catch {}

    // Coalesce numeric stats to sane defaults. A freshly-created profile (and the
    // in-memory mock D1 used in dev, which doesn't apply schema column DEFAULTs)
    // can omit these columns; the client renders them directly (e.g.
    // avgOverall.toFixed(1)), so undefined would crash the page.
    const num = (v: unknown, d = 0): number => {
      const n = Number(v)
      return Number.isFinite(n) ? n : d
    }

    return NextResponse.json({
      profile: {
        userId: profile.user_id,
        isAnalystEnabled: Boolean(profile.is_analyst_enabled),
        bio: profile.bio ?? '',
        specialties,
        languages,
        turnaroundHours: num(profile.turnaround_hours, 72),
        directHireEnabled: Boolean(profile.direct_hire_enabled),
        directHireRateCents: num(profile.direct_hire_rate_cents),
        beltTier: profile.belt_tier ?? 'white',
        beltScore: num(profile.belt_score),
        avgOverall: num(profile.avg_overall),
        jobsCompleted: num(profile.jobs_completed),
        jobsCancelled: num(profile.jobs_cancelled),
        jobsDisputed: num(profile.jobs_disputed),
        reviewCount: num(profile.review_count),
        totalEarnedCents: num(profile.total_earned_cents),
        currentCapacity: num(profile.current_capacity),
        maxCapacity: num(profile.max_capacity, 3),
        stripePayoutsEnabled: Boolean(profile.stripe_payouts_enabled),
      },
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to load profile' }, { status: 400 })
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const body = (await req.json()) as Record<string, unknown>

    const db = getDb()
    const profile = await ensureAnalystProfile(db, user.id)
    const willBeEnabled = typeof body.isAnalystEnabled === 'boolean'
      ? body.isAnalystEnabled
      : Boolean(profile.is_analyst_enabled)

    if (willBeEnabled) {
      await ensureCoachRank(db, user.id)
    }

    const updates: string[] = []
    const values: unknown[] = []

    if (typeof body.isAnalystEnabled === 'boolean') {
      updates.push('is_analyst_enabled = ?')
      values.push(body.isAnalystEnabled ? 1 : 0)
    }
    if (typeof body.bio === 'string') {
      updates.push('bio = ?')
      values.push(body.bio.slice(0, 2000))
    }
    if (Array.isArray(body.specialties)) {
      const arr = (body.specialties as unknown[]).map(String).filter(Boolean).slice(0, 20)
      updates.push('specialties = ?')
      values.push(JSON.stringify(arr))
    }
    if (Array.isArray(body.languages)) {
      const arr = (body.languages as unknown[]).map(String).filter(Boolean).slice(0, 20)
      updates.push('languages = ?')
      values.push(JSON.stringify(arr))
    }
    if (body.turnaroundHours !== undefined) {
      const h = Math.max(1, Math.min(720, Math.round(Number(body.turnaroundHours))))
      if (Number.isFinite(h)) {
        updates.push('turnaround_hours = ?')
        values.push(h)
      }
    }
    if (typeof body.directHireEnabled === 'boolean') {
      if (body.directHireEnabled && !canEnableDirectHire(profile.belt_tier)) {
        return NextResponse.json(
          { error: `Direct hire requires at least blue belt (you are ${profile.belt_tier})` },
          { status: 400 },
        )
      }
      // TODO(stripe): require stripe_payouts_enabled=1 before allowing true here.
      updates.push('direct_hire_enabled = ?')
      values.push(body.directHireEnabled ? 1 : 0)
    }
    if (body.directHireRateCents !== undefined) {
      const n = Math.max(0, Math.trunc(Number(body.directHireRateCents) || 0))
      updates.push('direct_hire_rate_cents = ?')
      values.push(n)
    }
    if (body.maxCapacity !== undefined) {
      const req = Math.max(1, Math.min(tierMaxCapacity(profile.belt_tier), Math.trunc(Number(body.maxCapacity) || 1)))
      updates.push('max_capacity = ?')
      values.push(req)
    }

    if (!updates.length) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 })
    }

    const now = new Date().toISOString()
    updates.push('updated_at = ?')
    values.push(now)

    await db
      .prepare(`UPDATE analyst_profiles SET ${updates.join(', ')} WHERE user_id = ?`)
      .bind(...values, user.id)
      .run()

    return NextResponse.json({ ok: true })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to update profile' }, { status: 400 })
  }
}
