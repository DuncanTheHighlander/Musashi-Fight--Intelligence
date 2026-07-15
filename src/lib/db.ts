/**
 * Unified Cloudflare D1 access for Musashi.
 *
 * Resolution order:
 * 1. Real D1 binding on process.env.DB (production, wrangler dev, or MUSASHI_D1_LOCAL init)
 * 2. In-memory mock when MUSASHI_USE_MOCK_DB=1
 * 3. In-memory mock when MUSASHI_DISABLE_AUTH=1 and MUSASHI_USE_MOCK_DB is not "0"
 *    (non-production only — production never silently serves the seeded mock)
 * 4. null / throw
 */
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getMockD1 } from '@/lib/marketplace/mockD1'

export type D1Database = {
  prepare: (query: string) => {
    bind: (...args: any[]) => {
      first: <T = any>() => Promise<T | null>
      all: <T = any>() => Promise<{ results: T[] }>
      run: () => Promise<any>
    }
  }
}

type DbEnv = {
  DB?: D1Database
  MUSASHI_DISABLE_AUTH?: string
  MUSASHI_USE_MOCK_DB?: string
  MUSASHI_D1_LOCAL?: string
}

const dbEnv = (): DbEnv => process.env as DbEnv
let cloudflareContextDb: D1Database | null = null

const attachMock = (): D1Database => {
  const mock = getMockD1()
  dbEnv().DB = mock
  return mock
}

const resolveDb = (): D1Database | null => {
  const env = dbEnv()
  const bound = env.DB
  if (bound?.prepare) return bound
  if (cloudflareContextDb?.prepare) return cloudflareContextDb

  try {
    const cloudflareDb = (getCloudflareContext().env as { DB?: D1Database }).DB
    if (cloudflareDb?.prepare) {
      cloudflareContextDb = cloudflareDb
      // Cache for sync callers in this isolate (OpenNext does not put D1 on process.env).
      env.DB = cloudflareDb
      return cloudflareDb
    }
  } catch {
    // Static builds / plain Next dev do not always have a Cloudflare context.
  }

  if (env.MUSASHI_USE_MOCK_DB === '1') return attachMock()

  if (
    env.MUSASHI_DISABLE_AUTH === '1' &&
    env.MUSASHI_USE_MOCK_DB !== '0' &&
    process.env.NODE_ENV !== 'production'
  ) {
    return attachMock()
  }

  return null
}

const resolveDbAsync = async (): Promise<D1Database | null> => {
  const db = resolveDb()
  if (db) return db

  try {
    const cloudflareDb = ((await getCloudflareContext({ async: true })).env as { DB?: D1Database }).DB
    if (cloudflareDb?.prepare) {
      cloudflareContextDb = cloudflareDb
      dbEnv().DB = cloudflareDb
      return cloudflareDb
    }
  } catch {
    // Plain Next dev / static evaluation can run without a Cloudflare context.
  }

  return null
}

export const getDb = (): D1Database => {
  const db = resolveDb()
  if (!db) throw new Error('DB binding not available')
  return db
}

export const getDbOrNull = (): D1Database | null => resolveDb()

export const getDbAsync = async (): Promise<D1Database> => {
  const db = await resolveDbAsync()
  if (!db) throw new Error('DB binding not available')
  return db
}

export const getDbOrNullAsync = (): Promise<D1Database | null> => resolveDbAsync()
