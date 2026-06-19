/**
 * POST /api/social/jobs/[id]/submit — analyst hands in the deliverable.
 * Body: { deliverableUrl: string, deliverableNotes?: string }
 * Transition: IN_PROGRESS → SUBMITTED. Arms a 72h approval deadline.
 */
import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/marketplace/types'
import { submitJob } from '@/lib/marketplace/jobs'

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await enforceUsage(req, 'chat')
    const { id } = await context.params
    const body = (await req.json()) as Record<string, unknown>

    const deliverableUrl = String(body?.deliverableUrl || '').trim()
    const deliverableNotes = String(body?.deliverableNotes || '').trim() || undefined
    if (!deliverableUrl) {
      return NextResponse.json({ error: 'deliverableUrl required' }, { status: 400 })
    }

    const db = getDb()
    const job = await submitJob(db, {
      jobId: id,
      analystId: user.id,
      deliverableUrl,
      deliverableNotes,
    })
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      approvalDeadlineAt: job.approval_deadline_at,
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to submit' }, { status: 400 })
  }
}
