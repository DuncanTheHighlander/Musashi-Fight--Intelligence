/**
 * POST /api/social/disputes/[id]/evidence
 *   Allows the analyst to add a counter-statement + evidence, or the opener
 *   to add supplementary evidence. Admin can always add.
 *
 *   Body: {
 *     role?: 'opener'|'counter'    // optional; inferred from user role
 *     statement?: string           // only meaningful for 'counter'
 *     evidenceUrls: string[]
 *   }
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import type { MarketplaceDisputeRow, MarketplaceJobRow } from '@/lib/marketplace/types'
import { assertUploadedAssetsOwned } from '@/lib/storage/assets'
import { toAssetRef } from '@/lib/storage/assetRef'

type Params = { id: string }

const uniqMerge = (a: string[], b: string[]): string[] => {
  const s = new Set<string>()
  for (const x of a) if (x) s.add(String(x))
  for (const x of b) if (x) s.add(String(x))
  return Array.from(s)
}

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await requireUser(req)
    const { id } = await context.params
    const body = (await req.json()) as Record<string, unknown>

    const statement = String(body?.statement || '').trim()
    const evidenceUrls = Array.isArray(body?.evidenceUrls)
      ? (body.evidenceUrls as unknown[]).map(String).filter(Boolean)
      : []
    const evidenceAssetIds = Array.isArray(body?.evidenceAssetIds)
      ? (body.evidenceAssetIds as unknown[]).map(String).filter(Boolean)
      : []

    if (!evidenceUrls.length && !evidenceAssetIds.length && !statement) {
      return NextResponse.json({ error: 'statement or evidenceUrls required' }, { status: 400 })
    }

    const db = getDb()
    if (evidenceAssetIds.length) {
      await assertUploadedAssetsOwned(db, evidenceAssetIds, user.id, 'dispute_evidence')
    }
    const mergedEvidence = [...evidenceUrls, ...evidenceAssetIds.map(toAssetRef)]

    const dispute = await db
      .prepare('SELECT * FROM marketplace_disputes WHERE id = ?')
      .bind(id)
      .first<MarketplaceDisputeRow>()
    if (!dispute) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!['OPEN', 'UNDER_REVIEW'].includes(dispute.status)) {
      return NextResponse.json({ error: 'Dispute already resolved' }, { status: 400 })
    }

    const job = await db
      .prepare('SELECT fighter_id, analyst_id FROM marketplace_jobs WHERE id = ?')
      .bind(dispute.job_id)
      .first<Pick<MarketplaceJobRow, 'fighter_id' | 'analyst_id'>>()

    const isOpener = user.id === dispute.opened_by_id
    const isCounterparty =
      !!job &&
      ((user.id === job.fighter_id && dispute.opened_by_id !== job.fighter_id) ||
        (user.id === job.analyst_id && dispute.opened_by_id !== job.analyst_id))
    const isAdmin = user.role === 'shogun'

    if (!isOpener && !isCounterparty && !isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const now = new Date().toISOString()

    if (isCounterparty) {
      // Merge into counter fields
      let existing: string[] = []
      try { existing = JSON.parse(dispute.counter_evidence_urls || '[]') } catch {}
      const merged = uniqMerge(existing, mergedEvidence)
      await db
        .prepare(
          `UPDATE marketplace_disputes
              SET counter_statement = COALESCE(NULLIF(?, ''), counter_statement),
                  counter_evidence_urls = ?,
                  status = CASE WHEN status = 'OPEN' THEN 'UNDER_REVIEW' ELSE status END,
                  updated_at = ?
            WHERE id = ?`,
        )
        .bind(statement, JSON.stringify(merged), now, id)
        .run()
    } else {
      // Merge into opener fields
      let existing: string[] = []
      try { existing = JSON.parse(dispute.evidence_urls || '[]') } catch {}
      const merged = uniqMerge(existing, mergedEvidence)
      await db
        .prepare(
          `UPDATE marketplace_disputes
              SET evidence_urls = ?,
                  description = CASE WHEN ? <> '' THEN description || '\n\n' || ? ELSE description END,
                  updated_at = ?
            WHERE id = ?`,
        )
        .bind(JSON.stringify(merged), statement, statement, now, id)
        .run()
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to add evidence' }, { status: 400 })
  }
}
