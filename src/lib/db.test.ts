import { beforeEach, describe, expect, test, vi } from 'vitest'

const cloudflareDb = {
  prepare: vi.fn(),
}
let syncContextAvailable = true

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: (options?: { async?: boolean }) => {
    if (!options?.async && !syncContextAvailable) {
      throw new Error('sync context unavailable')
    }
    return {
      env: {
        DB: cloudflareDb,
      },
    }
  },
}))

describe('getDb', () => {
  beforeEach(() => {
    delete (process.env as { DB?: unknown }).DB
    cloudflareDb.prepare.mockReset()
    syncContextAvailable = true
    vi.resetModules()
  })

  test('uses the OpenNext Cloudflare DB binding when process.env.DB is absent', async () => {
    const { getDb } = await import('./db')

    expect(getDb()).toBe(cloudflareDb)
  })

  test('uses the async OpenNext Cloudflare DB binding when sync context is unavailable', async () => {
    syncContextAvailable = false
    const { getDbAsync } = await import('./db')

    await expect(getDbAsync()).resolves.toBe(cloudflareDb)
  })
})
