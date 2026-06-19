/**
 * GET /api/social/jobs/[id] — fetch a single job (with transaction summary).
 */
import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/marketplace/types'
import type { MarketplaceJobRow, MarketplaceTransactionRow } from '@/lib/marketplace/types'

type Params = { id: string }

function toJobDto(row: MarketplaceJobRow) {
  let videos: string[] = []
  try {
    videos = JSON.parse(row.videos || '[]')
  } catch {}
  return {
    id: row.id,
    scoutingRequestId: row.scouting_request_id,
    breakdownOfferId: row.breakdown_offer_id,
    fighterId: row.fighter_id,
    analystId: row.analyst_id,
    jobType: row.job_type,
    requiredBeltTier: row.required_belt_tier,
    title: row.title,
    brief: row.brief,
    videos,
    amountCents: row.amount_cents,
    platformFeeBps: row.platform_fee_bps,
    platformFeeCents: row.platform_fee_cents,
    analystPayoutCents: row.analyst_payout_cents,
    currency: row.currency,
    status: row.status,
    deliverableUrl: row.deliverable_url,
    deliverableNotes: row.deliverable_notes,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
    releasedAt: row.released_at,
    claimDeadlineAt: row.claim_deadline_at,
    deliveryDeadlineAt: row.delivery_deadline_at,
    approvalDeadlineAt: row.approval_deadline_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function GET(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await enforceUsage(req, 'chat')
    const { id } = await context.params
    const db = getDb()

    const job = await db
      .prepare('SELECT * FROM marketplace_jobs WHERE id = ?')
      .bind(id)
      .first<MarketplaceJobRow>()
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Only participants or analyst-browsers of open bounties can see the full detail.
    const isParticipant = user.id === job.fighter_id || user.id === job.analyst_id
    const isBrowsableBounty = job.job_type === 'open_bounty' && ['FUNDED'].includes(job.status)
    if (!isParticipant && !isBrowsableBounty) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Attach recent transactions (participants only)
    let transactions: MarketplaceTransactionRow[] = []
    if (isParticipant) {
      const r = await db
        .prepare(
          'SELECT * FROM marketplace_transactions WHERE job_id = ? ORDER BY created_at DESC LIMIT 50',
        )
        .bind(id)
        .all<MarketplaceTransactionRow>()
      transactions = r.results || []
    }

    return NextResponse.json({
      job: toJobDto(job),
      transactions: transactions.map((t) => ({
        id: t.id,
        type: t.type,
        amountCents: t.amount_cents,
        currency: t.currency,
        status: t.status,
        createdAt: t.created_at,
      })),
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to fetch job' }, { status: 400 })
  }
}
