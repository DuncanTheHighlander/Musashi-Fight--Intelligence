/**
 * POST /api/social/jobs/[id]/submit — analyst hands in the deliverable.
 * Body: { deliverableUrl: string, deliverableNotes?: string }
 * Transition: IN_PROGRESS → SUBMITTED. Arms a 72h approval deadline.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { submitJob } from '@/lib/marketplace/jobs'
import { assertUploadedAssetsOwned } from '@/lib/storage/assets'
import { toAssetRef } from '@/lib/storage/assetRef'

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await requireUser(req)
    const { id } = await context.params
    const body = (await req.json()) as Record<string, unknown>

    const deliverableUrl = String(body?.deliverableUrl || '').trim()
    const deliverableAssetId = String(body?.deliverableAssetId || '').trim()
    const deliverableNotes = String(body?.deliverableNotes || '').trim() || undefined

    let resolvedDeliverableUrl = deliverableUrl
    if (deliverableAssetId) {
      const db = getDb()
      await assertUploadedAssetsOwned(db, [deliverableAssetId], user.id, 'deliverable')
      resolvedDeliverableUrl = toAssetRef(deliverableAssetId)
    }
    if (!resolvedDeliverableUrl) {
      return NextResponse.json({ error: 'deliverableUrl or deliverableAssetId required' }, { status: 400 })
    }

    const db = getDb()
    const job = await submitJob(db, {
      jobId: id,
      analystId: user.id,
      deliverableUrl: resolvedDeliverableUrl,
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
