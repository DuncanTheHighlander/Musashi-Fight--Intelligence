import type { D1Database } from './types'
import { ensureAnalystProfile } from './jobs'
import { stripeFormRequest } from '@/lib/stripe/stripeClient'

export type ConnectOnboardingResult = {
  accountId: string
  onboardingUrl: string
  stripePayoutsEnabled: boolean
}

export type ConnectRefreshResult = {
  accountId: string
  stripePayoutsEnabled: boolean
  stripeOnboardingCompletedAt: string | null
}

type StripeAccount = {
  id?: string
  capabilities?: { transfers?: string }
  payouts_enabled?: boolean
}

const transfersActive = (account: StripeAccount): boolean =>
  String(account?.capabilities?.transfers || '').toLowerCase() === 'active' ||
  Boolean(account?.payouts_enabled)

export async function createOrRefreshConnectAccount(
  db: D1Database,
  args: { userId: string; email: string; returnUrl: string; refreshUrl: string },
): Promise<ConnectOnboardingResult> {
  const profile = await ensureAnalystProfile(db, args.userId)
  let accountId = profile.stripe_connect_id

  if (!accountId) {
    const account = await stripeFormRequest<StripeAccount>('/v1/accounts', {
      body: {
        type: 'express',
        email: args.email,
        'capabilities[transfers][requested]': 'true',
        'metadata[musashi_user_id]': args.userId,
      },
      idempotencyKey: `connect_account_${args.userId}`,
    })
    accountId = String(account.id || '')
    if (!accountId) throw new Error('Stripe did not return an account id')
    await db
      .prepare('UPDATE analyst_profiles SET stripe_connect_id = ?, updated_at = ? WHERE user_id = ?')
      .bind(accountId, new Date().toISOString(), args.userId)
      .run()
  }

  const link = await stripeFormRequest<{ url?: string }>('/v1/account_links', {
    body: {
      account: accountId,
      type: 'account_onboarding',
      return_url: args.returnUrl,
      refresh_url: args.refreshUrl,
    },
    idempotencyKey: `connect_onboarding_${args.userId}_${Date.now()}`,
  })
  const onboardingUrl = String(link.url || '')
  if (!onboardingUrl) throw new Error('Stripe did not return an onboarding URL')

  return {
    accountId,
    onboardingUrl,
    stripePayoutsEnabled: Boolean(profile.stripe_payouts_enabled),
  }
}

export async function refreshConnectPayoutStatus(
  db: D1Database,
  userId: string,
): Promise<ConnectRefreshResult> {
  const profile = await ensureAnalystProfile(db, userId)
  const accountId = profile.stripe_connect_id
  if (!accountId) throw new Error('CONNECT_ACCOUNT_MISSING')

  const account = await stripeFormRequest<StripeAccount>(`/v1/accounts/${accountId}`, {
    method: 'GET',
  })
  return applyConnectAccountStatus(db, userId, accountId, transfersActive(account), profile)
}

export async function refreshConnectPayoutStatusByAccountId(
  db: D1Database,
  accountId: string,
): Promise<ConnectRefreshResult | null> {
  const row = await db
    .prepare('SELECT user_id, stripe_onboarding_completed_at FROM analyst_profiles WHERE stripe_connect_id = ?')
    .bind(accountId)
    .first<{ user_id: string; stripe_onboarding_completed_at: string | null }>()
  if (!row) return null

  const account = await stripeFormRequest<StripeAccount>(`/v1/accounts/${accountId}`, {
    method: 'GET',
  })
  return applyConnectAccountStatus(db, row.user_id, accountId, transfersActive(account), {
    stripe_onboarding_completed_at: row.stripe_onboarding_completed_at,
  })
}

async function applyConnectAccountStatus(
  db: D1Database,
  userId: string,
  accountId: string,
  enabled: boolean,
  profile: { stripe_onboarding_completed_at: string | null },
): Promise<ConnectRefreshResult> {
  const now = new Date().toISOString()
  const completedAt = enabled
    ? profile.stripe_onboarding_completed_at || now
    : profile.stripe_onboarding_completed_at
  await db
    .prepare(
      `UPDATE analyst_profiles
          SET stripe_payouts_enabled = ?,
              stripe_onboarding_completed_at = ?,
              updated_at = ?
        WHERE user_id = ?`,
    )
    .bind(enabled ? 1 : 0, completedAt, now, userId)
    .run()
  return {
    accountId,
    stripePayoutsEnabled: enabled,
    stripeOnboardingCompletedAt: completedAt,
  }
}
