/**
 * marketplace/coachLeaderboard.ts
 *
 * Builds the unified coach ranking from signals that already live in the DB:
 *   - reviews (target_type='user')         → coach quality + prep/outcome signal
 *   - analyst_profiles.avg_overall         → analyst-job quality (denormalized)
 *   - content_products.sales_count         → content engagement
 *   - analyst_profiles.jobs_completed      → job engagement
 *
 * The "feeling of preparation" signal reuses reviews.review_phase
 * ('pre_fight'|'post_fight') and reviews.fight_outcome ('win'|'loss'|'draw'),
 * which migration 0013 already added. No new schema required.
 */
import type { D1Database } from './types'
import { computeCoachRank, RANK_LADDER, type CoachRankResult, type CoachSignals } from './coachRank'

export interface CoachLeaderboardEntry {
  userId: string
  displayName: string
  discipline: string
  isVerified: boolean
  isPro: boolean
  signals: CoachSignals
  rank: CoachRankResult
}

interface RawCoachStats {
  userReviewAvg: number
  userReviewCount: number
  analystAvg: number
  analystCount: number
  jobsCompleted: number
  salesCount: number
  prepAvg: number
  prepCount: number
  wins: number
  losses: number
  draws: number
}

const ZERO: RawCoachStats = {
  userReviewAvg: 0,
  userReviewCount: 0,
  analystAvg: 0,
  analystCount: 0,
  jobsCompleted: 0,
  salesCount: 0,
  prepAvg: 0,
  prepCount: 0,
  wins: 0,
  losses: 0,
  draws: 0,
}

/** Merge the raw per-source numbers into the engine's CoachSignals shape. */
function toSignals(raw: RawCoachStats): CoachSignals {
  const totalReviews = raw.userReviewCount + raw.analystCount
  const qualityRating =
    totalReviews > 0
      ? (raw.userReviewAvg * raw.userReviewCount + raw.analystAvg * raw.analystCount) / totalReviews
      : 0
  return {
    qualityRating,
    totalReviews,
    jobsCompleted: raw.jobsCompleted,
    salesCount: raw.salesCount,
    prepFeeling: raw.prepAvg,
    prepResponses: raw.prepCount,
    wins: raw.wins,
    losses: raw.losses,
    draws: raw.draws,
  }
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Display the sticky EARNED belt (from coach_ranks) when the coach has been
 * promoted; otherwise the live-computed rank. The score stays live either way,
 * so leaderboard order still reflects current form.
 */
function displayRank(signals: CoachSignals, earnedRankIndex?: number): CoachRankResult {
  const live = computeCoachRank(signals)
  if (earnedRankIndex != null && RANK_LADDER[earnedRankIndex]) {
    return { ...RANK_LADDER[earnedRankIndex], score: live.score, volume: live.volume }
  }
  return live
}

type DisplayRow = {
  id: string
  display_name: string | null
  discipline: string | null
  is_verified: number | null
  is_pro: number | null
  mu_name: string | null
  mu_email: string | null
}

const nameOf = (r: DisplayRow): string =>
  r.display_name?.trim() || r.mu_name?.trim() || r.mu_email?.split('@')[0] || 'Coach'

/**
 * Ranked list of all coaches (anyone who is an enabled analyst, sells published
 * content, or has been reviewed as a user). MVP-scale: a handful of set-based
 * aggregate queries merged in memory.
 */
export async function getCoachLeaderboard(
  db: D1Database,
  opts: { limit?: number; offset?: number } = {},
): Promise<CoachLeaderboardEntry[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const offset = Math.max(opts.offset ?? 0, 0)

  const candidates = await db
    .prepare(
      `SELECT c.id,
              fp.display_name, fp.discipline, fp.is_verified, fp.is_pro,
              mu.display_name AS mu_name, mu.email AS mu_email
         FROM (
           SELECT user_id AS id FROM analyst_profiles WHERE is_analyst_enabled = 1
           UNION
           SELECT creator_id AS id FROM content_products WHERE is_published = 1
           UNION
           SELECT target_id AS id FROM reviews WHERE target_type = 'user'
         ) c
         LEFT JOIN fighter_profiles fp ON fp.user_id = c.id
         LEFT JOIN musashi_users mu ON mu.id = c.id`,
    )
    .bind()
    .all<DisplayRow>()

  const stats = new Map<string, RawCoachStats>()
  const ensure = (id: string): RawCoachStats => {
    let r = stats.get(id)
    if (!r) {
      r = { ...ZERO }
      stats.set(id, r)
    }
    return r
  }

  // User-targeted reviews: overall quality.
  const userReviews = await db
    .prepare(
      `SELECT target_id AS id, AVG(rating) AS r, COUNT(*) AS c
         FROM reviews WHERE target_type = 'user' GROUP BY target_id`,
    )
    .bind()
    .all<{ id: string; r: number; c: number }>()
  for (const row of userReviews.results || []) {
    const s = ensure(row.id)
    s.userReviewAvg = num(row.r)
    s.userReviewCount = num(row.c)
  }

  // Pre/post-competition reviews: the "feeling of preparation" signal.
  const prep = await db
    .prepare(
      `SELECT target_id AS id, AVG(rating) AS r, COUNT(*) AS c
         FROM reviews
        WHERE target_type = 'user' AND review_phase IN ('pre_fight','post_fight')
        GROUP BY target_id`,
    )
    .bind()
    .all<{ id: string; r: number; c: number }>()
  for (const row of prep.results || []) {
    const s = ensure(row.id)
    s.prepAvg = num(row.r)
    s.prepCount = num(row.c)
  }

  // Actual competition outcomes (weighted lower than the feeling above).
  const outcomes = await db
    .prepare(
      `SELECT target_id AS id, fight_outcome AS o, COUNT(*) AS c
         FROM reviews
        WHERE target_type = 'user' AND fight_outcome IN ('win','loss','draw')
        GROUP BY target_id, fight_outcome`,
    )
    .bind()
    .all<{ id: string; o: string; c: number }>()
  for (const row of outcomes.results || []) {
    const s = ensure(row.id)
    if (row.o === 'win') s.wins = num(row.c)
    else if (row.o === 'loss') s.losses = num(row.c)
    else if (row.o === 'draw') s.draws = num(row.c)
  }

  // Content sales engagement.
  const sales = await db
    .prepare(
      `SELECT creator_id AS id, SUM(sales_count) AS s
         FROM content_products WHERE is_published = 1 GROUP BY creator_id`,
    )
    .bind()
    .all<{ id: string; s: number }>()
  for (const row of sales.results || []) ensure(row.id).salesCount = num(row.s)

  // Analyst reputation (denormalized): job-review quality + completed jobs.
  const profiles = await db
    .prepare(
      `SELECT user_id AS id, avg_overall AS r, review_count AS c, jobs_completed
         FROM analyst_profiles`,
    )
    .bind()
    .all<{ id: string; r: number; c: number; jobs_completed: number }>()
  for (const row of profiles.results || []) {
    const s = ensure(row.id)
    s.analystAvg = num(row.r)
    s.analystCount = num(row.c)
    s.jobsCompleted = num(row.jobs_completed)
  }

  // Sticky earned belt (coach_ranks) — the displayed credential, if promoted.
  const earned = await db
    .prepare('SELECT user_id AS id, earned_rank_index FROM coach_ranks')
    .bind()
    .all<{ id: string; earned_rank_index: number }>()
  const earnedMap = new Map<string, number>(
    (earned.results || []).map((r) => [r.id, num(r.earned_rank_index)]),
  )

  const entries: CoachLeaderboardEntry[] = (candidates.results || []).map((c) => {
    const signals = toSignals(stats.get(c.id) ?? { ...ZERO })
    return {
      userId: c.id,
      displayName: nameOf(c),
      discipline: c.discipline?.trim() || '',
      isVerified: Boolean(c.is_verified),
      isPro: Boolean(c.is_pro),
      signals,
      rank: displayRank(signals, earnedMap.get(c.id)),
    }
  })

  entries.sort((a, b) => b.rank.score - a.rank.score || b.signals.totalReviews - a.signals.totalReviews)
  return entries.slice(offset, offset + limit)
}

/** Single coach's rank — targeted queries, used for the profile badge endpoint. */
export async function getCoachRankForUser(
  db: D1Database,
  userId: string,
): Promise<CoachLeaderboardEntry | null> {
  const display = await db
    .prepare(
      `SELECT c.id,
              fp.display_name, fp.discipline, fp.is_verified, fp.is_pro,
              mu.display_name AS mu_name, mu.email AS mu_email
         FROM (SELECT ? AS id) c
         LEFT JOIN fighter_profiles fp ON fp.user_id = c.id
         LEFT JOIN musashi_users mu ON mu.id = c.id`,
    )
    .bind(userId)
    .first<DisplayRow>()
  if (!display) return null

  const raw: RawCoachStats = { ...ZERO }

  const ur = await db
    .prepare(
      `SELECT AVG(rating) AS r, COUNT(*) AS c FROM reviews
        WHERE target_type = 'user' AND target_id = ?`,
    )
    .bind(userId)
    .first<{ r: number; c: number }>()
  raw.userReviewAvg = num(ur?.r)
  raw.userReviewCount = num(ur?.c)

  const pr = await db
    .prepare(
      `SELECT AVG(rating) AS r, COUNT(*) AS c FROM reviews
        WHERE target_type = 'user' AND target_id = ?
          AND review_phase IN ('pre_fight','post_fight')`,
    )
    .bind(userId)
    .first<{ r: number; c: number }>()
  raw.prepAvg = num(pr?.r)
  raw.prepCount = num(pr?.c)

  const oc = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN fight_outcome = 'win'  THEN 1 ELSE 0 END) AS wins,
         SUM(CASE WHEN fight_outcome = 'loss' THEN 1 ELSE 0 END) AS losses,
         SUM(CASE WHEN fight_outcome = 'draw' THEN 1 ELSE 0 END) AS draws
       FROM reviews WHERE target_type = 'user' AND target_id = ?`,
    )
    .bind(userId)
    .first<{ wins: number; losses: number; draws: number }>()
  raw.wins = num(oc?.wins)
  raw.losses = num(oc?.losses)
  raw.draws = num(oc?.draws)

  const ap = await db
    .prepare(
      `SELECT avg_overall AS r, review_count AS c, jobs_completed
         FROM analyst_profiles WHERE user_id = ?`,
    )
    .bind(userId)
    .first<{ r: number; c: number; jobs_completed: number }>()
  raw.analystAvg = num(ap?.r)
  raw.analystCount = num(ap?.c)
  raw.jobsCompleted = num(ap?.jobs_completed)

  const sl = await db
    .prepare(
      `SELECT SUM(sales_count) AS s FROM content_products
        WHERE is_published = 1 AND creator_id = ?`,
    )
    .bind(userId)
    .first<{ s: number }>()
  raw.salesCount = num(sl?.s)

  const earnedRow = await db
    .prepare('SELECT earned_rank_index FROM coach_ranks WHERE user_id = ?')
    .bind(userId)
    .first<{ earned_rank_index: number }>()

  const signals = toSignals(raw)
  return {
    userId,
    displayName: nameOf(display),
    discipline: display.discipline?.trim() || '',
    isVerified: Boolean(display.is_verified),
    isPro: Boolean(display.is_pro),
    signals,
    rank: displayRank(signals, earnedRow ? num(earnedRow.earned_rank_index) : undefined),
  }
}
