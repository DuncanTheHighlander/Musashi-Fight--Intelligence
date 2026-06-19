export type LocalFightSession = {
  id: string
  createdAt: string
  updatedAt: string
  videoFileName: string | null
  videoUrl?: string | null
  /** Persisted clip bytes so a saved session survives page reload (blob URLs die). */
  videoBlob?: ArrayBuffer | null
  videoMimeType?: string | null
  notes?: string
  analysis?: unknown
  analysisSource?: unknown
  analysisAtTimeSec?: number | null
  messages?: unknown
  chatMessages?: unknown
  kinematicsSeries?: unknown
  poseFrames?: unknown
}

type Db = IDBDatabase

type OpenResult = {
  db: Db
  close: () => void
}

const DB_NAME = 'musashi_fight_local'
const DB_VERSION = 1
const STORE_SESSIONS = 'sessions'

const openDb = async (): Promise<OpenResult> => {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB not available')
  }

  const req = indexedDB.open(DB_NAME, DB_VERSION)

  const db: Db = await new Promise((resolve, reject) => {
    req.onerror = () => reject(req.error || new Error('Failed to open IndexedDB'))
    req.onupgradeneeded = () => {
      const nextDb = req.result
      if (!nextDb.objectStoreNames.contains(STORE_SESSIONS)) {
        const store = nextDb.createObjectStore(STORE_SESSIONS, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt', { unique: false })
        store.createIndex('updatedAt', 'updatedAt', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
  })

  return {
    db,
    close: () => {
      try {
        db.close()
      } catch {
        // ignore
      }
    },
  }
}

const txDone = async (tx: IDBTransaction): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'))
  })
}

const reqToPromise = async <T>(req: IDBRequest<T>): Promise<T> => {
  return await new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'))
  })
}

export const putSession = async (session: LocalFightSession): Promise<void> => {
  const { db, close } = await openDb()
  try {
    const tx = db.transaction([STORE_SESSIONS], 'readwrite')
    const store = tx.objectStore(STORE_SESSIONS)
    store.put(session)
    await txDone(tx)
  } finally {
    close()
  }
}

export const deleteSession = async (id: string): Promise<void> => {
  const { db, close } = await openDb()
  try {
    const tx = db.transaction([STORE_SESSIONS], 'readwrite')
    tx.objectStore(STORE_SESSIONS).delete(id)
    await txDone(tx)
  } finally {
    close()
  }
}

/** Most recently updated session that still has persisted clip bytes. */
export const getLatestSessionWithVideo = async (): Promise<LocalFightSession | null> => {
  const sessions = await listSessions()
  return sessions.find((s) => s.videoBlob && s.videoBlob.byteLength > 0) ?? null
}

export const listSessions = async (): Promise<LocalFightSession[]> => {
  const { db, close } = await openDb()
  try {
    const tx = db.transaction([STORE_SESSIONS], 'readonly')
    const store = tx.objectStore(STORE_SESSIONS)
    const all = await reqToPromise(store.getAll())
    await txDone(tx)

    const out = (Array.isArray(all) ? all : []) as LocalFightSession[]
    out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    return out
  } finally {
    close()
  }
}

export const getSession = async (id: string): Promise<LocalFightSession | null> => {
  const { db, close } = await openDb()
  try {
    const tx = db.transaction([STORE_SESSIONS], 'readonly')
    const store = tx.objectStore(STORE_SESSIONS)
    const res = await reqToPromise(store.get(id))
    await txDone(tx)
    return (res as LocalFightSession) || null
  } finally {
    close()
  }
}

export const exportAll = async (): Promise<{ sessions: LocalFightSession[]; exportedAt: string; version: number }> => {
  const sessions = await listSessions()
  return { sessions, exportedAt: new Date().toISOString(), version: 1 }
}

export const importAll = async (payload: unknown): Promise<{ imported: number }> => {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid import file')
  const sessions = (payload as any).sessions
  if (!Array.isArray(sessions)) throw new Error('Invalid import file')

  let imported = 0
  for (const s of sessions) {
    if (!s || typeof s !== 'object') continue
    if (typeof (s as any).id !== 'string') continue
    if (typeof (s as any).createdAt !== 'string') continue
    if (typeof (s as any).updatedAt !== 'string') continue
    await putSession(s as LocalFightSession)
    imported += 1
  }

  return { imported }
}
