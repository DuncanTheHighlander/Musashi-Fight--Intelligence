import { NextResponse } from 'next/server'
import { getDbOrNull } from '@/lib/db'
import { requireUser } from '@/lib/musashiAuth'
import { getAnalysisLedger, listAnalysisLedgers } from '@/lib/ledgerStore'
import { listCoachingFeedback } from '@/lib/coachingFeedbackStore'

/**
 * GET /api/fight/ledgers          → list recent saved ledgers (summaries)
 * GET /api/fight/ledgers?id=...   → one ledger with its items + corrections
 */
export async function GET(request: Request) {
  try {
    await requireUser(request, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 })
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const db = getDbOrNull()
  if (!db) {
    return NextResponse.json({ success: false, error: 'Database not available' }, { status: 503 })
  }
  try {
    const url = new URL(request.url)
    const id = url.searchParams.get('id')
    if (id) {
      const result = await getAnalysisLedger(db, id)
      if (!result) {
        return NextResponse.json({ success: false, error: 'Ledger not found' }, { status: 404 })
      }
      // User thumbs up/down ratings for this analysis. Non-fatal: the table
      // may be absent on older local DBs that haven't run migration 0014.
      const userFeedback = await listCoachingFeedback(db, { ledgerId: id }).catch(() => [])
      return NextResponse.json({ success: true, ...result, userFeedback })
    }
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 25) || 25))
    const ledgers = await listAnalysisLedgers(db, limit)
    return NextResponse.json({ success: true, ledgers })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
