import { getDbOrNull } from '@/lib/db'
import { exportCorrectionDataset } from '@/lib/ledgerStore'

/**
 * GET /api/fight/ledgers/export → the labeled dataset as JSONL.
 * One line per human-corrected detection: the item's full detection payload
 * plus the human verdict. This is the training data for tuning detectors.
 */
export async function GET(request: Request) {
  const db = getDbOrNull()
  if (!db) {
    return new Response(JSON.stringify({ success: false, error: 'Database not available' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const url = new URL(request.url)
    const limit = Math.min(50000, Math.max(1, Number(url.searchParams.get('limit') ?? 5000) || 5000))
    const records = await exportCorrectionDataset(db, limit)
    const jsonl = records.map((r) => JSON.stringify(r)).join('\n')
    return new Response(jsonl, {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'content-disposition': `attachment; filename="musashi-corrections-${new Date().toISOString().slice(0, 10)}.jsonl"`,
      },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ success: false, error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    )
  }
}
