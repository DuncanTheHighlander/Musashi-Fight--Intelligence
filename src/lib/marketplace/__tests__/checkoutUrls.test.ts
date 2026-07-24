import { describe, expect, test } from 'vitest'
import { resolveSameOriginCheckoutUrl } from '../checkoutUrls'

describe('resolveSameOriginCheckoutUrl', () => {
  const req = new Request('https://app.musashi.ai/marketplace/jobs/job_1/fund')

  test('uses default path when candidate is missing', () => {
    expect(resolveSameOriginCheckoutUrl(req, null, '/marketplace/jobs/job_1?funding=success')).toBe(
      'https://app.musashi.ai/marketplace/jobs/job_1?funding=success',
    )
  })

  test('allows same-origin absolute URLs', () => {
    expect(
      resolveSameOriginCheckoutUrl(
        req,
        'https://app.musashi.ai/marketplace/jobs/job_1?funding=success',
        '/fallback',
      ),
    ).toBe('https://app.musashi.ai/marketplace/jobs/job_1?funding=success')
  })

  test('allows relative paths on the request origin', () => {
    expect(resolveSameOriginCheckoutUrl(req, '/done', '/fallback')).toBe('https://app.musashi.ai/done')
  })

  test('rejects external origins', () => {
    expect(
      resolveSameOriginCheckoutUrl(req, 'https://evil.example/phish', '/marketplace/jobs/job_1?funding=success'),
    ).toBe('https://app.musashi.ai/marketplace/jobs/job_1?funding=success')
  })
})
