/**
 * GET /api/shogun/business-metrics — revenue, conversion, API cost estimates.
 * Shogun-only.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { computeBusinessMetrics } from '@/lib/adminBusinessMetrics'

export async function GET(req: Request) {
  try {
    await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const metrics = await computeBusinessMetrics()
    return NextResponse.json(metrics, { status: 200 })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to load business metrics'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
