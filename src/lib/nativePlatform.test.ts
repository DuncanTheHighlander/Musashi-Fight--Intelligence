import { afterEach, describe, expect, it, vi } from 'vitest'
import { getNativePlatform, isIosNativeApp } from './nativePlatform'

describe('nativePlatform', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null when there is no window (SSR)', () => {
    expect(getNativePlatform()).toBeNull()
    expect(isIosNativeApp()).toBe(false)
  })

  it('returns null in a plain browser without the Capacitor bridge', () => {
    vi.stubGlobal('window', {})
    expect(getNativePlatform()).toBeNull()
    expect(isIosNativeApp()).toBe(false)
  })

  it('detects the iOS shell', () => {
    vi.stubGlobal('window', { Capacitor: { getPlatform: () => 'ios' } })
    expect(getNativePlatform()).toBe('ios')
    expect(isIosNativeApp()).toBe(true)
  })

  it('detects the Android shell without flagging it as iOS', () => {
    vi.stubGlobal('window', { Capacitor: { getPlatform: () => 'android' } })
    expect(getNativePlatform()).toBe('android')
    expect(isIosNativeApp()).toBe(false)
  })

  it('ignores Capacitor "web" platform (PWA in mobile Safari/Chrome)', () => {
    vi.stubGlobal('window', { Capacitor: { getPlatform: () => 'web' } })
    expect(getNativePlatform()).toBeNull()
    expect(isIosNativeApp()).toBe(false)
  })
})
