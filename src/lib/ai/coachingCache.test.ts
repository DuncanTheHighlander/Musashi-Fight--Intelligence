/**
 * Unit tests for the coaching cache.
 *
 * These tests cover the cost-protection behavior Phase 2 of the MVP spec
 * relies on: LRU eviction, TTL expiry, in-flight dedupe, and stats counters.
 * The Gemini-side integration is intentionally NOT tested here — that's
 * covered by integration tests against the route handlers.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { CoachingCache, sha256Hex } from './coachingCache'

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

describe('CoachingCache.getOrCompute', () => {
  let cache: CoachingCache<string>

  beforeEach(() => {
    cache = new CoachingCache<string>({ maxEntries: 3, ttlMs: 1000 })
  })

  it('returns cached value on the second call within TTL', async () => {
    const factory = vi.fn(async () => 'result-A')

    const first = await cache.getOrCompute('k1', factory)
    const second = await cache.getOrCompute('k1', factory)

    expect(first).toBe('result-A')
    expect(second).toBe('result-A')
    expect(factory).toHaveBeenCalledTimes(1)
    const stats = cache.stats()
    expect(stats.hits).toBe(1)
    expect(stats.misses).toBe(1)
  })

  it('shares one in-flight promise across concurrent identical callers', async () => {
    let resolveInner: ((v: string) => void) | null = null
    const factory = vi.fn(
      () =>
        new Promise<string>((res) => {
          resolveInner = res
        })
    )

    const p1 = cache.getOrCompute('inflight', factory)
    const p2 = cache.getOrCompute('inflight', factory)
    const p3 = cache.getOrCompute('inflight', factory)

    expect(factory).toHaveBeenCalledTimes(1)

    resolveInner!('shared')

    expect(await p1).toBe('shared')
    expect(await p2).toBe('shared')
    expect(await p3).toBe('shared')

    const stats = cache.stats()
    expect(stats.inflightShares).toBe(2)
    expect(stats.misses).toBe(1)
  })

  it('does not cache rejections — next caller retries', async () => {
    const factory = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce('recovered')

    await expect(cache.getOrCompute('flaky', factory)).rejects.toThrow('boom')
    const second = await cache.getOrCompute('flaky', factory)

    expect(second).toBe('recovered')
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used entry once maxEntries is exceeded', async () => {
    const factory = (label: string) => vi.fn(async () => label)

    await cache.getOrCompute('a', factory('A'))
    await cache.getOrCompute('b', factory('B'))
    await cache.getOrCompute('c', factory('C'))
    // touch 'a' so 'b' becomes oldest
    await cache.getOrCompute('a', vi.fn(async () => 'should not run'))
    await cache.getOrCompute('d', factory('D'))

    expect(cache.peek('b')).toBeNull()
    expect(cache.peek('a')).toBe('A')
    expect(cache.peek('c')).toBe('C')
    expect(cache.peek('d')).toBe('D')
  })

  it('expires entries after the TTL', async () => {
    const shortLived = new CoachingCache<string>({ maxEntries: 5, ttlMs: 30 })
    const factory = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second')

    expect(await shortLived.getOrCompute('k', factory)).toBe('first')
    await wait(60)
    expect(await shortLived.getOrCompute('k', factory)).toBe('second')
    expect(factory).toHaveBeenCalledTimes(2)
  })

  it('clears state on demand', async () => {
    const factory = vi.fn(async () => 'v')
    await cache.getOrCompute('k', factory)
    cache.clear()

    expect(cache.peek('k')).toBeNull()
    const stats = cache.stats()
    expect(stats.hits).toBe(0)
    expect(stats.misses).toBe(0)
    expect(stats.size).toBe(0)
  })
})

describe('sha256Hex', () => {
  it('is deterministic for identical inputs', async () => {
    const a = await sha256Hex('musashi')
    const b = await sha256Hex('musashi')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces different digests for different inputs', async () => {
    const a = await sha256Hex('musashi')
    const b = await sha256Hex('musashi!')
    expect(a).not.toBe(b)
  })
})
