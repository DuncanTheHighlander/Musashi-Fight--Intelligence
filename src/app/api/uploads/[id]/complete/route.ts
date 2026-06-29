/**
 * POST /api/uploads/[id]/complete — mark upload finished after bytes land in storage.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { completeUpload } from '@/lib/storage/assets'

type Params = { id: string }

function handleError(e: unknown) {
  const code = e instanceof Error ? e.message : 'UNKNOWN'
  if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
  if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (code === 'NOT_FOUND') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ error: code || 'Failed' }, { status: 400 })
}

export async function POST(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await requireUser(req)
    const { id } = await context.params
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

    const asset = await completeUpload(getDb(), {
      assetId: id,
      userId: user.id,
      sizeBytes: body?.sizeBytes != null ? Math.trunc(Number(body.sizeBytes)) : undefined,
      sha256: body?.sha256 ? String(body.sha256) : null,
    })

    return NextResponse.json({ asset })
  } catch (e) {
    return handleError(e)
  }
}
