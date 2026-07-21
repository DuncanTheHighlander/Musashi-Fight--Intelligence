import { NextResponse } from 'next/server'
import { getDbOrNull } from '@/lib/db'
import { requireUser } from '@/lib/musashiAuth'
import { listAiCorrections, type AiCorrectionStatus } from '@/lib/aiCorrections/store'

const STATUSES: AiCorrectionStatus[] = ['draft', 'approved', 'gold', 'rejected', 'archived']

export async function GET(request: Request) {
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

  const url = new URL(request.url)
  const statusParam = url.searchParams.get('status')
  const limit = Number(url.searchParams.get('limit') || 50)
  let status: AiCorrectionStatus | AiCorrectionStatus[] | undefined
  if (statusParam && statusParam !== 'all') {
    const parts = statusParam.split(',').filter((s): s is AiCorrectionStatus => STATUSES.includes(s as AiCorrectionStatus))
    status = parts.length === 1 ? parts[0] : parts.length > 1 ? parts : undefined
  }

  const rows = await listAiCorrections(db, {
    ownerUserId: user.id,
    status,
    limit: Number.isFinite(limit) ? limit : 50,
  })

  return NextResponse.json({ success: true, corrections: rows })
}
