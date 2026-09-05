import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getVideoCreditBalance } from '@/lib/videoAnalysisSessions'

/** Server-authoritative balance for the signed-in athlete's video credits. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    return NextResponse.json(await getVideoCreditBalance(user.id, user.role))
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    if (/unauthorized|invalid session|no session/i.test(code)) {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Could not load video credits' }, { status: 503 })
  }
}
