import { NextResponse } from 'next/server'
import { createEmailToken } from '@/lib/auth/emailTokens'
import { emailDryRunClientPayload, sendTransactionalEmail } from '@/lib/email/emailClient'
import { getDb } from '@/lib/db'
import { requireUser, revokeAllUserSessions } from '@/lib/musashiAuth'
import { writeAdminAudit } from '@/lib/adminRuntime'
import { getAdminUser, grantBonusCredits } from '@/lib/adminUsers'
import { POLICY_VERSION } from '@/lib/policyVersion'

type ActionBody = {
  action?: string
  reason?: string
  notes?: string
  days?: number
  credits?: number
  consent?: boolean
}

const appBaseUrl = (req: Request): string =>
  process.env.MUSASHI_APP_URL?.replace(/\/$/, '') || new URL(req.url).origin

export async function GET(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  try {
    await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await ctx.params
  const user = await getAdminUser(userId)
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
  return NextResponse.json({ user })
}

export async function POST(req: Request, ctx: { params: Promise<{ userId: string }> }) {
  let admin
  try {
    admin = await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { userId } = await ctx.params
  const body = (await req.json().catch(() => ({}))) as ActionBody
  const action = String(body?.action || '').trim()
  const reason = String(body?.reason || '').trim()
  const db = getDb()
  const now = new Date().toISOString()

  const before = await getAdminUser(userId)
  if (!before) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  try {
    switch (action) {
      case 'verify_email': {
        await db
          .prepare('UPDATE musashi_users SET email_verified_at = ?, updated_at = ? WHERE id = ?')
          .bind(now, now, userId)
          .run()
        break
      }
      case 'send_password_reset': {
        const created = await createEmailToken(db, {
          userId,
          email: before.email,
          purpose: 'password_reset',
          ttlMs: 1000 * 60 * 60,
        })
        const resetUrl = `${appBaseUrl(req)}/reset-password?token=${encodeURIComponent(created.token)}`
        const emailResult = await sendTransactionalEmail({
          to: before.email,
          subject: 'Reset your Musashi password',
          html: `<p>An admin requested a password reset for your account:</p><p><a href="${resetUrl}">Reset password</a></p>`,
          text: `Reset your Musashi password: ${resetUrl}`,
          actionUrl: resetUrl,
        })
        const dry = emailDryRunClientPayload(emailResult)
        await writeAdminAudit({
          adminUserId: admin.id,
          action: 'users.send_password_reset',
          targetType: 'user',
          targetId: userId,
          reason: reason || null,
          before,
          after: { emailed: true },
        })
        return NextResponse.json({ ok: true, user: await getAdminUser(userId), ...('dryRun' in dry ? dry : {}) })
      }
      case 'grant_comp_pro': {
        if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 })
        const days = Math.min(365, Math.max(1, Number(body.days) || 30))
        const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        await db
          .prepare('UPDATE musashi_users SET comp_pro_until = ?, updated_at = ? WHERE id = ?')
          .bind(until, now, userId)
          .run()
        break
      }
      case 'revoke_comp_pro': {
        if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 })
        await db
          .prepare('UPDATE musashi_users SET comp_pro_until = NULL, updated_at = ? WHERE id = ?')
          .bind(now, userId)
          .run()
        break
      }
      case 'add_credits': {
        const credits = Math.min(100, Math.max(1, Number(body.credits) || 10))
        await grantBonusCredits(userId, credits)
        break
      }
      case 'suspend': {
        if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 })
        await db
          .prepare(
            `UPDATE musashi_users SET account_status = 'suspended', status_reason = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(reason, now, userId)
          .run()
        await revokeAllUserSessions(userId)
        break
      }
      case 'ban': {
        if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 })
        await db
          .prepare(
            `UPDATE musashi_users SET account_status = 'banned', status_reason = ?, updated_at = ? WHERE id = ?`,
          )
          .bind(reason, now, userId)
          .run()
        await revokeAllUserSessions(userId)
        break
      }
      case 'restore': {
        await db
          .prepare(
            `UPDATE musashi_users SET account_status = 'active', status_reason = NULL, updated_at = ? WHERE id = ?`,
          )
          .bind(now, userId)
          .run()
        break
      }
      case 'set_notes': {
        const notes = String(body.notes || '').slice(0, 4000)
        await db
          .prepare('UPDATE musashi_users SET support_notes = ?, updated_at = ? WHERE id = ?')
          .bind(notes || null, now, userId)
          .run()
        break
      }
      case 'mark_consent': {
        if (!reason) return NextResponse.json({ error: 'Reason required' }, { status: 400 })
        const consent = body.consent !== false
        await db
          .prepare(
            `UPDATE musashi_users
             SET consent_ai_training = ?, consent_tos_version = ?, consent_privacy_version = ?, consent_at = ?, updated_at = ?
             WHERE id = ?`,
          )
          .bind(consent ? 1 : 0, POLICY_VERSION, POLICY_VERSION, now, now, userId)
          .run()
        break
      }
      case 'revoke_sessions': {
        await revokeAllUserSessions(userId)
        break
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    const after = await getAdminUser(userId)
    await writeAdminAudit({
      adminUserId: admin.id,
      action: `users.${action}`,
      targetType: 'user',
      targetId: userId,
      reason: reason || null,
      before,
      after,
    })
    return NextResponse.json({ ok: true, user: after })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Action failed'
    await writeAdminAudit({
      adminUserId: admin.id,
      action: `users.${action}`,
      targetType: 'user',
      targetId: userId,
      reason: reason || null,
      before,
      result: `error:${msg}`,
    })
    if (msg === 'EMAIL_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'Email service not configured' }, { status: 501 })
    }
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}
