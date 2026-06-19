import { describe, it, expect, vi } from 'vitest'
import { dedupeInflight, fingerprintSlice, __resetInflightForTests } from './clientInflight'

describe('dedupeInflight', () => {
  it('shares one promise across concurrent callers and re-runs after settlement', async () => {
    __resetInflightForTests()

    let resolveInner: ((v: number) => void) | null = null
    const factory = vi.fn(
      () =>
        new Promise<number>((res) => {
          resolveInner = res
        })
    )

    const p1 = dedupeInflight('k', factory)
    const p2 = dedupeInflight('k', factory)
    expect(factory).toHaveBeenCalledTimes(1)

    resolveInner!(7)
    expect(await p1).toBe(7)
    expect(await p2).toBe(7)

    // After settlement the next call should fire the factory again — this
    // module does in-flight dedupe only, not result caching.
    const factory2 = vi.fn(async () => 9)
    const p3 = await dedupeInflight('k', factory2)
    expect(p3).toBe(9)
    expect(factory2).toHaveBeenCalledTimes(1)
  })

  it('removes the in-flight entry even when the factory rejects', async () => {
    __resetInflightForTests()

    const failing = vi.fn(async () => {
      throw new Error('nope')
    })
    await expect(dedupeInflight('rej', failing)).rejects.toThrow('nope')

    const recovered = vi.fn(async () => 'ok')
    const result = await dedupeInflight('rej', recovered)
    expect(result).toBe('ok')
    expect(recovered).toHaveBeenCalledTimes(1)
  })
})

describe('fingerprintSlice', () => {
  it('is stable for identical inputs and varies with content', () => {
    const a = fingerprintSlice(['window', 12, 100, 1900, 15000, 0, ''])
    const b = fingerprintSlice(['window', 12, 100, 1900, 15000, 0, ''])
    const c = fingerprintSlice(['window', 12, 100, 1901, 15000, 0, ''])

    expect(a).toBe(b)
    expect(a).not.toBe(c)
    expect(a).toMatch(/^[0-9a-f]{8}$/)
  })

  it('handles nullish parts without throwing', () => {
    const fp = fingerprintSlice([null, undefined, '', 0])
    expect(fp).toMatch(/^[0-9a-f]{8}$/)
  })
})
