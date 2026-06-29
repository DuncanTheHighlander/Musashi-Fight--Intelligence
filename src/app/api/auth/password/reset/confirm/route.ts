import { NextResponse } from 'next/server'
import { consumeEmailToken } from '@/lib/auth/emailTokens'
import { getDb } from '@/lib/db'
import { revokeAllUserSessions, updateUserPassword } from '@/lib/musashiAuth'

type ResetConfirmBody = { token?: string; password?: string }

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ResetConfirmBody
    const token = String(body?.token || '').trim()
    const password = String(body?.password || '')
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

    const db = getDb()
    const consumed = await consumeEmailToken(db, token, 'password_reset')
    await updateUserPassword(consumed.userId, password)
    await revokeAllUserSessions(consumed.userId)

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    if (msg === 'TOKEN_EXPIRED') return NextResponse.json({ error: 'Token expired' }, { status: 410 })
    if (msg === 'TOKEN_INVALID') return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
