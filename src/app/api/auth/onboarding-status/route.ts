/**
 * GET /api/auth/onboarding-status — whether the user should see /onboarding.
 */
import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

export async function GET(req: Request) {
  if (process.env.MUSASHI_DISABLE_AUTH === '1' && process.env.NODE_ENV !== 'production') {
    return NextResponse.json({ complete: true, reason: 'dev_bypass' })
  }

  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ complete: false, reason: 'unauthenticated' }, { status: 401 })
    }

    const db = getDb()
    const fighter = await db
      .prepare('SELECT display_name FROM fighter_profiles WHERE user_id = ? LIMIT 1')
      .bind(user.id)
      .first<{ display_name: string | null }>()

    const analyst = await db
      .prepare('SELECT is_analyst_enabled FROM analyst_profiles WHERE user_id = ? LIMIT 1')
      .bind(user.id)
      .first<{ is_analyst_enabled: number }>()

    const hasFighter = Boolean(String(fighter?.display_name || '').trim())
    const hasCoach = Boolean(analyst?.is_analyst_enabled)
    const complete = hasFighter || hasCoach

    return NextResponse.json({
      complete,
      hasFighterProfile: hasFighter,
      hasCoachProfile: hasCoach,
      needsProfileNudge: !complete,
      redirectTo: complete ? '/' : '/onboarding',
    })
  } catch (err) {
    console.error('Onboarding status error:', err)
    return NextResponse.json({ complete: false, reason: 'error' }, { status: 500 })
  }
}
