import { NextResponse } from 'next/server'
import { getDbOrNull } from '@/lib/db'
import { requireUser } from '@/lib/musashiAuth'
import { saveCoachingFeedback } from '@/lib/coachingFeedbackStore'

type FeedbackRequest = {
  /** Saved analysis ledger id (ledg_*) returned by /api/fight/analyze. */
  ledgerId?: string
  rating?: number
  aiModel?: string | null
  discipline?: string | null
}

/** POST /api/fight/coaching-feedback → thumbs up (1) / thumbs down (-1) on an analysis. */
export async function POST(request: Request) {
  let user
  try {
    user = await requireUser(request)
  } catch {
    return NextResponse.json({ success: false, error: 'Login required' }, { status: 401 })
  }

  const db = getDbOrNull()
  if (!db) {
    return NextResponse.json({ success: false, error: 'Database not available' }, { status: 503 })
  }

  let body: FeedbackRequest
  try {
    body = (await request.json()) as FeedbackRequest
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON' }, { status: 400 })
  }

  if (!body.ledgerId || typeof body.ledgerId !== 'string') {
    return NextResponse.json({ success: false, error: 'ledgerId is required' }, { status: 400 })
  }
  if (body.rating !== 1 && body.rating !== -1) {
    return NextResponse.json({ success: false, error: 'rating must be 1 or -1' }, { status: 400 })
  }

  try {
    const id = await saveCoachingFeedback({
      db,
      userId: user.id,
      ledgerId: body.ledgerId,
      rating: body.rating,
      aiModel: typeof body.aiModel === 'string' ? body.aiModel : null,
      discipline: typeof body.discipline === 'string' ? body.discipline : null,
    })
    return NextResponse.json({ success: true, feedbackId: id })
  } catch (err) {
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
