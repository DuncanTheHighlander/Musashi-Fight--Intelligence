/**
 * GET /api/social/disputes/[id] — fetch a single dispute.
 *   Readable by: admin, the opener, the fighter, or the analyst on the job.
 */
import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/marketplace/types'
import type { MarketplaceDisputeRow, MarketplaceJobRow } from '@/lib/marketplace/types'

type Params = { id: string }

export async function GET(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await enforceUsage(req, 'chat')
    const { id } = await context.params
    const db = getDb()

    const dispute = await db
      .prepare('SELECT * FROM marketplace_disputes WHERE id = ?')
      .bind(id)
      .first<MarketplaceDisputeRow>()
    if (!dispute) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const job = await db
      .prepare('SELECT * FROM marketplace_jobs WHERE id = ?')
      .bind(dispute.job_id)
      .first<MarketplaceJobRow>()

    const isParticipant =
      user.role === 'shogun' ||
      user.id === dispute.opened_by_id ||
      (job && (user.id === job.fighter_id || user.id === job.analyst_id))

    if (!isParticipant) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    let evidence: string[] = []
    let counterEvidence: string[] = []
    try {
      evidence = JSON.parse(dispute.evidence_urls || '[]')
    } catch {}
    try {
      counterEvidence = JSON.parse(dispute.counter_evidence_urls || '[]')
    } catch {}

    return NextResponse.json({
      dispute: {
        id: dispute.id,
        jobId: dispute.job_id,
        openedById: dispute.opened_by_id,
        reason: dispute.reason,
        description: dispute.description,
        evidenceUrls: evidence,
        counterStatement: dispute.counter_statement,
        counterEvidenceUrls: counterEvidence,
        status: dispute.status,
        refundAmountCents: dispute.refund_amount_cents,
        payoutAmountCents: dispute.payout_amount_cents,
        resolverId: dispute.resolver_id,
        resolvedAt: dispute.resolved_at,
        resolutionNotes: dispute.resolution_notes,
        createdAt: dispute.created_at,
      },
      job: job
        ? {
            id: job.id,
            fighterId: job.fighter_id,
            analystId: job.analyst_id,
            title: job.title,
            amountCents: job.amount_cents,
            status: job.status,
          }
        : null,
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to fetch dispute' }, { status: 400 })
  }
}
