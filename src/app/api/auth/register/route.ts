import { NextResponse } from 'next/server'
import { createEmailToken } from '@/lib/auth/emailTokens'
import { sendTransactionalEmail } from '@/lib/email/emailClient'
import { getDbAsync } from '@/lib/db'
import { buildSessionCookieHeader, createSession, createUser, isEmailVerificationRequired, type MusashiRole } from '@/lib/musashiAuth'

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

const appBaseUrl = (req: Request): string =>
  process.env.MUSASHI_APP_URL?.replace(/\/$/, '') || new URL(req.url).origin

/** Best-effort verification email — never blocks signup. */
const trySendVerifyEmail = async (req: Request, user: { id: string; email: string; emailVerifiedAt: string | null }) => {
  if (user.emailVerifiedAt) return
  try {
    const db = await getDbAsync()
    const created = await createEmailToken(db, {
      userId: user.id,
      email: user.email,
      purpose: 'verify_email',
      ttlMs: 1000 * 60 * 60 * 24,
    })
    const verifyUrl = `${appBaseUrl(req)}/verify-email?token=${encodeURIComponent(created.token)}`
    await sendTransactionalEmail({
      to: user.email,
      subject: 'Verify your Musashi email',
      html: `<p>Confirm your email address:</p><p><a href="${verifyUrl}">Verify email</a></p>`,
      text: `Verify your Musashi email: ${verifyUrl}`,
      actionUrl: verifyUrl,
    })
  } catch {
    // EMAIL_NOT_CONFIGURED or token errors — user can resend from Profile
  }
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
    await trySendVerifyEmail(req, user)

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
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
