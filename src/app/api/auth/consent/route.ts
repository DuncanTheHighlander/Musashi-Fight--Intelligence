/**
 * /api/auth/consent — read/set the current user's AI-improvement data-use
 * consent. See docs/PRIVACY_CONSENT_SPEC.md. Onboarding calls POST once;
 * Profile lets the user view/withdraw via the same endpoint.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'
import { POLICY_VERSION } from '@/lib/policyVersion'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)
    const db = getDb()
    const row = await db
      .prepare(
        `SELECT consent_ai_training, consent_tos_version, consent_privacy_version, consent_at
         FROM musashi_users WHERE id = ?`,
      )
      .bind(user.id)
      .first<{
        consent_ai_training: number
        consent_tos_version: string | null
        consent_privacy_version: string | null
        consent_at: string | null
      }>()

    return NextResponse.json({
      aiTraining: Boolean(row?.consent_ai_training),
      policyVersion: row?.consent_privacy_version ?? null,
      consentedAt: row?.consent_at ?? null,
      currentPolicyVersion: POLICY_VERSION,
      needsReconsent: row?.consent_privacy_version !== POLICY_VERSION,
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Failed to load consent' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json().catch(() => ({}))) as { aiTraining?: unknown }
    const aiTraining = Boolean(body?.aiTraining)

    const db = getDb()
    const now = new Date().toISOString()
    await db
      .prepare(
        `UPDATE musashi_users
         SET consent_ai_training = ?, consent_tos_version = ?, consent_privacy_version = ?, consent_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(aiTraining ? 1 : 0, POLICY_VERSION, POLICY_VERSION, now, now, user.id)
      .run()

    return NextResponse.json({ aiTraining, policyVersion: POLICY_VERSION, consentedAt: now })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Failed to save consent' }, { status: 500 })
  }
}
