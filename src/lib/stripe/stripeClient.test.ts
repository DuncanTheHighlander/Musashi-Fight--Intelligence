import { afterEach, describe, expect, test, vi } from 'vitest'
import { stripeFormRequest } from './stripeClient'

describe('stripeFormRequest', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('sends form encoded Stripe request with API version and idempotency', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_url)).toBe('https://api.stripe.com/v1/transfers')
      expect(init?.method).toBe('POST')
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer sk_test_123')
      expect(headers['Stripe-Version']).toBeTruthy()
      expect(headers['Idempotency-Key']).toBe('job_1_payout')
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(String(init?.body)).toContain('amount=1200')
      return new Response(JSON.stringify({ id: 'tr_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      stripeFormRequest('/v1/transfers', {
        body: { amount: '1200' },
        idempotencyKey: 'job_1_payout',
      }),
    ).resolves.toEqual({ id: 'tr_123' })
  })

  test('throws configured error without leaking secret key', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    await expect(stripeFormRequest('/v1/transfers', { body: {} })).rejects.toThrow(
      'STRIPE_NOT_CONFIGURED',
    )
  })
})
