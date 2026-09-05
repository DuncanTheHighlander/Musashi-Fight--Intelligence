import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

describe('cloudflare worker deploy wiring', () => {
  test('worker wrapper exports scheduled handler for marketplace cron', () => {
    const src = readFileSync(join(process.cwd(), 'src/cloudflare-worker.ts'), 'utf8')
    expect(src).toContain('async scheduled')
    expect(src).toContain('runMarketplaceCron')
  })

  test('production bundle deploy uses the worker wrapper entry', () => {
    const toml = readFileSync(join(process.cwd(), 'wrangler.bundle.toml'), 'utf8')
    expect(toml).toMatch(/main\s*=\s*"src\/cloudflare-worker\.ts"/)
  })
})
