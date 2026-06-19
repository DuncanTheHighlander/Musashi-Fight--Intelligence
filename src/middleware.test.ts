import { describe, it, expect } from 'vitest'
import { isPublicPath, isAuthRateBucket } from './middleware-helpers'

describe('middleware decisions', () => {
  it('treats /api/auth/logout as public so expired sessions can still log out', () => {
    expect(isPublicPath('/api/auth/logout')).toBe(true)
  })

  it('keeps /api/auth/login and /api/auth/register public', () => {
    expect(isPublicPath('/api/auth/login')).toBe(true)
    expect(isPublicPath('/api/auth/register')).toBe(true)
  })

  it('treats /terms and /privacy as public', () => {
    expect(isPublicPath('/terms')).toBe(true)
    expect(isPublicPath('/privacy')).toBe(true)
  })

  it('does NOT count /api/auth/me against the auth rate bucket', () => {
    expect(isAuthRateBucket('/api/auth/me')).toBe(false)
  })

  it('DOES count login/register/logout against the auth rate bucket', () => {
    expect(isAuthRateBucket('/api/auth/login')).toBe(true)
    expect(isAuthRateBucket('/api/auth/register')).toBe(true)
    expect(isAuthRateBucket('/api/auth/logout')).toBe(true)
  })

  it('does not count generic api endpoints in the auth bucket', () => {
    expect(isAuthRateBucket('/api/fight/analyze')).toBe(false)
    expect(isAuthRateBucket('/api/social/profiles')).toBe(false)
  })
})
