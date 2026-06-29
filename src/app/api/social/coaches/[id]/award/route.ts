/**
 * POST /api/social/coaches/[id]/award — shogun hand-awards a belt (e.g. Coral 9°,
 * Red 10°), bypassing the metric gates. Body: { toBelt, notes? }
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { handAward } from '@/lib/marketplace/coachRankStore'
import { BELT_COLOR_ORDER, type BeltColorKey } from '@/lib/marketplace/coachRank'

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const admin = await requireUser(req, { role: 'shogun' })
    const { id } = await context.params

    const body = (await req.json()) as Record<string, unknown>
    const toBelt = String(body?.toBelt || '') as BeltColorKey
    if (!BELT_COLOR_ORDER.includes(toBelt)) {
      return NextResponse.json({ error: 'invalid belt' }, { status: 400 })
    }
    const notes = String(body?.notes || '').slice(0, 4000)

    const db = getDb()
    const updated = await handAward(db, { userId: id, toBelt, actorUserId: admin.id, notes })
    return NextResponse.json({ userId: updated.user_id, earnedBelt: updated.earned_belt_key })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    return NextResponse.json({ error: code || 'Failed to award belt' }, { status: 400 })
  }
}
