import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import {
  AI_KILL_SWITCH_KEY,
  getRuntimeSetting,
  isAiKillSwitchActive,
  setRuntimeSetting,
  writeAdminAudit,
} from '@/lib/adminRuntime'

export async function GET(req: Request) {
  try {
    await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const envActive = process.env.MUSASHI_AI_KILL_SWITCH === '1'
  const runtimeValue = await getRuntimeSetting(AI_KILL_SWITCH_KEY)
  const active = await isAiKillSwitchActive()
  return NextResponse.json({
    active,
    envActive,
    runtimeActive: runtimeValue === '1',
  })
}

export async function POST(req: Request) {
  let admin
  try {
    admin = await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { active?: unknown; reason?: unknown }
  const active = Boolean(body?.active)
  const reason = String(body?.reason || '').trim() || null

  await setRuntimeSetting(AI_KILL_SWITCH_KEY, active ? '1' : '0', admin.id)
  await writeAdminAudit({
    adminUserId: admin.id,
    action: active ? 'ai.kill_switch.enable' : 'ai.kill_switch.disable',
    targetType: 'system',
    targetId: AI_KILL_SWITCH_KEY,
    reason,
    after: { active },
  })

  return NextResponse.json({
    active: await isAiKillSwitchActive(),
    envActive: process.env.MUSASHI_AI_KILL_SWITCH === '1',
    runtimeActive: active,
  })
}
