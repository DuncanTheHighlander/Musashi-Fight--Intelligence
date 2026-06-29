import { afterEach, describe, expect, test, vi } from 'vitest'
import { emailDryRunClientPayload } from '@/lib/email/emailClient'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('emailDryRunClientPayload', () => {
  test('returns url in non-production dry-run responses', () => {
    vi.stubEnv('NODE_ENV', 'development')

    const payload = emailDryRunClientPayload({
      dryRun: true,
      url: 'http://localhost:3000/reset-password?token=abc',
    })

    expect(payload).toEqual({
      dryRun: true,
      url: 'http://localhost:3000/reset-password?token=abc',
    })
  })

  test('strips url from dry-run responses in production', () => {
    vi.stubEnv('NODE_ENV', 'production')

    const payload = emailDryRunClientPayload({
      dryRun: true,
      url: 'https://app.musashi.ai/reset-password?token=secret',
    })

    expect(payload).toEqual({ dryRun: true })
    expect(payload).not.toHaveProperty('url')
  })

  test('returns empty object when email was sent', () => {
    expect(emailDryRunClientPayload({ sent: true })).toEqual({})
  })
})
