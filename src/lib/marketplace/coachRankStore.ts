/**
 * marketplace/coachRankStore.ts
 *
 * Persistence + service layer for the earned (sticky) Coach Rank. The criteria
 * live in coachPromotion.ts (pure); this module reads a coach's stats, applies
 * the verdict, and writes the result:
 *   - runPromotionSweep()  — cron entry: auto-promote, or queue Black+ for review
 *   - decideReview()       — a Quality Reviewer approves / holds a queued promotion
 *   - handAward()          — shogun hand-awards Coral / Red (or any belt)
 *   - grant/revokeReviewer, canQualityReview — the reviewer-grant model
 *
 * Belts ratchet up only (never auto-demoted). Stripes / leaderboard order stay
 * live (coachRank.ts) — this is just the credential + bookkeeping.
 */
import type { D1Database } from './types'
import { newId } from './types'
import { BELT_SUMMARY, type BeltColorKey } from './coachRank'
import {
  evaluatePromotion,
  POSITIVE_REVIEW_MIN_RATING,
  type PromotionState,
} from './coachPromotion'

const QUALITY_WINDOW_DAYS = 180
const ACTIVITY_WINDOW_DAYS = 30

const nowIso = () => new Date().toISOString()
const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const beltBaseIndex = (belt: BeltColorKey): number =>
  BELT_SUMMARY.find((r) => r.beltKey === belt)?.rankIndex ?? 0

export interface CoachRankRow {
  user_id: string
  earned_belt_key: BeltColorKey
  earned_rank_index: number
  held_since: string
  promoted_at: string | null
  status: string
  pending_review_belt: BeltColorKey | null
  created_at: string
  updated_at: string
}

// ──────────────────────────────────────────────────────────────────────────
// Storage
// ──────────────────────────────────────────────────────────────────────────
export async function getCoachRank(db: D1Database, userId: string): Promise<CoachRankRow | null> {
  return db
    .prepare('SELECT * FROM coach_ranks WHERE user_id = ?')
    .bind(userId)
    .first<CoachRankRow>()
}

/** Upsert-on-read: every coach starts White with the time-in-grade clock now. */
export async function ensureCoachRank(db: D1Database, userId: string): Promise<CoachRankRow> {
  const existing = await getCoachRank(db, userId)
  if (existing) return existing
  const now = nowIso()
  await db
    .prepare(
      `INSERT INTO coach_ranks (user_id, earned_belt_key, earned_rank_index, held_since, status, created_at, updated_at)
       VALUES (?, 'white', 0, ?, 'active', ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .bind(userId, now, now, now)
    .run()
  const row = await getCoachRank(db, userId)
  if (!row) throw new Error('Failed to ensure coach rank')
  return row
}

async function appendRankEvent(
  db: D1Database,
  args: {
    userId: string
    eventType: string
    fromBelt?: BeltColorKey | null
    toBelt?: BeltColorKey | null
    actorUserId?: string | null
    notes?: string | null
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO coach_rank_events (id, user_id, event_type, from_belt, to_belt, actor_user_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      newId('cre'),
      args.userId,
      args.eventType,
      args.fromBelt ?? null,
      args.toBelt ?? null,
      args.actorUserId ?? null,
      args.notes ?? null,
      nowIso(),
    )
    .run()
}

// ──────────────────────────────────────────────────────────────────────────
// Stats → PromotionState
// ──────────────────────────────────────────────────────────────────────────
export async function buildPromotionState(
  db: D1Database,
  userId: string,
  row: CoachRankRow,
): Promise<PromotionState> {
  // Cumulative positive reviews (rating ≥ threshold) across coach reviews + jobs.
  const ur = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM reviews
        WHERE target_type = 'user' AND target_id = ? AND rating >= ?`,
    )
    .bind(userId, POSITIVE_REVIEW_MIN_RATING)
    .first<{ c: number }>()
  const mr = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM marketplace_reviews
        WHERE analyst_id = ? AND is_hidden = 0 AND avg_score >= ?`,
    )
    .bind(userId, POSITIVE_REVIEW_MIN_RATING)
    .first<{ c: number }>()
  const positiveReviews = num(ur?.c) + num(mr?.c)

  // Recent quality (rolling window), combined across both sources.
  const since = daysAgoIso(QUALITY_WINDOW_DAYS)
  const urq = await db
    .prepare(
      `SELECT AVG(rating) AS r, COUNT(*) AS c FROM reviews
        WHERE target_type = 'user' AND target_id = ? AND created_at >= ?`,
    )
    .bind(userId, since)
    .first<{ r: number; c: number }>()
  const mrq = await db
    .prepare(
      `SELECT AVG(avg_score) AS r, COUNT(*) AS c FROM marketplace_reviews
        WHERE analyst_id = ? AND is_hidden = 0 AND created_at >= ?`,
    )
    .bind(userId, since)
    .first<{ r: number; c: number }>()
  const uc = num(urq?.c)
  const mc = num(mrq?.c)
  const avgRating = uc + mc > 0 ? (num(urq?.r) * uc + num(mrq?.r) * mc) / (uc + mc) : 0

  // Active recently?
  const act = daysAgoIso(ACTIVITY_WINDOW_DAYS)
  const recent = await db
    .prepare(
      `SELECT
         (SELECT COUNT(*) FROM reviews WHERE target_type = 'user' AND target_id = ? AND created_at >= ?)
       + (SELECT COUNT(*) FROM marketplace_reviews WHERE analyst_id = ? AND created_at >= ?) AS n`,
    )
    .bind(userId, act, userId, act)
    .first<{ n: number }>()

  const daysInGrade = Math.max(0, (Date.now() - Date.parse(row.held_since)) / 86_400_000)

  return {
    earnedBelt: row.earned_belt_key,
    daysInGrade,
    positiveReviews,
    avgRating,
    activeRecently: num(recent?.n) > 0,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────────────────────────
async function applyPromotion(
  db: D1Database,
  userId: string,
  fromBelt: BeltColorKey,
  toBelt: BeltColorKey,
  opts: { eventType?: string; actorUserId?: string | null; notes?: string | null } = {},
): Promise<void> {
  const now = nowIso()
  await db
    .prepare(
      `UPDATE coach_ranks
          SET earned_belt_key = ?, earned_rank_index = ?, held_since = ?, promoted_at = ?,
              pending_review_belt = NULL, updated_at = ?
        WHERE user_id = ?`,
    )
    .bind(toBelt, beltBaseIndex(toBelt), now, now, now, userId)
    .run()
  await appendRankEvent(db, {
    userId,
    eventType: opts.eventType ?? 'PROMOTION',
    fromBelt,
    toBelt,
    actorUserId: opts.actorUserId ?? null,
    notes: opts.notes ?? null,
  })
}

async function queueReview(db: D1Database, userId: string, toBelt: BeltColorKey): Promise<void> {
  await db
    .prepare('UPDATE coach_ranks SET pending_review_belt = ?, updated_at = ? WHERE user_id = ?')
    .bind(toBelt, nowIso(), userId)
    .run()
  await appendRankEvent(db, { userId, eventType: 'REVIEW_QUEUED', toBelt })
}

export interface PromotionSweepResult {
  promoted: number
  queued: number
  errors: Array<{ userId: string; error: string }>
}

/** Candidate coaches: enabled analysts, published creators, or reviewed users. */
async function listCandidateCoaches(db: D1Database): Promise<string[]> {
  const res = await db
    .prepare(
      `SELECT user_id AS id FROM analyst_profiles WHERE is_analyst_enabled = 1
       UNION SELECT creator_id AS id FROM content_products WHERE is_published = 1
       UNION SELECT target_id AS id FROM reviews WHERE target_type = 'user'`,
    )
    .bind()
    .all<{ id: string }>()
  return (res.results || []).map((r) => r.id).filter(Boolean)
}

/**
 * Cron entry. For each coach: auto-promote when all gates pass; for review-gated
 * belts (Black+) flag a Quality Review candidate instead of promoting. One belt
 * step per sweep (time-in-grade resets on promotion).
 */
export async function runPromotionSweep(db: D1Database): Promise<PromotionSweepResult> {
  const ids = await listCandidateCoaches(db)
  const out: PromotionSweepResult = { promoted: 0, queued: 0, errors: [] }

  for (const userId of ids) {
    try {
      const row = await ensureCoachRank(db, userId)
      const state = await buildPromotionState(db, userId, row)
      const ev = evaluatePromotion(state)
      if (!ev.nextBelt || ev.manualOnly || !ev.eligible) continue

      if (ev.requiresReview) {
        if (row.pending_review_belt !== ev.nextBelt) {
          await queueReview(db, userId, ev.nextBelt)
          out.queued++
        }
      } else {
        await applyPromotion(db, userId, row.earned_belt_key, ev.nextBelt)
        out.promoted++
      }
    } catch (e) {
      out.errors.push({ userId, error: e instanceof Error ? e.message : 'unknown' })
    }
  }
  return out
}

// ──────────────────────────────────────────────────────────────────────────
// Quality Review actions
// ──────────────────────────────────────────────────────────────────────────
export async function listReviewQueue(db: D1Database): Promise<CoachRankRow[]> {
  const res = await db
    .prepare('SELECT * FROM coach_ranks WHERE pending_review_belt IS NOT NULL ORDER BY updated_at ASC')
    .bind()
    .all<CoachRankRow>()
  return res.results || []
}

/** Approve promotes to the pending belt; hold clears the flag (coach keeps current belt). */
export async function decideReview(
  db: D1Database,
  args: { userId: string; decision: 'approve' | 'hold'; actorUserId: string; notes?: string },
): Promise<CoachRankRow> {
  const row = await getCoachRank(db, args.userId)
  if (!row) throw new Error('Coach rank not found')
  if (!row.pending_review_belt) throw new Error('No promotion pending review')

  if (args.decision === 'approve') {
    await applyPromotion(db, args.userId, row.earned_belt_key, row.pending_review_belt, {
      eventType: 'REVIEW_APPROVED',
      actorUserId: args.actorUserId,
      notes: args.notes ?? null,
    })
  } else {
    await db
      .prepare('UPDATE coach_ranks SET pending_review_belt = NULL, updated_at = ? WHERE user_id = ?')
      .bind(nowIso(), args.userId)
      .run()
    await appendRankEvent(db, {
      userId: args.userId,
      eventType: 'REVIEW_HELD',
      toBelt: row.pending_review_belt,
      actorUserId: args.actorUserId,
      notes: args.notes ?? null,
    })
  }

  const updated = await getCoachRank(db, args.userId)
  if (!updated) throw new Error('Coach rank vanished after review decision')
  return updated
}

/** Hand-award any belt (e.g. Coral / Red) — bypasses metric gates. */
export async function handAward(
  db: D1Database,
  args: { userId: string; toBelt: BeltColorKey; actorUserId: string; notes?: string },
): Promise<CoachRankRow> {
  const row = await ensureCoachRank(db, args.userId)
  await applyPromotion(db, args.userId, row.earned_belt_key, args.toBelt, {
    eventType: 'HAND_AWARD',
    actorUserId: args.actorUserId,
    notes: args.notes ?? null,
  })
  const updated = await getCoachRank(db, args.userId)
  if (!updated) throw new Error('Coach rank vanished after hand-award')
  return updated
}

// ──────────────────────────────────────────────────────────────────────────
// Reviewer grants
// ──────────────────────────────────────────────────────────────────────────
export async function isReviewer(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 AS x FROM coach_rank_reviewers WHERE user_id = ?')
    .bind(userId)
    .first<{ x: number }>()
  return Boolean(row)
}

/** Shogun is always allowed; appointed reviewers (coaches or staff) also pass. */
export async function canQualityReview(
  db: D1Database,
  user: { id: string; role: string },
): Promise<boolean> {
  if (user.role === 'shogun') return true
  return isReviewer(db, user.id)
}

export async function grantReviewer(
  db: D1Database,
  args: { userId: string; grantedBy: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO coach_rank_reviewers (user_id, granted_by, granted_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET granted_by = excluded.granted_by, granted_at = excluded.granted_at`,
    )
    .bind(args.userId, args.grantedBy, nowIso())
    .run()
  await appendRankEvent(db, {
    userId: args.userId,
    eventType: 'REVIEWER_GRANTED',
    actorUserId: args.grantedBy,
  })
}

export async function revokeReviewer(
  db: D1Database,
  args: { userId: string; actorUserId: string },
): Promise<void> {
  await db.prepare('DELETE FROM coach_rank_reviewers WHERE user_id = ?').bind(args.userId).run()
  await appendRankEvent(db, {
    userId: args.userId,
    eventType: 'REVIEWER_REVOKED',
    actorUserId: args.actorUserId,
  })
}
