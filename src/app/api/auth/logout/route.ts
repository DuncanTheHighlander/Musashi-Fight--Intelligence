import { NextResponse } from 'next/server'
import { buildClearSessionCookieHeader, revokeCurrentSession } from '@/lib/musashiAuth'

export async function POST(req: Request) {
  try {
    await revokeCurrentSession(req)
  } catch {
    // ignore
  }

  return NextResponse.json(
    { ok: true },
    {
      status: 200,
      headers: {
        'Set-Cookie': buildClearSessionCookieHeader(),
      },
    }
  )
}
