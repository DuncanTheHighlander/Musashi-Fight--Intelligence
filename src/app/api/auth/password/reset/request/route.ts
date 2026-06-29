import { NextResponse } from 'next/server'
import { createEmailToken } from '@/lib/auth/emailTokens'
import { emailDryRunClientPayload, sendTransactionalEmail } from '@/lib/email/emailClient'
import { getDb } from '@/lib/db'

type ResetRequestBody = { email?: string }

const appBaseUrl = (req: Request): string =>
  process.env.MUSASHI_APP_URL?.replace(/\/$/, '') || new URL(req.url).origin

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ResetRequestBody
    const email = String(body?.email || '').trim().toLowerCase()

    if (email && email.includes('@')) {
      const db = getDb()
      const row = await db.prepare('SELECT id, email FROM musashi_users WHERE email = ?').bind(email).first<{
        id: string
        email: string
      }>()

      if (row?.id) {
        const created = await createEmailToken(db, {
          userId: String(row.id),
          email: String(row.email),
          purpose: 'password_reset',
          ttlMs: 1000 * 60 * 60,
        })

        const resetUrl = `${appBaseUrl(req)}/reset-password?token=${encodeURIComponent(created.token)}`
        try {
          const emailResult = await sendTransactionalEmail({
            to: String(row.email),
            subject: 'Reset your Musashi password',
            html: `<p>Reset your password:</p><p><a href="${resetUrl}">Reset password</a></p>`,
            text: `Reset your Musashi password: ${resetUrl}`,
            actionUrl: resetUrl,
          })

          const dryRunPayload = emailDryRunClientPayload(emailResult)
          if ('dryRun' in dryRunPayload) {
            return NextResponse.json({ ok: true, ...dryRunPayload })
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'Unknown error'
          if (msg === 'EMAIL_NOT_CONFIGURED') {
            return NextResponse.json({ error: 'Email service not configured' }, { status: 501 })
          }
          throw e
        }
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
