/**
 * Coaching response cache + in-flight dedupe.
 *
 * Purpose: Phase 2 of the MVP hardening spec. The four AI-spending endpoints
 * (and especially the `/api/fight/analyze` polling cadence in
 * `FightCoachExperience`) re-send identical prompts to Gemini constantly:
 *   - User pauses + scrubs back: same ledger, same window 뿯↽ second Gemini call.
 *   - Two concurrent scheduler ticks: same slice 뿯↽ two Gemini calls in flight.
 *   - Multiple users hitting the same demo URL: each one re-runs the same
 *     analysis against the same fixture clip.
 *
 * This module turns those into one Gemini call. Two layers:
 *
 *   1. `getOrCompute(key, factory)` — LRU result cache with TTL. Repeat
 *      requests within the TTL window hit memory, not Gemini.
 *   2. In-flight promise dedupe — if two callers ask for the same key while
 *      the underlying factory is still running, the second caller awaits the
 *      first caller's promise instead of starting a fresh factory call.
 *
 * Scope: per-process. On Cloudflare Workers this is per-isolate (good
 * enough for MVP — most demo traffic hits a hot isolate). For multi-region
 * scale, swap the LRU for KV / D1 in Phase 5+.
 */

type CacheEntry<V> = {
  value: V
  expiresAt: number
  insertedAt: number
}

const DEFAULT_TTL_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_MAX_ENTRIES = 200

export type CoachingCacheStats = Readonly<{
  hits: number
  misses: number
  inflightShares: number
  size: number
  maxEntries: number
  ttlMs: number
}>

export class CoachingCache<V> {
  // Map preserves insertion order — re-set on hit to mark "recently used".
  private readonly store = new Map<string, CacheEntry<V>>()
  private readonly inflight = new Map<string, Promise<V>>()
  private readonly maxEntries: number
  private readonly ttlMs: number

  private hits = 0
  private misses = 0
  private inflightShares = 0

  constructor(opts?: { maxEntries?: number; ttlMs?: number }) {
    this.maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES
    this.ttlMs = opts?.ttlMs ?? DEFAULT_TTL_MS
  }

  /**
   * Look up `key`; if missing or stale, run `factory()` exactly once even
   * under concurrent calls and store the result.
   */
  async getOrCompute(key: string, factory: () => Promise<V>): Promise<V> {
    const now = Date.now()
    const existing = this.store.get(key)
    if (existing && existing.expiresAt > now) {
      this.hits++
      // Re-insert to bump LRU position.
      this.store.delete(key)
      this.store.set(key, existing)
      return existing.value
    }

    // Stale or missing — drop it.
    if (existing) this.store.delete(key)

    const pending = this.inflight.get(key)
    if (pending) {
      this.inflightShares++
      return pending
    }

    this.misses++
    const promise = (async () => {
      try {
        const value = await factory()
        this.set(key, value)
        return value
      } finally {
        this.inflight.delete(key)
      }
    })()
    this.inflight.set(key, promise)
    return promise
  }

  /** Returns the cached value if present and unexpired, else null. */
  peek(key: string): V | null {
    const entry = this.store.get(key)
    if (!entry) return null
    if (entry.expiresAt <= Date.now()) {
      this.store.delete(key)
      return null
    }
    return entry.value
  }

  set(key: string, value: V): void {
    const now = Date.now()
    this.store.set(key, { value, expiresAt: now + this.ttlMs, insertedAt: now })
    this.evictIfFull()
  }

  delete(key: string): void {
    this.store.delete(key)
  }

  clear(): void {
    this.store.clear()
    this.inflight.clear()
    this.hits = 0
    this.misses = 0
    this.inflightShares = 0
  }

  stats(): CoachingCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      inflightShares: this.inflightShares,
      size: this.store.size,
      maxEntries: this.maxEntries,
      ttlMs: this.ttlMs,
    }
  }

  private evictIfFull(): void {
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
  }
}

/**
 * SHA-256 hex digest. Works in Node, Edge, and Cloudflare Workers — all
 * have `crypto.subtle` (or a `globalThis.crypto.subtle` shim) available.
 */
export const sha256Hex = async (input: string): Promise<string> => {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  const view = new Uint8Array(digest)
  let out = ''
  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, '0')
  }
  return out
}

/**
 * Shared singleton for grounded coaching responses. Keyed on a SHA-256 of
 * the full prompt + (optional) videoFileUri, so two callers with literally
 * identical Gemini inputs share one round-trip.
 *
 * Override TTL via env `MUSASHI_COACHING_CACHE_TTL_MS` (default 5 min).
 */
const envTtl = (): number => {
  const raw = Number(process.env.MUSASHI_COACHING_CACHE_TTL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TTL_MS
}

const envSize = (): number => {
  const raw = Number(process.env.MUSASHI_COACHING_CACHE_SIZE)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_ENTRIES
}

let _singleton: CoachingCache<unknown> | null = null

export const getCoachingCache = <V = unknown>(): CoachingCache<V> => {
  if (!_singleton) {
    _singleton = new CoachingCache<unknown>({
      maxEntries: envSize(),
      ttlMs: envTtl(),
    })
  }
  return _singleton as CoachingCache<V>
}

/** Test-only: reset the singleton. Never call from runtime code. */
export const __resetCoachingCacheForTests = (): void => {
  _singleton = null
}
