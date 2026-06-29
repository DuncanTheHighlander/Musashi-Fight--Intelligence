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
})
