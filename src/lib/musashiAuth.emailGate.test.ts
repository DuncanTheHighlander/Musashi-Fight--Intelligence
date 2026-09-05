import { describe, expect, it, afterEach, vi } from 'vitest'
import {
  assertEmailVerified,
  isEmailVerificationRequired,
  type MusashiUser,
} from '@/lib/musashiAuth'

const baseUser = (over: Partial<MusashiUser> = {}): MusashiUser => ({
  id: 'u1',
  email: 'a@b.com',
  display_name: 'A',
  role: 'user',
  emailVerifiedAt: null,
  passwordUpdatedAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...over,
})

describe('email verification gate', () => {
  const prevReq = process.env.MUSASHI_REQUIRE_EMAIL_VERIFIED
  const prevDisable = process.env.MUSASHI_DISABLE_AUTH

  afterEach(() => {
    vi.unstubAllEnvs()
    if (prevReq === undefined) delete process.env.MUSASHI_REQUIRE_EMAIL_VERIFIED
    else process.env.MUSASHI_REQUIRE_EMAIL_VERIFIED = prevReq
    if (prevDisable === undefined) delete process.env.MUSASHI_DISABLE_AUTH
    else process.env.MUSASHI_DISABLE_AUTH = prevDisable
  })

  it('can be forced on via MUSASHI_REQUIRE_EMAIL_VERIFIED=1', () => {
    process.env.MUSASHI_REQUIRE_EMAIL_VERIFIED = '1'
    delete process.env.MUSASHI_DISABLE_AUTH
    expect(isEmailVerificationRequired()).toBe(true)
  })

  it('can be forced off via MUSASHI_REQUIRE_EMAIL_VERIFIED=0', () => {
    process.env.MUSASHI_REQUIRE_EMAIL_VERIFIED = '0'
    expect(isEmailVerificationRequired()).toBe(false)
  })

  it('blocks unverified users when required', () => {
    process.env.MUSASHI_REQUIRE_EMAIL_VERIFIED = '1'
    expect(() => assertEmailVerified(baseUser())).toThrow('EMAIL_NOT_VERIFIED')
  })

  it('allows verified users and shogun when required', () => {
    process.env.MUSASHI_REQUIRE_EMAIL_VERIFIED = '1'
    expect(() => assertEmailVerified(baseUser({ emailVerifiedAt: new Date().toISOString() }))).not.toThrow()
    expect(() => assertEmailVerified(baseUser({ role: 'shogun' }))).not.toThrow()
  })

  it('does not block when requirement is off', () => {
    process.env.MUSASHI_REQUIRE_EMAIL_VERIFIED = '0'
    expect(() => assertEmailVerified(baseUser())).not.toThrow()
  })

  it('only enables the production default when email delivery is configured', () => {
    delete process.env.MUSASHI_REQUIRE_EMAIL_VERIFIED
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('EMAIL_API_KEY', '')
    vi.stubEnv('EMAIL_FROM_ADDRESS', '')
    vi.stubEnv('EMAIL_SERVICE_URL', '')
    expect(isEmailVerificationRequired()).toBe(false)

    vi.stubEnv('EMAIL_API_KEY', 're_live_configured')
    expect(isEmailVerificationRequired()).toBe(true)

    // Secrets Store path: key is async, but from+service vars mean provider is wired
    vi.stubEnv('EMAIL_API_KEY', '')
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'noreply@musashi.ai')
    vi.stubEnv('EMAIL_SERVICE_URL', 'https://api.resend.com')
    expect(isEmailVerificationRequired()).toBe(true)
  })
})
