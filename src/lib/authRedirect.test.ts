import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resolvePostAuthPath } from './authRedirect'

describe('resolvePostAuthPath', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends incomplete users to onboarding', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ complete: false, redirectTo: '/onboarding' }), { status: 200 }),
    )
    await expect(resolvePostAuthPath('/marketplace')).resolves.toBe('/onboarding')
  })

  it('returns fallback for complete users', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ complete: true, redirectTo: '/' }), { status: 200 }),
    )
    await expect(resolvePostAuthPath('/marketplace')).resolves.toBe('/marketplace')
  })

  it('maps auth front-door fallbacks to home when complete', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ complete: true }), { status: 200 }),
    )
    await expect(resolvePostAuthPath('/welcome')).resolves.toBe('/')
  })
})
