import { describe, expect, it } from 'vitest'
import { assertPublicHttpUrl } from './urlAllowlist'

describe('assertPublicHttpUrl', () => {
  it('allows same-origin upload URLs', () => {
    const url = assertPublicHttpUrl('https://app.example.com/api/uploads/abc/content', {
      requestOrigin: 'https://app.example.com',
    })
    expect(url.pathname).toBe('/api/uploads/abc/content')
  })

  it('allows hosts from MUSASHI_SAM3_ALLOWED_HOSTS', () => {
    process.env.MUSASHI_SAM3_ALLOWED_HOSTS = 'cdn.example.com'
    try {
      const url = assertPublicHttpUrl('https://cdn.example.com/clips/fight.mp4', {
        requestOrigin: 'https://app.example.com',
      })
      expect(url.hostname).toBe('cdn.example.com')
    } finally {
      delete process.env.MUSASHI_SAM3_ALLOWED_HOSTS
    }
  })

  it('blocks private and loopback hosts', () => {
    expect(() => assertPublicHttpUrl('http://127.0.0.1/video.mp4')).toThrow('VIDEO_URL_NOT_ALLOWED')
    expect(() => assertPublicHttpUrl('http://192.168.1.10/v.mp4')).toThrow('VIDEO_URL_NOT_ALLOWED')
    expect(() => assertPublicHttpUrl('http://localhost/v.mp4')).toThrow('VIDEO_URL_NOT_ALLOWED')
  })

  it('blocks off-origin hosts when origin is provided', () => {
    expect(() =>
      assertPublicHttpUrl('https://evil.example/video.mp4', {
        requestOrigin: 'https://app.example.com',
      })
    ).toThrow('VIDEO_URL_NOT_ALLOWED')
  })
})
