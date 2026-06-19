/**
 * Unified Cloudflare D1 access for Musashi.
 *
 * Resolution order:
 * 1. Real D1 binding on process.env.DB (production, wrangler dev, or MUSASHI_D1_LOCAL init)
 * 2. In-memory mock when MUSASHI_USE_MOCK_DB=1
 * 3. In-memory mock when MUSASHI_DISABLE_AUTH=1 and MUSASHI_USE_MOCK_DB is not "0"
 * 4. null / throw
 */
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

const attachMock = (): D1Database => {
  const mock = getMockD1()
  dbEnv().DB = mock
  return mock
}

const resolveDb = (): D1Database | null => {
  const env = dbEnv()
  const bound = env.DB
  if (bound?.prepare) return bound

  if (env.MUSASHI_USE_MOCK_DB === '1') return attachMock()

  if (env.MUSASHI_DISABLE_AUTH === '1' && env.MUSASHI_USE_MOCK_DB !== '0') {
    return attachMock()
  }

  return null
}

export const getDb = (): D1Database => {
  const db = resolveDb()
  if (!db) throw new Error('DB binding not available')
  return db
}

export const getDbOrNull = (): D1Database | null => resolveDb()
