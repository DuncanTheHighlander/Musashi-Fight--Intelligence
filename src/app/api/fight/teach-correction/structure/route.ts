import { NextResponse } from 'next/server'
import { getDbOrNull } from '@/lib/db'
import { requireUser } from '@/lib/musashiAuth'
import { writeAdminAudit } from '@/lib/adminRuntime'
import { resolveSportKey } from '@/lib/coachBrain/coachBrain'
import { computeVideoFingerprint } from '@/lib/aiCorrections/fingerprint'
import { insertAiCorrection } from '@/lib/aiCorrections/store'
import { previewSummary, structureCorrectionWithFlash } from '@/lib/aiCorrections/structure'
import { classifyFailure, failureMessage } from '@/lib/fight/pipelineStatus'

type Body = {
  surface?: 'coach_card' | 'chat'
  responseRef?: string | null
  cardSection?: string | null
  sport?: string
  focusTarget?: string | null
  clipId?: string | null
  ledgerId?: string | null
  originalText?: string
  correctionText?: string
  startMs?: number | null
  endMs?: number | null
  wholeClip?: boolean
  noTimestamp?: boolean
  clipDurationMs?: number | null
  clarificationAnswer?: string | null
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

  const originalText = String(body.originalText || '').trim()
  const correctionText = String(body.correctionText || '').trim()
  const sportRaw = String(body.sport || '').trim()
  const sport = resolveSportKey(sportRaw) || sportRaw
  if (!originalText || !correctionText) {
    return NextResponse.json({ success: false, error: 'originalText and correctionText are required' }, { status: 400 })
  }
  if (!sport) {
    return NextResponse.json({ success: false, error: 'sport is required' }, { status: 400 })
  }

  const surface = body.surface === 'chat' ? 'chat' : 'coach_card'
  const wholeClip = Boolean(body.wholeClip)
  const noTimestamp = Boolean(body.noTimestamp)
  let startMs = typeof body.startMs === 'number' && Number.isFinite(body.startMs) ? Math.trunc(body.startMs) : null
  let endMs = typeof body.endMs === 'number' && Number.isFinite(body.endMs) ? Math.trunc(body.endMs) : null
  if (wholeClip || noTimestamp) {
    startMs = null
    endMs = null
  }

  const correctionWithClarification = body.clarificationAnswer
    ? `${correctionText}\n(Clarification: ${String(body.clarificationAnswer).trim()})`
    : correctionText

  let structured
  try {
    structured = await structureCorrectionWithFlash({
      sport,
      originalText,
      correctionText: correctionWithClarification,
      cardSection: body.cardSection ?? null,
      responseType: surface,
    })
  } catch (err) {
    // Never surface raw model output to the athlete — a truncated JSON
    // fragment or leaked chain-of-thought is not an actionable message.
    // Keep the real detail server-side; send the classified failure text.
    console.error('[teach-correction/structure] structuring failed:', err)
    const kind = classifyFailure(err, 'building_coaching')
    return NextResponse.json(
      { success: false, error: failureMessage(kind), failureKind: kind },
      { status: 502 },
    )
  }

  if (structured.needs_clarification && !body.clarificationAnswer) {
    return NextResponse.json({
      success: true,
      needsClarification: true,
      clarificationQuestion: structured.clarification_question || 'Can you clarify which fighter or moment you mean?',
      preview: null,
      draftId: null,
    })
  }

  const clipId = body.clipId ? String(body.clipId).trim() : null
  let fingerprint: string | null = null
  if (clipId) {
    fingerprint = await computeVideoFingerprint({
      db,
      assetId: clipId,
      userId: user.id,
      isAdmin: true,
      durationMs: body.clipDurationMs ?? null,
    })
  }

  const labelsPayload = {
    incorrect_labels: structured.incorrect_labels.map((l) => l.value),
    correct_labels: structured.correct_labels.map((l) => l.value),
    incorrect_labels_meta: structured.incorrect_labels,
    correct_labels_meta: structured.correct_labels,
    position: structured.position,
    transition: structured.transition,
    controlling_fighter: structured.controlling_fighter,
    correction_categories: structured.correction_categories,
    coaching_note: structured.coaching_note,
  }

  const draft = await insertAiCorrection(db, {
    ownerUserId: user.id,
    clipId,
    videoFingerprint: fingerprint,
    ledgerId: body.ledgerId ? String(body.ledgerId) : null,
    responseType: surface,
    responseRef: body.responseRef ?? null,
    cardSection: body.cardSection ?? null,
    sport,
    focusTarget: body.focusTarget ?? null,
    startMs,
    endMs,
    wholeClip,
    originalText,
    correctionText: correctionWithClarification,
    correctedLabelsJson: JSON.stringify(labelsPayload),
    correctionCategoriesJson: JSON.stringify(structured.correction_categories),
    coachingNote: structured.coaching_note,
    status: 'draft',
    modelName: structured.modelName,
  })

  await writeAdminAudit({
    adminUserId: user.id,
    action: 'ai_correction.draft',
    targetType: 'ai_correction',
    targetId: draft.id,
    after: { sport, surface, startMs, endMs, wholeClip },
  })

  const windowLabel = wholeClip
    ? 'whole clip'
    : noTimestamp || (startMs == null && endMs == null)
      ? 'no timestamp'
      : `${((startMs ?? 0) / 1000).toFixed(1)}–${((endMs ?? startMs ?? 0) / 1000).toFixed(1)}s`

  return NextResponse.json({
    success: true,
    needsClarification: false,
    draftId: draft.id,
    ledgerAttached: Boolean(draft.ledgerId),
    fingerprintAttached: Boolean(fingerprint),
    preview: {
      summary: previewSummary(structured, windowLabel),
      structured,
      startMs,
      endMs,
      wholeClip,
      noTimestamp,
    },
  })
}
