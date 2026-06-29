import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from './route'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import { ensureAnalystProfile } from '@/lib/marketplace/jobs'
import type { D1Database } from '@/lib/db'

const enc = new TextEncoder()

const toHex = (bytes: Uint8Array): string => {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

const hmacSha256Hex = async (secret: string, payload: string): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return toHex(new Uint8Array(sig))
}

async function signedWebhookRequest(event: Record<string, unknown>, secret: string): Promise<Request> {
  const t = Math.floor(Date.now() / 1000)
  const rawBody = JSON.stringify(event)
  const signedPayload = `${t}.${rawBody}`
  const v1 = await hmacSha256Hex(secret, signedPayload)
  return new Request('http://localhost/api/billing/webhook', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'stripe-signature': `t=${t},v1=${v1}`,
    },
    body: rawBody,
  })
}

describe('POST /api/billing/webhook', () => {
  let db: D1Database

  beforeEach(async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_test')
    vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
    db = createMockD1()
    pinMockD1(db)
    await ensureAnalystProfile(db, 'dev')
    await db
      .prepare('UPDATE analyst_profiles SET stripe_connect_id = ? WHERE user_id = ?')
      .bind('acct_webhook', 'dev')
      .run()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    unpinMockD1()
  })

  it('rejects bad signature', async () => {
    const req = new Request('http://localhost/api/billing/webhook', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'stripe-signature': 't=123,v1=deadbeef',
      },
      body: JSON.stringify({ type: 'account.updated', data: { object: { id: 'acct_webhook' } } }),
    })

    const res = await POST(req)
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBe(400)
    expect(body.error).toMatch(/signature/i)
  })

  it('enables payouts when transfers capability is active', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ id: 'acct_webhook', capabilities: { transfers: 'active' } }),
      ),
    )

    const req = await signedWebhookRequest(
      {
        type: 'account.updated',
        data: { object: { id: 'acct_webhook', capabilities: { transfers: 'active' } } },
      },
      'whsec_test',
    )

    const res = await POST(req)
    expect(res.status).toBe(200)

    const row = await db
      .prepare('SELECT stripe_payouts_enabled, stripe_onboarding_completed_at FROM analyst_profiles WHERE user_id = ?')
      .bind('dev')
      .first<{ stripe_payouts_enabled: number; stripe_onboarding_completed_at: string | null }>()

    expect(row?.stripe_payouts_enabled).toBe(1)
    expect(row?.stripe_onboarding_completed_at).toBeTruthy()
  })

  it('disables payouts when transfers capability is inactive', async () => {
    await db
      .prepare(
        'UPDATE analyst_profiles SET stripe_payouts_enabled = 1, stripe_onboarding_completed_at = ? WHERE user_id = ?',
      )
      .bind(new Date().toISOString(), 'dev')
      .run()

    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({ id: 'acct_webhook', capabilities: { transfers: 'inactive' } }),
      ),
    )

    const req = await signedWebhookRequest(
      {
        type: 'account.updated',
        data: { object: { id: 'acct_webhook', capabilities: { transfers: 'inactive' } } },
      },
      'whsec_test',
    )

    const res = await POST(req)
    expect(res.status).toBe(200)

    const row = await db
      .prepare('SELECT stripe_payouts_enabled FROM analyst_profiles WHERE user_id = ?')
      .bind('dev')
      .first<{ stripe_payouts_enabled: number }>()

    expect(row?.stripe_payouts_enabled).toBe(0)
  })
})
