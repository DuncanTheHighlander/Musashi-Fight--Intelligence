import { describe, expect, it, vi, afterEach } from 'vitest'
import { dedupeInflight, __resetInflightForTests } from '@/lib/ai/clientInflight'
import { fetchAndParseApiResponse } from '@/lib/safeJson'

describe('fetchAndParseApiResponse', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns parsed ok payload', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ success: true, coaching: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    const result = await fetchAndParseApiResponse<{ success: boolean }>('/api/fight/analyze', {
      method: 'POST',
    })
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') {
      expect(result.data.success).toBe(true)
    }
  })

  it('returns guard payload without throwing on 429', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ code: 'RATE_LIMITED' }), {
          status: 429,
          headers: { 'Content-Type': 'application/json', 'Retry-After': '30' },
        }),
      ),
    )

    const result = await fetchAndParseApiResponse('/api/fight/analyze')
    expect(result.kind).toBe('guard')
    if (result.kind === 'guard') {
      expect(result.status).toBe(429)
      expect(result.retryAfter).toBe(30)
    }
  })
})

describe('dedupeInflight + fetchAndParseApiResponse', () => {
  afterEach(() => {
    __resetInflightForTests()
    vi.unstubAllGlobals()
  })

  it('allows concurrent callers to share one parsed result', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ledger: { events: [] } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const factory = () => fetchAndParseApiResponse<{ ledger: { events: unknown[] } }>('/api/fight/analyze')

    const p1 = dedupeInflight('analyze-key', factory)
    const p2 = dedupeInflight('analyze-key', factory)

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.kind).toBe('ok')
    expect(r2.kind).toBe('ok')
    if (r1.kind === 'ok' && r2.kind === 'ok') {
      expect(r1.data).toBe(r2.data)
    }
  })
})
