/**
 * IndexedDB cache for the dense boot-pass track.
 *
 * The dense pass costs minutes per clip; its output is deterministic for a
 * given clip, so it is cached and restored instantly on reload / revisit.
 * Keyed by clip fingerprint (duration + dimensions + step) — object URLs
 * change on every upload, so the URL itself is useless as a key.
 */

type StoredTrack = {
  key: string
  savedAt: number
  stepMs: number
  samples: unknown[]
}

const DB_NAME = 'musashi-dense-track'
const STORE = 'tracks'
const MAX_ENTRIES = 12

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Bump when the detection/identity pipeline changes — stale cached tracks
// from older pipeline versions must not be replayed.
const TRACK_PIPELINE_VERSION = 17

export function denseTrackKey(video: HTMLVideoElement, stepMs: number): string {
  return `v${TRACK_PIPELINE_VERSION}|${Math.round((video.duration || 0) * 1000)}|${video.videoWidth}x${video.videoHeight}|${stepMs}`
}

type GhostPrunable = {
  tMs: number
  A: Array<{ x: number; y: number }> | null
  B: Array<{ x: number; y: number }> | null
}

/**
 * Null out long "ghost" runs in a dense track.
 *
 * When a fighter leaves the frame, the identity hold keeps emitting his last
 * pose — first coasting (whole skeleton translates rigidly), then frozen
 * (identical frames). On screen that is a skeleton parked over empty floor or,
 * worse, on top of the OTHER fighter. Genuine tracking always articulates
 * (joints move relative to each other), so a run of rigid/identical frames
 * longer than the grace window is a ghost: keep the grace (bridges real
 * occlusion flicker), null the rest. Re-acquisition articulates and renders
 * normally again.
 */
export function pruneGhostRuns<T extends GhostPrunable>(track: T[], maxGhostSamples = 15): T[] {
  for (const slot of ['A', 'B'] as const) {
    let run = 0
    let prev: Array<{ x: number; y: number }> | null = null
    for (const s of track) {
      const cur = s[slot]
      if (cur && prev && cur.length === prev.length) {
        let minDx = Infinity
        let maxDx = -Infinity
        let minDy = Infinity
        let maxDy = -Infinity
        for (let i = 0; i < cur.length; i++) {
          const dx = cur[i].x - prev[i].x
          const dy = cur[i].y - prev[i].y
          if (dx < minDx) minDx = dx
          if (dx > maxDx) maxDx = dx
          if (dy < minDy) minDy = dy
          if (dy > maxDy) maxDy = dy
        }
        // EXACT rigidity only: frozen frames repeat identically and coasting
        // nudges every joint by the same delta, so ghost frames have ~zero
        // delta spread. Genuine tracking — even a near-still fighter under
        // heavy smoothing — moves each joint independently and never passes
        // this. (0.004 here previously classified smoothed slow motion as
        // ghosts and deleted real tracking.)
        const rigid = maxDx - minDx < 0.0005 && maxDy - minDy < 0.0005
        run = rigid ? run + 1 : 0
      } else {
        run = 0
      }
      prev = cur
      if (run > maxGhostSamples) {
        ;(s as GhostPrunable)[slot] = null
      }
    }
  }
  return track
}

export async function loadDenseTrack(key: string): Promise<unknown[] | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(key)
      req.onsuccess = () => {
        const row = req.result as StoredTrack | undefined
        resolve(row && Array.isArray(row.samples) && row.samples.length > 0 ? row.samples : null)
      }
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function saveDenseTrack(key: string, stepMs: number, samples: unknown[]): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      const store = tx.objectStore(STORE)
      store.put({ key, savedAt: Date.now(), stepMs, samples } satisfies StoredTrack)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
    // Best-effort prune: keep the most recent MAX_ENTRIES clips.
    const db2 = await openDb()
    const tx = db2.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const all = store.getAll()
    all.onsuccess = () => {
      const rows = (all.result as StoredTrack[]).sort((a, b) => b.savedAt - a.savedAt)
      for (const row of rows.slice(MAX_ENTRIES)) store.delete(row.key)
    }
  } catch {
    /* cache is best-effort */
  }
}
