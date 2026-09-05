import { NextResponse } from 'next/server'
import { getDbOrNull } from '@/lib/db'
import { requireUser } from '@/lib/musashiAuth'
import { writeAdminAudit } from '@/lib/adminRuntime'
import {
  getAiCorrection,
  updateAiCorrectionStatus,
  type AiCorrectionStatus,
} from '@/lib/aiCorrections/store'

const ALLOWED: AiCorrectionStatus[] = ['draft', 'approved', 'gold', 'rejected', 'archived']

export async function POST(request: Request) {
  let user
  try {
    user = await requireUser(request, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 })
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const db = getDbOrNull()
  if (!db) return NextResponse.json({ success: false, error: 'Database not available' }, { status: 503 })

  const body = (await request.json().catch(() => ({}))) as { id?: string; status?: string }
  const id = String(body.id || '').trim()
  const status = String(body.status || '').trim() as AiCorrectionStatus
  if (!id || !ALLOWED.includes(status)) {
    return NextResponse.json({ success: false, error: 'id and valid status required' }, { status: 400 })
  }

  const before = await getAiCorrection(db, id)
  if (!before) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 })
  if (before.ownerUserId !== user.id) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  const after = await updateAiCorrectionStatus(db, id, status)
  await writeAdminAudit({
    adminUserId: user.id,
    action: `ai_correction.status.${status}`,
    targetType: 'ai_correction',
    targetId: id,
    before,
    after,
  })

  return NextResponse.json({ success: true, correction: after })
}
