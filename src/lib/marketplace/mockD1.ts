/**
 * In-memory D1 mock for local dev when no real DB binding is available.
 * Used by src/lib/db.ts when MUSASHI_USE_MOCK_DB=1 or MUSASHI_DISABLE_AUTH=1.
 *
 * Backed by a real SQLite database (node:sqlite, Node >= 22.5) so dev behaves
 * like production D1: the full migration chain from migrations/ is applied on
 * boot (CTEs, JOINs, GROUP BY, column DEFAULTs all work exactly like D1).
 *
 * Never bundled into the Cloudflare worker: node builtins are resolved lazily
 * via process.getBuiltinModule, and production always has a real DB binding.
 */
import type { D1Database } from '@/lib/db'

type SqliteRunResult = { changes: number | bigint }

type SqliteStatement = {
  get: (...params: unknown[]) => Record<string, unknown> | undefined
  all: (...params: unknown[]) => Record<string, unknown>[]
  run: (...params: unknown[]) => SqliteRunResult
}

type SqliteDatabase = {
  exec: (sql: string) => void
  prepare: (sql: string) => SqliteStatement
}

const getBuiltinModule = <T>(name: string): T | null => {
  const get = (process as unknown as { getBuiltinModule?: (id: string) => unknown })
    .getBuiltinModule
  if (typeof get !== 'function') return null
  try {
    return (get.call(process, name) as T) ?? null
  } catch {
    return null
  }
}

const toSqliteValue = (v: unknown): unknown => {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}

function applyMigrations(db: SqliteDatabase): void {
  const fs = getBuiltinModule<typeof import('node:fs')>('node:fs')
  const path = getBuiltinModule<typeof import('node:path')>('node:path')
  if (!fs || !path) throw new Error('mock D1: node fs/path builtins unavailable')

  const dir = path.join(process.cwd(), 'migrations')
  if (!fs.existsSync(dir)) {
    throw new Error(`mock D1: migrations directory not found at ${dir}`)
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const sql = fs.readFileSync(path.join(dir, file), 'utf8')
    try {
      db.exec(sql)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      throw new Error(`mock D1: migration ${file} failed: ${msg}`)
    }
  }

  // Dev convenience: the old mock never enforced FKs and dev flows may write
  // rows that reference users created outside the seed set.
  db.exec('PRAGMA foreign_keys = OFF;')
}

/**
 * Minimal local-only data. This keeps auth-bypass development usable without
 * reintroducing fake marketplace coaches, bounties, products, or reviews.
 */
function seedDevData(db: SqliteDatabase): void {
  const now = new Date().toISOString()
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

  const run = (sql: string, ...params: unknown[]) => {
    db.prepare(sql).run(...params.map(toSqliteValue))
  }

  // --- Dev bypass account, kept in both auth/user tables.
  const accounts: Array<[id: string, email: string, name: string, role: string]> = [
    ['dev', 'dev@local', 'Dev User', 'shogun'],
  ]
  for (const [id, email, name, role] of accounts) {
    run(
      `INSERT OR IGNORE INTO musashi_users (id, email, password_hash, role, display_name, created_at, updated_at)
       VALUES (?, ?, 'dev-only', ?, ?, ?, ?)`,
      id, email, role, name, daysAgo(30), now,
    )
    run(
      `INSERT OR IGNORE INTO users (id, role, email, password_hash, first_name, last_name, created_at, updated_at)
       VALUES (?, 'client', ?, '', ?, '', ?, ?)`,
      id, email, name, daysAgo(30), now,
    )
  }

  // --- Fighter profile for the dev user.
  run(
    `INSERT OR IGNORE INTO fighter_profiles (
       id, user_id, display_name, bio, location, weight_class, discipline, record,
       stance, team, social_links, is_verified, is_pro, followers,
       performance_stats, skill_verification, created_at, updated_at
     ) VALUES
     ('profile_dev', 'dev', 'Dev User', 'Testing Musashi locally.',
      '{"city":"Las Vegas","state":"NV","country":"USA"}', 'Welterweight', 'boxing',
      '{"wins":3,"losses":1,"draws":0,"kos":1}', 'orthodox', 'Local Gym', '{}',
       0, 0, 42, '{}', '{}', ?, ?)`,
    daysAgo(30), now,
  )

  // --- Preset prompt templates: versions + active pointers so the Fight Lab
  //     preset buttons resolve real text (templates seeded in 0011/0012).
  const presets: Array<[verId: string, tplId: string, content: string]> = [
    ['ver_gameplan_1', 'tpl_gameplan',
      'Build me a complete gameplan based on everything you have seen in this session. Cover: 1) my primary win condition, 2) round-by-round strategy, 3) three specific combinations to drill this week, 4) the biggest danger to avoid.'],
    ['ver_counters_1', 'tpl_counters',
      'Analyze the opponent tendencies visible in this footage and give me a counter-strategy: their three most repeated attacks, the highest-percentage counter for each, and one drill to sharpen the timing.'],
    ['ver_corner_1', 'tpl_corner',
      'Act as my corner between rounds. Give me at most three short, direct cues based on what just happened — what is working, what to stop doing, and the one adjustment for the next round.'],
  ]
  for (const [verId, tplId, content] of presets) {
    run(
      `INSERT OR IGNORE INTO musashi_prompt_versions (id, template_id, version, content, created_at)
       VALUES (?, ?, 1, ?, ?)`,
      verId, tplId, content, now,
    )
    run(
      `INSERT OR IGNORE INTO musashi_prompt_active (template_id, active_version_id, updated_at)
       VALUES (?, ?, ?)`,
      tplId, verId, now,
    )
  }
}

export function createMockD1(): D1Database {
  const sqliteModule = getBuiltinModule<{
    DatabaseSync: new (path: string, options?: { enableForeignKeyConstraints?: boolean }) => SqliteDatabase
  }>('node:sqlite')

  if (!sqliteModule?.DatabaseSync) {
    throw new Error(
      'mock D1 requires the node:sqlite builtin (Node.js >= 22.5). ' +
        'Use a real D1 binding (MUSASHI_D1_LOCAL=1) or upgrade Node.',
    )
  }

  const sqlite = new sqliteModule.DatabaseSync(':memory:', {
    enableForeignKeyConstraints: false,
  })

  applyMigrations(sqlite)
  seedDevData(sqlite)

  const db: D1Database = {
    prepare: (query: string) => ({
      bind: (...args: unknown[]) => {
        const params = args.map(toSqliteValue)
        return {
          first: async <T = Record<string, unknown>>() =>
            (sqlite.prepare(query).get(...params) ?? null) as T | null,
          all: async <T = Record<string, unknown>>() => ({
            results: sqlite.prepare(query).all(...params) as T[],
          }),
          run: async () => {
            const result = sqlite.prepare(query).run(...params)
            return { success: true, meta: { changes: Number(result.changes) } }
          },
        }
      },
    }),
  }

  return db
}

/**
 * Singleton mock attached to process.env.DB in dev when no real D1 is bound.
 * Stored on globalThis so the in-memory data survives Next.js dev HMR reloads.
 */
const GLOBAL_KEY = '__musashi_mock_d1__'

export function getMockD1(): D1Database {
  const g = globalThis as Record<string, unknown> & { [GLOBAL_KEY]?: D1Database }
  if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = createMockD1()
  return g[GLOBAL_KEY]
}

/** Pin a specific in-memory DB for route-handler tests (avoids singleton drift). */
export function pinMockD1(db: D1Database): void {
  const g = globalThis as Record<string, unknown> & { [GLOBAL_KEY]?: D1Database }
  g[GLOBAL_KEY] = db
  ;(process.env as { DB?: D1Database }).DB = db
}

export function unpinMockD1(): void {
  const g = globalThis as Record<string, unknown> & { [GLOBAL_KEY]?: D1Database }
  delete g[GLOBAL_KEY]
  delete (process.env as { DB?: D1Database }).DB
}
