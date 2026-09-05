import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'
import type { D1Database } from '@/lib/db'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import { POLICY_VERSION } from '@/lib/policyVersion'

describe('GET/POST /api/auth/consent', () => {
  let db: D1Database

  beforeEach(() => {
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '1')
    vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
    db = createMockD1()
    pinMockD1(db)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    unpinMockD1()
  })

  it('GET defaults to no consent and needsReconsent true before any decision', async () => {
    const res = await GET(new Request('http://localhost/api/auth/consent'))
    const body = (await res.json()) as { aiTraining: boolean; needsReconsent: boolean }
    expect(res.status).toBe(200)
    expect(body.aiTraining).toBe(false)
    expect(body.needsReconsent).toBe(true)
  })

  it('POST records the decision and version; GET reflects it', async () => {
    const post = await POST(
      new Request('http://localhost/api/auth/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiTraining: true }),
      }),
    )
    expect(post.status).toBe(200)
    const postBody = (await post.json()) as { aiTraining: boolean; policyVersion: string }
    expect(postBody.aiTraining).toBe(true)
    expect(postBody.policyVersion).toBe(POLICY_VERSION)

    const res = await GET(new Request('http://localhost/api/auth/consent'))
    const body = (await res.json()) as { aiTraining: boolean; needsReconsent: boolean; policyVersion: string }
    expect(body.aiTraining).toBe(true)
    expect(body.policyVersion).toBe(POLICY_VERSION)
    expect(body.needsReconsent).toBe(false)
  })

  it('POST can record a decline (aiTraining: false) explicitly', async () => {
    await POST(
      new Request('http://localhost/api/auth/consent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiTraining: false }),
      }),
    )
    const res = await GET(new Request('http://localhost/api/auth/consent'))
    const body = (await res.json()) as { aiTraining: boolean; needsReconsent: boolean }
    expect(body.aiTraining).toBe(false)
    // A decision was still recorded (policy version stamped), so no re-prompt needed.
    expect(body.needsReconsent).toBe(false)
  })
})
