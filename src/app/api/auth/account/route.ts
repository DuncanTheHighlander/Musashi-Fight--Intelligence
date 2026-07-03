import { NextResponse } from 'next/server'
import {
  buildClearSessionCookieHeader,
  requireUser,
  revokeAllUserSessions,
  verifyPassword,
} from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'
import { requireStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'

// Escrow states where money is committed to a job — deletion is blocked until
// the job resolves (released, refunded, cancelled, or expired).
const ACTIVE_JOB_STATUSES = ['FUNDED', 'CLAIMED', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'DISPUTED'] as const

/** Best-effort: cancel any active Stripe subscriptions so a deleted account
 *  is never charged again. Never blocks deletion — Stripe may be unconfigured
 *  (local dev) or unreachable; the customer can still cancel via card issuer. */
const cancelStripeSubscriptions = async (userId: string): Promise<void> => {
  try {
    const secretKey = await requireStripeSecretKey()
    const db = getDb()
    const row = await db
      .prepare('SELECT stripe_customer_id FROM musashi_stripe_customers WHERE user_id = ?')
      .bind(userId)
      .first()
    const customerId = row?.stripe_customer_id ? String(row.stripe_customer_id) : ''
    if (!customerId) return

    const listResp = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(customerId)}&status=active&limit=100`,
      { headers: { Authorization: `Bearer ${secretKey}` } },
    )
    const listData = (await listResp.json()) as { data?: Array<{ id?: string }> }
    if (!listResp.ok) return

    for (const sub of listData?.data || []) {
      if (!sub?.id) continue
      await fetch(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(sub.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${secretKey}` },
      }).catch(() => undefined)
    }
  } catch {
    // Best-effort only.
  }
}

/**
 * DELETE /api/auth/account — permanently delete the signed-in user's account.
 *
 * Required by Apple App Store 5.1.1(v) and Google Play policy: apps that
 * support account creation must offer in-app account deletion.
 *
 * Deletes the musashi_users row (FKs cascade: sessions, usage, tokens,
 * messages, notifications, video limits, gym memberships). The legacy `users`
 * mirror row is anonymized instead of deleted so marketplace job history keeps
 * referential integrity without retaining PII.
 */
export async function DELETE(req: Request) {
  let user
  try {
    user = await requireUser(req)
  } catch {
    return NextResponse.json({ error: 'Login required' }, { status: 401 })
  }

  // Admin accounts are recreated on boot (ensureShogunUserExists) and gate
  // operational tooling — they cannot self-delete.
  if (user.role === 'shogun') {
    return NextResponse.json({ error: 'Admin accounts cannot be deleted from the app' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { password?: string }
  const password = String(body?.password || '')
  if (!password) {
    return NextResponse.json({ error: 'Password confirmation required' }, { status: 400 })
  }

  const db = getDb()
  const row = await db
    .prepare('SELECT password_hash FROM musashi_users WHERE id = ?')
    .bind(user.id)
    .first()
  const storedHash = row?.password_hash ? String(row.password_hash) : ''
  if (!storedHash || !(await verifyPassword(password, storedHash))) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 403 })
  }

  try {
    const placeholders = ACTIVE_JOB_STATUSES.map(() => '?').join(', ')
    const active = await db
      .prepare(
        `SELECT COUNT(*) AS n FROM marketplace_jobs
         WHERE (fighter_id = ? OR analyst_id = ?) AND status IN (${placeholders})`,
      )
      .bind(user.id, user.id, ...ACTIVE_JOB_STATUSES)
      .first()
    if (Number(active?.n || 0) > 0) {
      return NextResponse.json(
        { error: 'You have marketplace jobs with funds in escrow. Complete or cancel them before deleting your account.' },
        { status: 409 },
      )
    }
  } catch {
    // Marketplace tables absent (fresh local DB) — nothing in escrow to block on.
  }

  await cancelStripeSubscriptions(user.id)

  // Explicit revoke before the cascade so sessions die even where FK
  // enforcement is off (mock D1 in local dev).
  await revokeAllUserSessions(user.id)

  const anonEmail = `deleted+${user.id}@users.musashi.invalid`
  try {
    await db
      .prepare('UPDATE users SET email = ?, first_name = ?, last_name = ? WHERE id = ?')
      .bind(anonEmail, 'Deleted', 'User', user.id)
      .run()
  } catch {
    // Simplified legacy schema variant without name columns.
    try {
      await db.prepare('UPDATE users SET email = ? WHERE id = ?').bind(anonEmail, user.id).run()
    } catch {
      // No legacy users table at all.
    }
  }

  await db.prepare('DELETE FROM musashi_users WHERE id = ?').bind(user.id).run()

  return NextResponse.json(
    { ok: true },
    { status: 200, headers: { 'Set-Cookie': buildClearSessionCookieHeader() } },
  )
}
