/**
 * In-memory D1 mock for local dev when no real DB binding is available.
 * Used by src/lib/db.ts when MUSASHI_USE_MOCK_DB=1 or MUSASHI_DISABLE_AUTH=1.
 *
 * Backed by a real SQLite database (node:sqlite, Node >= 22.5) so dev behaves
 * like production D1: the full migration chain from migrations/ is applied on
 * boot (CTEs, JOINs, GROUP BY, column DEFAULTs all work exactly like D1), then
 * demo data is seeded so the UI has content to show.
 *
 * Never bundled into the Cloudflare worker: node builtins are resolved lazily
 * via process.getBuiltinModule, and production always has a real DB binding.
 */
import type { D1Database } from '@/lib/db'
import { defaultClaimDeadlineAt } from './deadlines'

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
 * Demo data for local dev. The migration chain already seeds a small social
 * graph (Alex Rodriguez, Sarah Chen, Mike Johnson, Lena Kobayashi — see 0007).
 * Here we add the dev bypass user, a demo analyst, marketplace content,
 * conversations, notifications, and fight history so every section of the UI
 * has something real to render.
 */
function seedDevData(db: SqliteDatabase): void {
  const now = new Date().toISOString()
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()
  const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
  const claimAt = defaultClaimDeadlineAt()

  const run = (sql: string, ...params: unknown[]) => {
    db.prepare(sql).run(...params.map(toSqliteValue))
  }

  // --- Accounts: dev bypass user + demo analyst (both user tables kept in sync)
  const accounts: Array<[id: string, email: string, name: string, role: string]> = [
    ['dev', 'dev@local', 'Dev User', 'shogun'],
    ['analyst_demo', 'coach.demo@local', 'Coach Demo', 'user'],
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

  // --- Fighter profiles for the dev user + demo analyst
  run(
    `INSERT OR IGNORE INTO fighter_profiles (
       id, user_id, display_name, bio, location, weight_class, discipline, record,
       stance, team, social_links, is_verified, is_pro, followers,
       performance_stats, skill_verification, created_at, updated_at
     ) VALUES
     ('profile_dev', 'dev', 'Dev User', 'Testing Musashi locally.',
      '{"city":"Las Vegas","state":"NV","country":"USA"}', 'Welterweight', 'boxing',
      '{"wins":3,"losses":1,"draws":0,"kos":1}', 'orthodox', 'Local Gym', '{}',
      0, 0, 42, '{}', '{}', ?, ?),
     ('profile_analyst_demo', 'analyst_demo', 'Coach Demo',
      'Demo analyst for local marketplace testing. Breakdown specialist.',
      '{"city":"Austin","state":"TX","country":"USA"}', 'Middleweight', 'mma',
      '{"wins":9,"losses":2,"draws":0,"kos":4}', 'southpaw', 'Demo Fight Lab', '{}',
      1, 0, 1850, '{}', '{}', ?, ?)`,
    daysAgo(30), now, daysAgo(30), now,
  )

  // --- Analyst layer (job marketplace): demo analyst + Sarah Chen from 0007
  run(
    `INSERT OR IGNORE INTO analyst_profiles (
       user_id, is_analyst_enabled, bio, specialties, languages, turnaround_hours,
       direct_hire_enabled, direct_hire_rate_cents, belt_tier, belt_score,
       jobs_completed, jobs_cancelled, jobs_disputed, total_earned_cents,
       avg_tactical_accuracy, avg_actionability, avg_communication, avg_overall,
       review_count, current_capacity, max_capacity, created_at, updated_at
     ) VALUES
     ('analyst_demo', 1, 'Demo analyst for local marketplace testing.',
      '["boxing","mma"]', '["en"]', 48, 1, 5000, 'blue', 4.2,
      12, 0, 0, 48000, 4.5, 4.3, 4.6, 4.5, 8, 0, 4, ?, ?),
     ('user_coach_1', 1, 'Muay Thai specialist offering remote breakdowns and clinch gameplans.',
      '["muay_thai","kickboxing"]', '["en"]', 72, 1, 9000, 'purple', 6.8,
      31, 1, 0, 215000, 4.8, 4.7, 4.9, 4.8, 24, 1, 3, ?, ?)`,
    daysAgo(60), now, daysAgo(120), now,
  )

  // --- Open bounty so the job marketplace has a live job
  run(
    `INSERT OR IGNORE INTO marketplace_jobs (
       id, scouting_request_id, breakdown_offer_id, fighter_id, analyst_id, job_type,
       required_belt_tier, title, brief, videos, amount_cents, platform_fee_bps,
       platform_fee_cents, analyst_payout_cents, currency, status,
       claim_deadline_at, client_request_id, created_at, updated_at
     ) VALUES (
       'job_demo_bounty', NULL, NULL, 'dev', NULL, 'open_bounty', 'blue',
       'Analyze my southpaw sparring round', 'Focus on footwork and guard recovery.',
       '[]', 5000, 1400, 700, 4300, 'USD', 'FUNDED', ?, 'seed_open_bounty', ?, ?)`,
    claimAt, daysAgo(2), now,
  )

  // --- Content marketplace products (published demo content)
  const products: Array<[
    id: string, creator: string, title: string, desc: string, type: string,
    price: number, duration: number, tags: string, sales: number, rating: number,
    reviews: number, created: string,
  ]> = [
    ['prod_jab_mastery', 'user_coach_1', 'Jab Mastery: Range Control Fundamentals',
      'A 40-minute breakdown of how elite strikers use the jab to control range, set traps, and open combinations. Includes 6 drills you can run solo or with a partner.',
      'technique', 29, 2400, '["boxing","jab","fundamentals"]', 184, 4.8, 36, daysAgo(45)],
    ['prod_clinch_counters', 'user_coach_1', 'Clinch Counters for Southpaws',
      'Posture breaks, elbow entries, and sweep timing against taller clinch specialists. Filmed with frame-by-frame annotations.',
      'technique', 39, 3100, '["muay_thai","clinch","southpaw"]', 97, 4.7, 21, daysAgo(30)],
    ['prod_pressure_breakdown', 'user_scout_1', 'Beating Forward Pressure: Full Fight Breakdown',
      'Complete tactical breakdown of a 5-round war against a pressure fighter — exits, pivots, and counter timing analyzed round by round.',
      'breakdown', 24, 2900, '["mma","pressure","footwork"]', 142, 4.9, 31, daysAgo(21)],
    ['prod_camp_program', 'analyst_demo', '8-Week Fight Camp Conditioning Program',
      'Structured training plan: strength, conditioning, and sparring progressions for an 8-week camp, with weekly load targets.',
      'training', 49, 0, '["conditioning","fight-camp","program"]', 63, 4.6, 14, daysAgo(14)],
    ['prod_video_review', 'analyst_demo', '1-on-1 Video Review Session',
      'Send one sparring or fight video (up to 15 minutes) and get a personal 30-minute coaching review call with written notes.',
      'coaching', 79, 0, '["coaching","video-review","1on1"]', 28, 5.0, 9, daysAgo(7)],
  ]
  for (const [id, creator, title, desc, type, price, duration, tags, sales, rating, reviews, created] of products) {
    run(
      `INSERT OR IGNORE INTO content_products (
         id, creator_id, title, description, type, price, currency, video_url,
         thumbnail_url, duration, tags, is_published, sales_count, rating,
         review_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, 'USD', '', '', ?, ?, 1, ?, ?, ?, ?, ?)`,
      id, creator, title, desc, type, price, duration, tags, sales, rating, reviews, created, created,
    )
  }

  // --- Reviews for products and coaches
  const productReviews: Array<[id: string, reviewer: string, target: string, rating: number, comment: string, created: string]> = [
    ['rev_seed_1', 'user_fighter_1', 'prod_jab_mastery', 5, 'The range-control drills fixed my biggest gap in two weeks. Worth every dollar.', daysAgo(20)],
    ['rev_seed_2', 'user_fighter_2', 'prod_pressure_breakdown', 5, 'Exactly what I needed before facing a pressure fighter. The exit footwork section is gold.', daysAgo(12)],
    ['rev_seed_3', 'user_fighter_1', 'prod_camp_program', 4, 'Solid structure. I adapted week 5-6 for my schedule but the progressions are smart.', daysAgo(6)],
  ]
  for (const [id, reviewer, target, rating, comment, created] of productReviews) {
    run(
      `INSERT OR IGNORE INTO reviews (id, reviewer_id, target_id, target_type, rating, comment, created_at)
       VALUES (?, ?, ?, 'product', ?, ?, ?)`,
      id, reviewer, target, rating, comment, created,
    )
  }
  run(
    `INSERT OR IGNORE INTO reviews (id, reviewer_id, target_id, target_type, rating, comment, created_at)
     VALUES ('rev_seed_coach_1', 'user_fighter_1', 'user_coach_1', 'user', 5,
             'Sarah''s clinch gameplan won me the third round. Clear, specific, and honest.', ?)`,
    daysAgo(15),
  )

  // --- Competition prep reviews: pre/post-fight "feeling of preparation" + outcomes.
  //     Feeds the coach belt ranking (lib/marketplace/coachRank.ts), where the
  //     felt preparation is weighted above the actual win/loss result.
  const compReviews: Array<[
    id: string, reviewer: string, target: string, rating: number,
    phase: 'pre_fight' | 'post_fight', outcome: string | null, comment: string, created: string,
  ]> = [
    ['rev_prep_1', 'user_fighter_1', 'user_coach_1', 5, 'pre_fight', null, 'Walked in feeling like I already knew his reads.', daysAgo(28)],
    ['rev_prep_2', 'user_fighter_1', 'user_coach_1', 5, 'post_fight', 'win', 'Gameplan held up round for round.', daysAgo(25)],
    ['rev_prep_3', 'user_fighter_2', 'user_coach_1', 4, 'pre_fight', null, 'Most prepared I have been for a clinch fighter.', daysAgo(20)],
    ['rev_prep_4', 'user_fighter_2', 'user_coach_1', 5, 'post_fight', 'loss', 'Lost the decision but I was ready — the plan was right.', daysAgo(18)],
    ['rev_prep_5', 'user_fighter_1', 'analyst_demo', 4, 'pre_fight', null, 'Solid film study, felt good on the exits.', daysAgo(16)],
    ['rev_prep_6', 'user_fighter_1', 'analyst_demo', 3, 'post_fight', 'win', 'Won, though the conditioning notes were thin.', daysAgo(13)],
  ]
  for (const [id, reviewer, target, rating, phase, outcome, comment, created] of compReviews) {
    run(
      `INSERT OR IGNORE INTO reviews (id, reviewer_id, target_id, target_type, rating, comment, review_phase, fight_outcome, created_at)
       VALUES (?, ?, ?, 'user', ?, ?, ?, ?, ?)`,
      id, reviewer, target, rating, comment, phase, outcome, created,
    )
  }

  // --- Conversations with the dev user
  const messages: Array<[id: string, sender: string, receiver: string, content: string, read: number, created: string]> = [
    ['msg_dev_1', 'dev', 'analyst_demo', 'Hey coach — just uploaded my sparring round from Saturday. Main thing I want eyes on is my guard after the jab.', 1, minutesAgo(60 * 26)],
    ['msg_dev_2', 'analyst_demo', 'dev', 'Got it. First pass: you drop the right hand on every second jab. I will mark the timestamps tonight.', 1, minutesAgo(60 * 25)],
    ['msg_dev_3', 'analyst_demo', 'dev', 'Breakdown is ready — check the notes on rounds 1 and 2. Big one: reset your stance width after each exit.', 0, minutesAgo(45)],
    ['msg_dev_4', 'user_coach_1', 'dev', 'Saw your bounty posting. I specialize in southpaw matchups if you want a second opinion.', 0, minutesAgo(60 * 5)],
  ]
  for (const [id, sender, receiver, content, read, created] of messages) {
    run(
      `INSERT OR IGNORE INTO messages (id, sender_id, receiver_id, content, attachments, is_read, read_at, created_at)
       VALUES (?, ?, ?, ?, '[]', ?, ?, ?)`,
      id, sender, receiver, content, read, read ? created : null, created,
    )
  }

  // --- Notifications for the dev user
  const notifications: Array<[id: string, type: string, title: string, body: string, read: number, created: string]> = [
    ['notif_dev_1', 'message', 'New Message', 'Coach Demo sent you a message about your sparring breakdown.', 0, minutesAgo(45)],
    ['notif_dev_2', 'marketplace', 'Bounty Funded', 'Your bounty "Analyze my southpaw sparring round" is funded and live for analysts.', 0, minutesAgo(60 * 24)],
    ['notif_dev_3', 'system', 'Welcome to Musashi', 'Your training space is ready. Upload a video in the Fight Lab to get your first AI breakdown.', 1, daysAgo(7)],
  ]
  for (const [id, type, title, body, read, created] of notifications) {
    run(
      `INSERT OR IGNORE INTO musashi_notifications (id, user_id, type, title, body, payload, is_read, created_at, read_at)
       VALUES (?, 'dev', ?, ?, ?, '{}', ?, ?, ?)`,
      id, type, title, body, read, created, read ? created : null,
    )
  }

  // --- Fight history: completed sessions + aggregated performance metrics
  const sessions: Array<[id: string, user: string, title: string, created: string]> = [
    ['fs_dev_1', 'dev', 'Sparring — southpaw round 1', daysAgo(9)],
    ['fs_dev_2', 'dev', 'Bag work — power tracking', daysAgo(5)],
    ['fs_dev_3', 'dev', 'Sparring — counters drill', daysAgo(2)],
    ['fs_coach_1', 'user_coach_1', 'Clinch entries demo', daysAgo(40)],
    ['fs_scout_1', 'user_scout_1', 'Pressure analysis session', daysAgo(18)],
    ['fs_analyst_1', 'analyst_demo', 'Technique filming session', daysAgo(12)],
  ]
  for (const [id, user, title, created] of sessions) {
    run(
      `INSERT OR IGNORE INTO fight_sessions (id, user_id, title, ruleset, status, start_time, end_time, duration_seconds, created_at, updated_at)
       VALUES (?, ?, ?, 'boxing', 'completed', ?, ?, 600, ?, ?)`,
      id, user, title, created, created, created, created,
    )
  }
  const metrics: Array<[id: string, session: string, user: string, avgSpeed: number, maxSpeed: number, avgPower: number, maxPower: number, created: string]> = [
    ['pm_dev_1', 'fs_dev_1', 'dev', 3.2, 5.1, 6.4, 8.9, daysAgo(9)],
    ['pm_dev_2', 'fs_dev_2', 'dev', 3.6, 5.6, 7.1, 9.4, daysAgo(5)],
    ['pm_coach_1', 'fs_coach_1', 'user_coach_1', 4.1, 6.2, 7.8, 9.8, daysAgo(40)],
    ['pm_scout_1', 'fs_scout_1', 'user_scout_1', 3.9, 5.8, 7.2, 9.1, daysAgo(18)],
    ['pm_analyst_1', 'fs_analyst_1', 'analyst_demo', 3.7, 5.5, 6.9, 8.8, daysAgo(12)],
  ]
  for (const [id, session, user, avgSpeed, maxSpeed, avgPower, maxPower, created] of metrics) {
    run(
      `INSERT OR IGNORE INTO performance_metrics (
         id, session_id, user_id, avg_hand_speed_bwps, max_hand_speed_bwps,
         avg_power_index, max_power_index, total_strikes, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 120, ?, ?)`,
      id, session, user, avgSpeed, maxSpeed, avgPower, maxPower, created, created,
    )
  }

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
