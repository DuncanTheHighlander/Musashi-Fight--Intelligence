/**
 * POST /api/social/jobs/[id]/dispute — open a dispute on a job.
 *
 * Either party (fighter OR analyst) may open a dispute on jobs that are in
 * IN_PROGRESS, SUBMITTED, APPROVED, or RELEASED. This flips the job to
 * DISPUTED and creates a marketplace_disputes row seeded OPEN.
 *
 * Body:
 *   {
 *     reason: 'not_delivered'|'poor_quality'|'off_brief'|'late'
 *            |'plagiarism'|'harassment'|'fraud'|'other',
 *     description: string,
 *     evidenceUrls?: string[],
 *   }
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb, newId } from '@/lib/marketplace/types'
import type { DisputeReason } from '@/lib/marketplace/types'
import { applyTransition, fetchJob } from '@/lib/marketplace/jobs'
import { assertUploadedAssetsOwned } from '@/lib/storage/assets'
import { toAssetRef } from '@/lib/storage/assetRef'

const VALID_REASONS: DisputeReason[] = [
  'not_delivered',
  'poor_quality',
  'off_brief',
  'late',
  'plagiarism',
  'harassment',
  'fraud',
  'other',
]

type Params = { id: string }

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await requireUser(req)
    const { id } = await context.params
    const body = (await req.json()) as Record<string, unknown>

    const reason = String(body?.reason || '').trim() as DisputeReason
    const description = String(body?.description || '').trim()
    const evidenceUrls = Array.isArray(body?.evidenceUrls)
      ? (body.evidenceUrls as unknown[]).map(String).filter(Boolean)
      : []
    const evidenceAssetIds = Array.isArray(body?.evidenceAssetIds)
      ? (body.evidenceAssetIds as unknown[]).map(String).filter(Boolean)
      : []

    if (!VALID_REASONS.includes(reason)) {
      return NextResponse.json({ error: 'invalid reason' }, { status: 400 })
    }
    if (!description) {
      return NextResponse.json({ error: 'description required' }, { status: 400 })
    }

    const db = getDb()
    if (evidenceAssetIds.length) {
      await assertUploadedAssetsOwned(db, evidenceAssetIds, user.id, 'dispute_evidence')
    }
    const mergedEvidence = [...evidenceUrls, ...evidenceAssetIds.map(toAssetRef)]

    const job = await fetchJob(db, id)
    if (!job) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (job.fighter_id !== user.id && job.analyst_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Only one open dispute per job
    const existing = await db
      .prepare('SELECT id FROM marketplace_disputes WHERE job_id = ?')
      .bind(id)
      .first<{ id: string }>()
    if (existing) {
      return NextResponse.json({ error: 'Dispute already exists', disputeId: existing.id }, { status: 409 })
    }

    const disputeId = newId('dsp')
    const now = new Date().toISOString()
    await db
      .prepare(
        `INSERT INTO marketplace_disputes (
           id, job_id, opened_by_id, reason, description, evidence_urls,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
      )
      .bind(disputeId, id, user.id, reason, description, JSON.stringify(mergedEvidence), now, now)
      .run()

    await applyTransition(db, {
      jobId: id,
      event: 'DISPUTE',
      actorUserId: user.id,
      payload: { disputeId, reason },
    })

    // Bump analyst's jobs_disputed stat
    if (job.analyst_id) {
      await db
        .prepare(
          `UPDATE analyst_profiles
              SET jobs_disputed = jobs_disputed + 1,
                  updated_at = ?
            WHERE user_id = ?`,
        )
        .bind(now, job.analyst_id)
        .run()
    }

    return NextResponse.json({ disputeId, jobId: id, status: 'OPEN' }, { status: 201 })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to open dispute' }, { status: 400 })
  }
}
