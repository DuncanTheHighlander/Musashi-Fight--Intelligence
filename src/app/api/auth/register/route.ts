import { NextResponse } from 'next/server'
import { buildSessionCookieHeader, createSession, createUser, type MusashiRole } from '@/lib/musashiAuth'

type RegisterBody = {
  email?: string
  password?: string
  display_name?: string
  inviteCode?: string
}

const canRegisterShogun = async (inviteCode: string | undefined): Promise<boolean> => {
  const expected = process.env.MUSASHI_SHOGUN_INVITE_CODE
  if (!expected) return false
  return String(inviteCode || '') === String(expected)
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RegisterBody

    const email = String(body?.email || '').trim().toLowerCase()
    const password = String(body?.password || '')

    let role: MusashiRole = 'user'
    if (await canRegisterShogun(body.inviteCode)) {
      role = 'shogun'
    }

    const display_name = body.display_name ? String(body.display_name).trim() : undefined
    const user = await createUser({ email, password, role, display_name })
    const { cookieValue } = await createSession(req, user.id)

    return NextResponse.json(
      { user },
      {
        status: 200,
        headers: {
          'Set-Cookie': buildSessionCookieHeader(cookieValue),
        },
      }
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
