/**
 * GET /api/social/disputes — admin-only queue of disputes.
 *
 * Filters: ?status=OPEN|UNDER_REVIEW|...  ?mine=1 (filter to disputes the
 * user is involved in, for non-admin consumers).
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import type { MarketplaceDisputeRow } from '@/lib/marketplace/types'

const VALID_STATUSES = [
  'OPEN',
  'UNDER_REVIEW',
  'RESOLVED_REFUND',
  'RESOLVED_RELEASE',
  'RESOLVED_SPLIT',
  'DISMISSED',
]

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const mine = searchParams.get('mine') === '1'
    const limit = Math.min(Math.max(Number(searchParams.get('limit') || 50), 1), 200)

    // Admin-only for global view; participants can see their own via mine=1
    if (!mine) {
      try {
        await requireUser(req, { role: 'shogun' })
      } catch {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const where: string[] = []
    const params: unknown[] = []

    if (status && VALID_STATUSES.includes(status)) {
      where.push('d.status = ?')
      params.push(status)
    } else if (status === 'active') {
      where.push("d.status IN ('OPEN', 'UNDER_REVIEW')")
    }

    if (mine) {
      where.push('(d.opened_by_id = ? OR j.fighter_id = ? OR j.analyst_id = ?)')
      params.push(user.id, user.id, user.id)
    }

    const sql = `
      SELECT d.*, j.fighter_id, j.analyst_id, j.title as job_title, j.amount_cents
        FROM marketplace_disputes d
        JOIN marketplace_jobs j ON j.id = d.job_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY d.created_at DESC
       LIMIT ?
    `
    params.push(limit)

    const db = getDb()
    const result = await db.prepare(sql).bind(...params).all<MarketplaceDisputeRow & {
      fighter_id: string
      analyst_id: string | null
      job_title: string
      amount_cents: number
    }>()

    const disputes = (result.results || []).map((r) => ({
      id: r.id,
      jobId: r.job_id,
      jobTitle: r.job_title,
      fighterId: r.fighter_id,
      analystId: r.analyst_id,
      amountCents: r.amount_cents,
      openedById: r.opened_by_id,
      reason: r.reason,
      description: r.description,
      status: r.status,
      createdAt: r.created_at,
    }))

    return NextResponse.json({ disputes })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Failed to list disputes' }, { status: 400 })
  }
}
