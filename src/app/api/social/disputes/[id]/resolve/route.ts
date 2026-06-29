/**
 * POST /api/social/disputes/[id]/resolve — admin-only dispute resolution.
 *
 * Body: {
 *   resolution: 'refund' | 'release' | 'split' | 'dismiss',
 *   refundAmountCents?: number,   // required for split
 *   payoutAmountCents?: number,   // required for split
 *   notes?: string,
 * }
 *
 * Outcomes:
 *   refund   → RESOLVED_REFUND, full refund to fighter
 *   release  → RESOLVED_RELEASE, full payout (minus fee) to analyst
 *   split    → RESOLVED_SPLIT, partial refund + partial payout
 *   dismiss  → DISMISSED, no ledger change, job returned to APPROVED → RELEASE
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import type { MarketplaceDisputeRow, MarketplaceJobRow } from '@/lib/marketplace/types'
import { applyTransition, recordAnalystPayoutStats } from '@/lib/marketplace/jobs'
import { recordRefund, recordRelease, recordSplit } from '@/lib/marketplace/ledger'
import {
  executeJobRefundMoneyMovement,
  executeJobReleaseMoneyMovement,
  executeJobSplitMoneyMovement,
} from '@/lib/marketplace/moneyMovement'

type Params = { id: string }

type Resolution = 'refund' | 'release' | 'split' | 'dismiss'
const VALID_RESOLUTIONS: Resolution[] = ['refund', 'release', 'split', 'dismiss']

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const admin = await requireUser(req, { role: 'shogun' })
    const { id } = await context.params
    const body = (await req.json()) as Record<string, unknown>

    const resolution = String(body?.resolution || '') as Resolution
    if (!VALID_RESOLUTIONS.includes(resolution)) {
      return NextResponse.json({ error: 'invalid resolution' }, { status: 400 })
    }
    const notes = String(body?.notes || '').slice(0, 4000)

    const db = getDb()
    const dispute = await db
      .prepare('SELECT * FROM marketplace_disputes WHERE id = ?')
      .bind(id)
      .first<MarketplaceDisputeRow>()
    if (!dispute) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!['OPEN', 'UNDER_REVIEW'].includes(dispute.status)) {
      return NextResponse.json({ error: 'Dispute already resolved' }, { status: 400 })
    }

    const job = await db
      .prepare('SELECT * FROM marketplace_jobs WHERE id = ?')
      .bind(dispute.job_id)
      .first<MarketplaceJobRow>()
    if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

    const now = new Date().toISOString()

    if (resolution === 'refund') {
      await recordRefund(db, {
        jobId: job.id,
        amountCents: job.amount_cents,
        reason: `dispute:${dispute.reason}`,
        currency: job.currency,
        actorUserId: admin.id,
      })
      await applyTransition(db, {
        jobId: job.id,
        event: 'RESOLVE_REFUND',
        actorUserId: admin.id,
        payload: { disputeId: id, notes },
      })
      await db
        .prepare(
          `UPDATE marketplace_disputes
              SET status = 'RESOLVED_REFUND', resolver_id = ?, resolved_at = ?,
                  resolution_notes = ?, updated_at = ?
            WHERE id = ?`,
        )
        .bind(admin.id, now, notes, now, id)
        .run()
      try {
        await executeJobRefundMoneyMovement(db, job.id)
      } catch (e) {
        return NextResponse.json({
          status: 'RESOLVED_REFUND',
          paymentWarning: e instanceof Error ? e.message : 'Refund provider failed',
        })
      }
      return NextResponse.json({ status: 'RESOLVED_REFUND' })
    }

    if (resolution === 'release') {
      await recordRelease(db, {
        jobId: job.id,
        amountCents: job.amount_cents,
        platformFeeCents: job.platform_fee_cents,
        analystPayoutCents: job.analyst_payout_cents,
        currency: job.currency,
        actorUserId: admin.id,
      })
      await applyTransition(db, {
        jobId: job.id,
        event: 'RESOLVE_RELEASE',
        actorUserId: admin.id,
        patch: { released_at: now },
        payload: { disputeId: id, notes },
      })
      await recordAnalystPayoutStats(db, {
        analystId: job.analyst_id,
        analystPayoutCents: job.analyst_payout_cents,
      })
      await db
        .prepare(
          `UPDATE marketplace_disputes
              SET status = 'RESOLVED_RELEASE', resolver_id = ?, resolved_at = ?,
                  resolution_notes = ?, updated_at = ?
            WHERE id = ?`,
        )
        .bind(admin.id, now, notes, now, id)
        .run()
      try {
        await executeJobReleaseMoneyMovement(db, job.id)
      } catch (e) {
        return NextResponse.json({
          status: 'RESOLVED_RELEASE',
          paymentWarning: e instanceof Error ? e.message : 'Payout provider failed',
        })
      }
      return NextResponse.json({ status: 'RESOLVED_RELEASE' })
    }

    if (resolution === 'split') {
      const refundAmountCents = Math.max(0, Math.trunc(Number(body?.refundAmountCents) || 0))
      const payoutAmountCents = Math.max(0, Math.trunc(Number(body?.payoutAmountCents) || 0))
      if (refundAmountCents + payoutAmountCents > job.amount_cents) {
        return NextResponse.json(
          { error: 'refund + payout exceeds escrow balance' },
          { status: 400 },
        )
      }
      // Platform fee scales down proportionally with the payout.
      const feeBps = job.platform_fee_bps
      const platformFeeCents = Math.floor((payoutAmountCents * feeBps) / 10_000)
      const analystNetCents = Math.max(0, payoutAmountCents - platformFeeCents)

      await recordSplit(db, {
        jobId: job.id,
        refundAmountCents,
        payoutAmountCents: analystNetCents,
        platformFeeCents,
        currency: job.currency,
        actorUserId: admin.id,
      })
      await applyTransition(db, {
        jobId: job.id,
        event: 'RESOLVE_SPLIT',
        actorUserId: admin.id,
        payload: { disputeId: id, notes, refundAmountCents, payoutAmountCents: analystNetCents },
      })
      await db
        .prepare(
          `UPDATE marketplace_disputes
              SET status = 'RESOLVED_SPLIT', resolver_id = ?, resolved_at = ?,
                  resolution_notes = ?, refund_amount_cents = ?, payout_amount_cents = ?,
                  updated_at = ?
            WHERE id = ?`,
        )
        .bind(admin.id, now, notes, refundAmountCents, analystNetCents, now, id)
        .run()
      try {
        await executeJobSplitMoneyMovement(db, job.id)
      } catch (e) {
        return NextResponse.json({
          status: 'RESOLVED_SPLIT',
          refundAmountCents,
          payoutAmountCents: analystNetCents,
          platformFeeCents,
          paymentWarning: e instanceof Error ? e.message : 'Split payout provider failed',
        })
      }
      return NextResponse.json({
        status: 'RESOLVED_SPLIT',
        refundAmountCents,
        payoutAmountCents: analystNetCents,
        platformFeeCents,
      })
    }

    // dismiss: no money moved, dispute closed, job goes through normal RELEASE path.
    if (resolution === 'dismiss') {
      await recordRelease(db, {
        jobId: job.id,
        amountCents: job.amount_cents,
        platformFeeCents: job.platform_fee_cents,
        analystPayoutCents: job.analyst_payout_cents,
        currency: job.currency,
        actorUserId: admin.id,
      })
      await applyTransition(db, {
        jobId: job.id,
        event: 'RESOLVE_RELEASE',
        actorUserId: admin.id,
        patch: { released_at: now },
        payload: { disputeId: id, notes, dismissed: true },
      })
      await recordAnalystPayoutStats(db, {
        analystId: job.analyst_id,
        analystPayoutCents: job.analyst_payout_cents,
      })
      await db
        .prepare(
          `UPDATE marketplace_disputes
              SET status = 'DISMISSED', resolver_id = ?, resolved_at = ?,
                  resolution_notes = ?, updated_at = ?
            WHERE id = ?`,
        )
        .bind(admin.id, now, notes, now, id)
        .run()
      try {
        await executeJobReleaseMoneyMovement(db, job.id)
      } catch (e) {
        return NextResponse.json({
          status: 'DISMISSED',
          paymentWarning: e instanceof Error ? e.message : 'Payout provider failed',
        })
      }
      return NextResponse.json({ status: 'DISMISSED' })
    }

    return NextResponse.json({ error: 'unreachable' }, { status: 500 })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Admin only' }, { status: 403 })
    return NextResponse.json({ error: code || 'Failed to resolve dispute' }, { status: 400 })
  }
}
