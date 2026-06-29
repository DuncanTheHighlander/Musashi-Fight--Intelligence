import { NextResponse } from 'next/server'
import { consumeEmailToken } from '@/lib/auth/emailTokens'
import { getDb } from '@/lib/db'

type ConfirmBody = { token?: string }

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ConfirmBody
    const token = String(body?.token || '').trim()
    if (!token) return NextResponse.json({ error: 'Token required' }, { status: 400 })

    const db = getDb()
    const consumed = await consumeEmailToken(db, token, 'verify_email')
    const now = new Date().toISOString()

    await db
      .prepare('UPDATE musashi_users SET email_verified_at = ?, updated_at = ? WHERE id = ?')
      .bind(now, now, consumed.userId)
      .run()

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    if (msg === 'TOKEN_EXPIRED') return NextResponse.json({ error: 'Token expired' }, { status: 410 })
    if (msg === 'TOKEN_INVALID') return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
