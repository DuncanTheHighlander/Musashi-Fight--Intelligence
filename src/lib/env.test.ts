import { afterEach, describe, expect, test } from 'vitest'
import { validateEnv } from '@/lib/env'

const ORIGINAL_ENV = { ...process.env }

function setEnv(key: string, value: string | undefined) {
  const env = process.env as Record<string, string | undefined>
  if (value === undefined) {
    delete env[key]
  } else {
    env[key] = value
  }
}

function setProdEnv(overrides: Record<string, string | undefined> = {}) {
  setEnv('NODE_ENV', 'production')
  setEnv('GEMINI_API_KEY', 'AIza' + 'x'.repeat(36))
  setEnv('MUSASHI_SESSION_SECRET', 'strong-session-secret-' + 'x'.repeat(48))
  setEnv('MUSASHI_SHOGUN_EMAIL', 'shogun@musashi.ai')
  setEnv('MUSASHI_SHOGUN_PASSWORD', 'strong-admin-password-' + 'x'.repeat(32))
  setEnv('STRIPE_SECRET_KEY', 'sk_live_' + 'x'.repeat(24))

  for (const [key, value] of Object.entries(overrides)) {
    setEnv(key, value)
  }
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('validateEnv', () => {
  test('rejects placeholder required credentials in production', () => {
    setProdEnv({ GEMINI_API_KEY: 'your-gemini-api-key-here' })

    const result = validateEnv()

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required env var: GEMINI_API_KEY')
  })

  test('rejects MUSASHI_DISABLE_AUTH in production', () => {
    setProdEnv({ MUSASHI_DISABLE_AUTH: '1' })

    const result = validateEnv()

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('MUSASHI_DISABLE_AUTH=1 must NOT be set in production. Remove it.')
  })

  test('rejects the default shogun password in production', () => {
    setProdEnv({ MUSASHI_SHOGUN_PASSWORD: 'ChangeThisSecurePassword123!@#' })

    const result = validateEnv()

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('MUSASHI_SHOGUN_PASSWORD appears to use a weak/default value. Change it for production.')
  })

  test('warns when payments/storage are mock in production', () => {
    setProdEnv({
      MUSASHI_MARKETPLACE_PAYMENTS: 'mock',
      MUSASHI_STORAGE_MODE: 'mock',
    })

    const result = validateEnv()

    expect(result.valid).toBe(true)
    expect(result.warnings.some((w) => w.includes('MUSASHI_MARKETPLACE_PAYMENTS'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('MUSASHI_STORAGE_MODE'))).toBe(true)
  })

  test('warns on placeholder EMAIL_API_KEY and missing cron secret in production', () => {
    setProdEnv({
      EMAIL_API_KEY: 're_your_email_api_key',
      MUSASHI_CRON_SECRET: undefined,
    })

    const result = validateEnv()

    expect(result.warnings.some((w) => w.includes('EMAIL_API_KEY'))).toBe(true)
    expect(result.warnings.some((w) => w.includes('MUSASHI_CRON_SECRET'))).toBe(true)
  })

  test('does not warn when production email, cron, and storage secrets are real', () => {
    setProdEnv({
      MUSASHI_MARKETPLACE_PAYMENTS: 'stripe',
      MUSASHI_STORAGE_MODE: 'r2',
      STORAGE_SERVICE_URL: 'https://acct.r2.cloudflarestorage.com',
      STORAGE_ACCESS_KEY: 'a'.repeat(32),
      STORAGE_SECRET_KEY: 'b'.repeat(64),
      STORAGE_BUCKET_NAME: 'musashi-uploads',
      EMAIL_API_KEY: 're_' + 'k'.repeat(24),
      MUSASHI_CRON_SECRET: 'c'.repeat(64),
      STRIPE_WEBHOOK_SECRET: 'whsec_' + 'd'.repeat(32),
    })

    const result = validateEnv()

    expect(result.valid).toBe(true)
    expect(result.warnings).toEqual([])
  })
})
