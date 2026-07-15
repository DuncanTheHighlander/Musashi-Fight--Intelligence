import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getNoClipChatBalance } from '@/lib/noClipChatUsage'

/** Daily, server-authoritative no-video coaching balance for the signed-in user. */
export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    return NextResponse.json(await getNoClipChatBalance(user.id, user.role))
  } catch (error) {
    const code = error instanceof Error ? error.message : 'UNKNOWN'
    if (/unauthorized|invalid session|no session/i.test(code)) {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Could not load coaching balance' }, { status: 503 })
  }
}
