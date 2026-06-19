/**
 * POST /api/social/jobs      — create a marketplace job (open_bounty | direct_hire)
 * GET  /api/social/jobs      — list/filter jobs
 *
 * IMPORTANT: Stripe is NOT yet wired. Creating a job writes a `CREATED` row.
 * The fighter then calls the (not-yet-implemented) fund endpoint to move it to
 * FUNDED. The ledger appends a HOLD row with status='pending_stripe' so that
 * when Stripe lands we can reconcile rather than re-architect.
 */
import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/marketplace/types'
import type { JobType, MarketplaceJobRow } from '@/lib/marketplace/types'
import { createJob } from '@/lib/marketplace/jobs'
import { MIN_JOB_AMOUNT_CENTS } from '@/lib/marketplace/deadlines'
import type { BeltTier } from '@/lib/marketplace/beltTier'
import type { JobStatus } from '@/lib/marketplace/stateMachine'

const VALID_JOB_TYPES: JobType[] = ['open_bounty', 'direct_hire']
const VALID_BELT_TIERS: BeltTier[] = ['white', 'blue', 'purple', 'brown', 'black', 'red']

function toJobDto(row: MarketplaceJobRow) {
  let videos: string[] = []
  try {
    videos = JSON.parse(row.videos || '[]')
  } catch {
    videos = []
  }
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

function handleError(e: unknown, fallback: string) {
  const code = e instanceof Error ? e.message : 'UNKNOWN'
  if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
  if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json({ error: code || fallback }, { status: 400 })
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/social/jobs
// ──────────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const body = (await req.json()) as Record<string, unknown>

    const jobType = String(body?.jobType || 'open_bounty') as JobType
    if (!VALID_JOB_TYPES.includes(jobType)) {
      return NextResponse.json({ error: 'invalid jobType' }, { status: 400 })
    }

    const title = String(body?.title || '').trim()
    if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })

    const amountCents = Math.trunc(Number(body?.amountCents) || 0)
    if (amountCents < MIN_JOB_AMOUNT_CENTS) {
      return NextResponse.json(
        { error: `minimum amount is ${MIN_JOB_AMOUNT_CENTS} cents ($1.00)` },
        { status: 400 },
      )
    }
    const brief = String(body?.brief || '')

    const videos = Array.isArray(body?.videos)
      ? (body.videos as unknown[]).map(String).filter(Boolean)
      : []

    const requiredBeltTier = VALID_BELT_TIERS.includes(body?.requiredBeltTier as BeltTier)
      ? (body.requiredBeltTier as BeltTier)
      : undefined

    const analystId =
      jobType === 'direct_hire' ? String(body?.analystId || '').trim() || null : null

    const clientRequestId = body?.clientRequestId
      ? String(body.clientRequestId).trim() || null
      : null

    const db = getDb()
    const job = await createJob(db, {
      fighterId: user.id,
      jobType,
      title,
      brief,
      videos,
      amountCents,
      requiredBeltTier,
      analystId,
      scoutingRequestId: body?.scoutingRequestId ? String(body.scoutingRequestId) : null,
      breakdownOfferId: body?.breakdownOfferId ? String(body.breakdownOfferId) : null,
      clientRequestId,
      claimDeadlineAt: body?.claimDeadlineAt ? String(body.claimDeadlineAt) : null,
      deliveryDeadlineAt: body?.deliveryDeadlineAt ? String(body.deliveryDeadlineAt) : null,
    })

    return NextResponse.json({ job: toJobDto(job) }, { status: 201 })
  } catch (e) {
    return handleError(e, 'Failed to create job')
  }
}

// ──────────────────────────────────────────────────────────────────────────
// GET /api/social/jobs?status=...&jobType=...&fighterId=...&analystId=...&mine=1
// ──────────────────────────────────────────────────────────────────────────
export async function GET(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const { searchParams } = new URL(req.url)

    const mine = searchParams.get('mine') === '1'
    const fighterIdParam = searchParams.get('fighterId')
    const analystIdParam = searchParams.get('analystId')
    const statusParam = searchParams.get('status')
    const jobTypeParam = searchParams.get('jobType')

    const isPublicBountyList =
      Boolean(statusParam) &&
      jobTypeParam === 'open_bounty'

    if (!mine && !fighterIdParam && !analystIdParam && !isPublicBountyList) {
      return NextResponse.json(
        {
          error:
            'At least one scope required: mine=1, fighterId, analystId, or status+jobType=open_bounty',
        },
        { status: 400 },
      )
    }

    const where: string[] = []
    const params: unknown[] = []

    const status = statusParam
    if (status) {
      const statuses = status.split(',').map((s) => s.trim()).filter(Boolean)
      if (statuses.length) {
        where.push(`status IN (${statuses.map(() => '?').join(',')})`)
        params.push(...(statuses as JobStatus[]))
      }
    }

    const jobType = searchParams.get('jobType')
    if (jobType && VALID_JOB_TYPES.includes(jobType as JobType)) {
      where.push('job_type = ?')
      params.push(jobType)
    }

    const requiredBeltTier = searchParams.get('requiredBeltTier')
    if (requiredBeltTier && VALID_BELT_TIERS.includes(requiredBeltTier as BeltTier)) {
      where.push('required_belt_tier = ?')
      params.push(requiredBeltTier)
    }

    const fighterId = searchParams.get('fighterId')
    if (fighterId) {
      where.push('fighter_id = ?')
      params.push(fighterId)
    }

    const analystId = searchParams.get('analystId')
    if (analystId) {
      where.push('analyst_id = ?')
      params.push(analystId)
    }

    // "mine=1" scopes to jobs you authored OR are assigned to (either role)
    if (searchParams.get('mine') === '1') {
      where.push('(fighter_id = ? OR analyst_id = ?)')
      params.push(user.id, user.id)
    }

    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 200)
    const offset = Math.max(Number(searchParams.get('offset') || 0), 0)

    const sql = `
      SELECT * FROM marketplace_jobs
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `
    params.push(limit, offset)

    const db = getDb()
    const result = await db.prepare(sql).bind(...params).all<MarketplaceJobRow>()
    const jobs = (result.results || []).map(toJobDto)
    return NextResponse.json({ jobs, limit, offset })
  } catch (e) {
    return handleError(e, 'Failed to list jobs')
  }
}
