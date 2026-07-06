/**
 * /api/library/review — admin moderation of user-submitted knowledge documents.
 * Shogun-only. GET lists the pending queue; POST approves or rejects one.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { listPendingReviewDocuments, setDocumentReviewState } from '@/lib/musashiLibrary'

export async function GET(req: Request) {
  try {
    await requireUser(req, { role: 'shogun' })
    const documents = await listPendingReviewDocuments(100)
    return NextResponse.json({ documents })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to load review queue' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    await requireUser(req, { role: 'shogun' })
    const body = (await req.json()) as { id?: string; decision?: string }
    const id = String(body?.id || '').trim()
    const decision = String(body?.decision || '').trim()

    if (!id || (decision !== 'approve' && decision !== 'reject')) {
      return NextResponse.json(
        { error: "Provide an id and a decision of 'approve' or 'reject'." },
        { status: 400 },
      )
    }

    const reviewState = decision === 'approve' ? 'approved' : 'rejected'
    const ok = await setDocumentReviewState(id, reviewState)
    if (!ok) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    return NextResponse.json({ id, reviewState })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to update document' }, { status: 500 })
  }
}
