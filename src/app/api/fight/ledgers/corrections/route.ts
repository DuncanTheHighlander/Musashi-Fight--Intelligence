import { NextResponse } from 'next/server'
import { getDbOrNull } from '@/lib/db'
import { getCurrentUser } from '@/lib/musashiAuth'
import { addLedgerCorrection, type CorrectionItemType, type CorrectionVerdict } from '@/lib/ledgerStore'

type CorrectionRequest = {
  ledgerId?: string
  itemType?: CorrectionItemType
  itemId?: string
  originalKind?: string
  verdict?: CorrectionVerdict
  correctedKind?: string | null
  actorId?: string | null
  note?: string | null
}

const ITEM_TYPES: CorrectionItemType[] = ['event', 'fault', 'pattern']
const VERDICTS: CorrectionVerdict[] = ['confirm', 'reject', 'relabel']

/** POST /api/fight/ledgers/corrections → record a human verdict on a detected item. */
export async function POST(request: Request) {
  const db = getDbOrNull()
  if (!db) {
    return NextResponse.json({ success: false, error: 'Database not available' }, { status: 503 })
  }

  let body: CorrectionRequest
  try {
    body = (await request.json()) as CorrectionRequest
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.ledgerId || !body.itemId || !body.originalKind) {
    return NextResponse.json(
      { success: false, error: 'ledgerId, itemId, and originalKind are required' },
      { status: 400 }
    )
  }
  if (!body.itemType || !ITEM_TYPES.includes(body.itemType)) {
    return NextResponse.json({ success: false, error: 'itemType must be event | fault | pattern' }, { status: 400 })
  }
  if (!body.verdict || !VERDICTS.includes(body.verdict)) {
    return NextResponse.json({ success: false, error: 'verdict must be confirm | reject | relabel' }, { status: 400 })
  }
  if (body.verdict === 'relabel' && !body.correctedKind) {
    return NextResponse.json({ success: false, error: 'correctedKind is required for relabel' }, { status: 400 })
  }

  try {
    const user = await getCurrentUser(request)
    const id = await addLedgerCorrection({
      db,
      ledgerId: body.ledgerId,
      itemType: body.itemType,
      itemId: body.itemId,
      originalKind: body.originalKind,
      verdict: body.verdict,
      correctedKind: body.correctedKind ?? null,
      actorId: body.actorId ?? null,
      note: body.note ?? null,
      createdBy: user?.id ?? null,
    })
    return NextResponse.json({ success: true, correctionId: id })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const status = message.startsWith('Ledger not found') ? 404 : 500
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
