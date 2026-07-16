import { NextResponse } from 'next/server'
import {
  buildSessionCookieHeader,
  createSession,
  ensureShogunUserExists,
  getConfiguredShogunEmail,
  isEmailVerificationRequired,
  verifyLogin,
} from '@/lib/musashiAuth'

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string; password?: string }

    const rawEmail = String(body?.email || '').trim()
    const password = String(body?.password || '')
    const normalized = rawEmail.toLowerCase()

    // Admin bootstrap: email "shogun" (legacy shortcut) OR the configured shogun email.
    // Syncs D1 password/role from Cloudflare secrets before verifying.
    const shogunEmail = getConfiguredShogunEmail()
    const isAdminLogin = normalized === 'shogun' || normalized === shogunEmail
    if (isAdminLogin) {
      const shogun = await ensureShogunUserExists()
      const user = await verifyLogin({ email: shogun.email, password })
      const { cookieValue } = await createSession(req, user.id)

      return NextResponse.json(
        { user: { ...user, emailVerificationRequired: isEmailVerificationRequired() } },
        {
          status: 200,
          headers: {
            'Set-Cookie': buildSessionCookieHeader(cookieValue),
          },
        }
      )
    }

    const user = await verifyLogin({ email: rawEmail, password })

    const { cookieValue } = await createSession(req, user.id)

    return NextResponse.json(
      { user: { ...user, emailVerificationRequired: isEmailVerificationRequired() } },
      {
        status: 200,
        headers: {
          'Set-Cookie': buildSessionCookieHeader(cookieValue),
        },
      }
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 401 })
  }
}
