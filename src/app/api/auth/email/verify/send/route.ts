import { NextResponse } from 'next/server'
import { createEmailToken } from '@/lib/auth/emailTokens'
import { emailDryRunClientPayload, sendTransactionalEmail } from '@/lib/email/emailClient'
import { getDb } from '@/lib/db'
import { requireUser } from '@/lib/musashiAuth'

const appBaseUrl = (req: Request): string =>
  process.env.MUSASHI_APP_URL?.replace(/\/$/, '') || new URL(req.url).origin

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    if (user.emailVerifiedAt) {
      return NextResponse.json({ ok: true, alreadyVerified: true })
    }

    const db = getDb()
    const created = await createEmailToken(db, {
      userId: user.id,
      email: user.email,
      purpose: 'verify_email',
      ttlMs: 1000 * 60 * 60 * 24,
    })

    const verifyUrl = `${appBaseUrl(req)}/verify-email?token=${encodeURIComponent(created.token)}`
    const emailResult = await sendTransactionalEmail({
      to: user.email,
      subject: 'Verify your Musashi email',
      html: `<p>Confirm your email address:</p><p><a href="${verifyUrl}">Verify email</a></p>`,
      text: `Verify your Musashi email: ${verifyUrl}`,
      actionUrl: verifyUrl,
    })

    const dryRunPayload = emailDryRunClientPayload(emailResult)
    if ('dryRun' in dryRunPayload) {
      return NextResponse.json({ ok: true, ...dryRunPayload })
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    if (msg === 'UNAUTHORIZED') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (msg === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (msg === 'EMAIL_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'Email service not configured' }, { status: 501 })
    }
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
