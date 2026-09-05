/**
 * POST /api/uploads — issue an upload ticket (mock local or R2 presigned PUT).
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { createUploadTicket } from '@/lib/storage/assets'
import type { MarketplaceAssetPurpose } from '@/lib/marketplace/types'

const VALID_PURPOSES: MarketplaceAssetPurpose[] = [
  'job_video',
  'deliverable',
  'dispute_evidence',
  'profile_media',
  'analysis_clip',
]

function handleError(e: unknown) {
  const code = e instanceof Error ? e.message : 'UNKNOWN'
  if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
  if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (code === 'STORAGE_NOT_CONFIGURED') {
    return NextResponse.json({ error: 'Storage not configured' }, { status: 501 })
  }
  if (code === 'DIRECT_R2_REQUIRED') {
    return NextResponse.json(
      {
        error: 'This original is too large for the app upload route. Trim it locally or enable direct R2 uploads.',
        code,
      },
      { status: 413 },
    )
  }
  return NextResponse.json({ error: code || 'Upload failed' }, { status: 400 })
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json()) as Record<string, unknown>

    const purpose = String(body?.purpose || '') as MarketplaceAssetPurpose
    if (!VALID_PURPOSES.includes(purpose)) {
      return NextResponse.json({ error: 'invalid purpose' }, { status: 400 })
    }

    const ticket = await createUploadTicket(getDb(), {
      userId: user.id,
      purpose,
      originalName: String(body?.originalName || ''),
      contentType: String(body?.contentType || ''),
      sizeBytes: Math.trunc(Number(body?.sizeBytes) || 0),
      jobId: body?.jobId ? String(body.jobId) : null,
      disputeId: body?.disputeId ? String(body.disputeId) : null,
      origin: new URL(req.url).origin,
    })

    return NextResponse.json(ticket, { status: 201 })
  } catch (e) {
    return handleError(e)
  }
}
