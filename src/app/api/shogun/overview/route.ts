/**
 * GET /api/shogun/overview — admin dashboard stats. Shogun-only.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { listAdminUsers } from '@/lib/adminUsers'
import { isAiKillSwitchActive, getRuntimeSetting, AI_KILL_SWITCH_KEY } from '@/lib/adminRuntime'

export async function GET(req: Request) {
  try {
    await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const users = await listAdminUsers()
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const totals = {
    users: users.length,
    verified: users.filter((u) => u.email_verified_at).length,
    pro: users.filter((u) => u.is_pro === 1).length,
    videosAnalyzed: users.reduce((sum, u) => sum + Number(u.videos_analyzed || 0), 0),
    activeLast7d: users.filter((u) => u.last_analysis_at && u.last_analysis_at >= sevenDaysAgo).length,
    videosLast24h: users.filter((u) => u.last_analysis_at && u.last_analysis_at >= dayAgo).length,
    consented: users.filter((u) => Number(u.consent_ai_training) === 1).length,
    suspended: users.filter((u) => u.account_status === 'suspended' || u.account_status === 'banned').length,
  }

  const killSwitch = {
    active: await isAiKillSwitchActive(),
    envActive: process.env.MUSASHI_AI_KILL_SWITCH === '1',
    runtimeActive: (await getRuntimeSetting(AI_KILL_SWITCH_KEY)) === '1',
  }

  return NextResponse.json({ totals, users, killSwitch }, { status: 200 })
}
