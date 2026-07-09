import { NextResponse } from 'next/server'
import { getDbOrNull } from '@/lib/db'
import { requireUser } from '@/lib/musashiAuth'
import { listTrainingDataset, toTrainingExportRecord } from '@/lib/trainingDatasetStore'

/**
 * GET /api/admin/export-training-data
 * Export labeled training samples (JSONL by default, JSON array with ?format=json).
 * Shogun-only. Rows are created automatically when corrections are confirmed/relabeled.
 */
export async function GET(request: Request) {
  try {
    await requireUser(request, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') {
      return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 })
    }
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const db = getDbOrNull()
  if (!db) {
    return NextResponse.json({ success: false, error: 'Database not available' }, { status: 503 })
  }

  const url = new URL(request.url)
  const format = url.searchParams.get('format') ?? 'jsonl'
  const limit = Math.min(10_000, Math.max(1, Number(url.searchParams.get('limit') ?? 5000)))

  try {
    const rows = await listTrainingDataset(db, limit)
    const records = rows.map(toTrainingExportRecord)

    if (format === 'json') {
      return NextResponse.json({ success: true, count: records.length, records })
    }

    const jsonl = records.map((r) => JSON.stringify(r)).join('\n')
    const date = new Date().toISOString().slice(0, 10)
    return new Response(jsonl, {
      status: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Content-Disposition': `attachment; filename="musashi-training-${date}.jsonl"`,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
