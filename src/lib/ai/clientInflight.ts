/**
 * Client-side in-flight request dedupe.
 *
 * Phase 2 of the MVP hardening spec. The scheduler in
 * `FightCoachExperience.analyzeFightLangWindow` can fire while a previous
 * call against the same pose slice is still in flight (e.g., user scrubs,
 * the cadence timer ticks again, debug "FightLang 15s" button mashed). The
 * existing race-ID gate prevents stale React-state writes but still allows
 * the duplicate Gemini-spending POST to go out.
 *
 * This module shares one promise per fingerprint key. The first caller
 * starts the fetch; subsequent callers awaiting the same key receive the
 * same response object without a second network round-trip.
 *
 * Scope: per browser tab / per JS module instance. Survives component
 * unmount because it's module-scoped.
 */

type InflightEntry<T> = {
  promise: Promise<T>
  startedAt: number
}

const STALE_MS = 90_000 // best-effort GC for orphaned entries

const inflightMap = new Map<string, InflightEntry<unknown>>()

const sweepStale = (now: number): void => {
  for (const [k, v] of inflightMap) {
    if (now - v.startedAt > STALE_MS) inflightMap.delete(k)
  }
}

/**
 * If a promise for `key` is already running, await it. Otherwise call
 * `factory()` once and share its promise with any other callers that arrive
 * before it settles.
 *
 * Note: the cached promise is removed as soon as `factory` settles, so the
 * NEXT call (after settlement) goes back through `factory`. This is
 * intentional — we want fresh data once a request completes. For multi-call
 * result caching, use `coachingCache.ts` on the server instead.
 */
export const dedupeInflight = async <T>(key: string, factory: () => Promise<T>): Promise<T> => {
  const now = Date.now()
  sweepStale(now)

  const existing = inflightMap.get(key) as InflightEntry<T> | undefined
  if (existing) {
    return existing.promise
  }

  const promise = (async () => {
    try {
      return await factory()
    } finally {
      inflightMap.delete(key)
    }
  })()

  inflightMap.set(key, { promise, startedAt: now })
  return promise
}

/**
 * Tiny non-crypto fingerprint for slice arrays. Doesn't need to be
 * collision-resistant against attackers — just needs to be stable for a
 * given input. FNV-1a 32-bit, hex-encoded.
 */
export const fingerprintSlice = (parts: ReadonlyArray<string | number | undefined | null>): string => {
  let hash = 0x811c9dc5
  for (const part of parts) {
    const s = part == null ? '' : String(part)
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    hash ^= 0xff
    hash = Math.imul(hash, 0x01000193)
  }
  // Force unsigned and hex.
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Test-only. */
export const __resetInflightForTests = (): void => {
  inflightMap.clear()
}
