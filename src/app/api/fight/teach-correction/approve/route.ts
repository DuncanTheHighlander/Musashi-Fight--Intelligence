import { NextResponse } from 'next/server'
import { getDbOrNull } from '@/lib/db'
import { requireUser } from '@/lib/musashiAuth'
import { writeAdminAudit } from '@/lib/adminRuntime'
import { getAiCorrection, updateAiCorrectionStatus } from '@/lib/aiCorrections/store'

type Body = {
  draftId?: string
  /** Optional edits before approve */
  correctionText?: string
  startMs?: number | null
  endMs?: number | null
  wholeClip?: boolean
  correctedLabelsJson?: string
  coachingNote?: string | null
  reject?: boolean
}

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

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  const draftId = String(body.draftId || '').trim()
  if (!draftId) return NextResponse.json({ success: false, error: 'draftId is required' }, { status: 400 })

  const before = await getAiCorrection(db, draftId)
  if (!before) return NextResponse.json({ success: false, error: 'Draft not found' }, { status: 404 })
  if (before.ownerUserId !== user.id) {
    return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
  }

  if (body.reject) {
    const after = await updateAiCorrectionStatus(db, draftId, 'rejected')
    await writeAdminAudit({
      adminUserId: user.id,
      action: 'ai_correction.reject',
      targetType: 'ai_correction',
      targetId: draftId,
      before,
      after,
    })
    return NextResponse.json({ success: true, correction: after })
  }

  const after = await updateAiCorrectionStatus(db, draftId, 'approved', {
    correctionText: body.correctionText,
    startMs: body.startMs,
    endMs: body.endMs,
    wholeClip: body.wholeClip,
    correctedLabelsJson: body.correctedLabelsJson,
    coachingNote: body.coachingNote,
  })

  await writeAdminAudit({
    adminUserId: user.id,
    action: 'ai_correction.approve',
    targetType: 'ai_correction',
    targetId: draftId,
    before,
    after,
  })

  return NextResponse.json({ success: true, correction: after })
}
