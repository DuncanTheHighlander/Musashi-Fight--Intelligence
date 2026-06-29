/**
 * POST /api/social/jobs/[id]/claim — analyst claims an open bounty.
 * Gated on: is_analyst_enabled, belt_tier >= required_belt_tier, capacity not full.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { claimJob } from '@/lib/marketplace/jobs'

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await requireUser(req)
    const { id } = await context.params
    const db = getDb()
    const job = await claimJob(db, { jobId: id, analystId: user.id })
    return NextResponse.json({ jobId: job.id, status: job.status, analystId: job.analyst_id })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: code || 'Failed to claim' }, { status: 400 })
  }
}
