/**
 * POST /api/social/jobs/[id]/start — assigned analyst flips CLAIMED → IN_PROGRESS.
 */
import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/marketplace/types'
import { applyTransition, fetchJob } from '@/lib/marketplace/jobs'

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await enforceUsage(req, 'chat')
    const { id } = await context.params
    const db = getDb()
    const job = await fetchJob(db, id)
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (job.analyst_id !== user.id) {
      return NextResponse.json({ error: 'Only the assigned analyst can start' }, { status: 403 })
    }
    const next = await applyTransition(db, {
      jobId: id,
      event: 'START',
      actorUserId: user.id,
    })
    return NextResponse.json({ jobId: next.id, status: next.status })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to start' }, { status: 400 })
  }
}
