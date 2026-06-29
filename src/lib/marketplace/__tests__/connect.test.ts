import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMockD1 } from '../mockD1'
import { ensureAnalystProfile } from '../jobs'
import { createOrRefreshConnectAccount, refreshConnectPayoutStatus } from '../connect'

describe('Connect onboarding', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('creates account and stores onboarding link', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    vi.stubEnv('MUSASHI_APP_URL', 'https://musashi.test')
    const db = createMockD1()
    await ensureAnalystProfile(db, 'dev')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).endsWith('/v1/accounts')) {
          return Response.json({ id: 'acct_123', capabilities: { transfers: 'inactive' } })
        }
        return Response.json({ url: 'https://connect.stripe.test/onboard' })
      }),
    )

    const result = await createOrRefreshConnectAccount(db, {
      userId: 'dev',
      email: 'dev@example.test',
      returnUrl: 'https://musashi.test/marketplace/settings?connect=return',
      refreshUrl: 'https://musashi.test/marketplace/settings?connect=refresh',
    })

    expect(result.onboardingUrl).toBe('https://connect.stripe.test/onboard')
    const row = await db
      .prepare('SELECT stripe_connect_id FROM analyst_profiles WHERE user_id = ?')
      .bind('dev')
      .first<{ stripe_connect_id: string }>()
    expect(row?.stripe_connect_id).toBe('acct_123')
  })

  test('refresh marks payouts enabled when transfers capability is active', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    const db = createMockD1()
    await ensureAnalystProfile(db, 'dev')
    await db
      .prepare('UPDATE analyst_profiles SET stripe_connect_id = ? WHERE user_id = ?')
      .bind('acct_123', 'dev')
      .run()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ id: 'acct_123', capabilities: { transfers: 'active' } })),
    )

    const result = await refreshConnectPayoutStatus(db, 'dev')
    expect(result.stripePayoutsEnabled).toBe(true)
  })
})
