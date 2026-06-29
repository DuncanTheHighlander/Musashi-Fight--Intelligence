/**
 * GET /api/uploads/[id] — asset metadata + signed read URL for authorized users.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { getReadableAsset } from '@/lib/storage/assets'

type Params = { id: string }

function handleError(e: unknown) {
  const code = e instanceof Error ? e.message : 'UNKNOWN'
  if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
  if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (code === 'NOT_FOUND') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ error: code || 'Failed' }, { status: 400 })
}

export async function GET(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await requireUser(req)
    const { id } = await context.params
    const result = await getReadableAsset(getDb(), {
      assetId: id,
      userId: user.id,
      isAdmin: user.role === 'shogun',
    })
    return NextResponse.json(result)
  } catch (e) {
    return handleError(e)
  }
}
