/**
 * GET/POST /api/cron/marketplace — periodic maintenance for marketplace_jobs.
 *
 * Intended to be invoked every 5 minutes (Cloudflare Cron, Vercel Cron, or a
 * Worker scheduled handler). Auth is via a shared secret header
 *   `X-Cron-Secret: $MUSASHI_CRON_SECRET`
 * so it cannot be abused by unauthenticated traffic. If the secret is not
 * configured the route is available only in development.
 *
 * Jobs performed:
 *   1. Expire FUNDED bounties past claim_deadline_at → refund + EXPIRE.
 *   2. Expire IN_PROGRESS jobs past delivery_deadline_at → refund + EXPIRE.
 *   3. Auto-release SUBMITTED jobs past approval_deadline_at (72h) → RELEASE.
 */
import { NextResponse } from 'next/server'
import { runMarketplaceCron } from '@/lib/marketplace/cron'
import { getDb } from '@/lib/marketplace/types'

function authOk(req: Request): boolean {
  const secret = process.env.MUSASHI_CRON_SECRET
  if (!secret) {
    return process.env.NODE_ENV !== 'production'
  }
  return req.headers.get('x-cron-secret') === secret
}

export async function GET(req: Request) {
  if (!authOk(req)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  try {
    const result = await runMarketplaceCron(getDb())
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export const POST = GET
