/**
 * User ratings on AI coaching (thumbs up / thumbs down).
 *
 * Table: coaching_feedback (migration 0014). One row per user per analysis —
 * re-rating replaces the previous verdict. `session_id` stores the saved
 * analysis ledger id (ledg_*) so admin review can join ratings to the ledger,
 * its context (sport/clipType/fighterFocus), and the exact feedback shown.
 */
import type { D1Database } from '@/lib/db'

export type CoachingRating = -1 | 1

export type CoachingFeedbackRow = {
  id: string
  userId: string | null
  sessionId: string | null
  rating: CoachingRating
  aiModel: string | null
  discipline: string | null
  createdAt: string
}

export async function saveCoachingFeedback(args: {
  db: D1Database
  userId: string
  /** Saved analysis ledger id (ledg_*) this rating applies to. */
  ledgerId: string
  rating: CoachingRating
  aiModel?: string | null
  discipline?: string | null
}): Promise<string> {
  const { db } = args
  // Re-rating replaces the user's previous verdict for this analysis.
  await db
    .prepare(`DELETE FROM coaching_feedback WHERE user_id = ? AND session_id = ?`)
    .bind(args.userId, args.ledgerId)
    .run()

  const id = `cfb_${crypto.randomUUID()}`
  await db
    .prepare(
      `INSERT INTO coaching_feedback (id, user_id, session_id, rating, ai_model, discipline, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      args.userId,
      args.ledgerId,
      args.rating,
      args.aiModel ?? null,
      args.discipline ?? null,
      new Date().toISOString()
    )
    .run()
  return id
}

export async function listCoachingFeedback(
  db: D1Database,
  opts?: { ledgerId?: string; limit?: number }
): Promise<CoachingFeedbackRow[]> {
  const limit = opts?.limit ?? 100
  const stmt = opts?.ledgerId
    ? db
        .prepare(
          `SELECT * FROM coaching_feedback WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
        )
        .bind(opts.ledgerId, limit)
    : db.prepare(`SELECT * FROM coaching_feedback ORDER BY created_at DESC LIMIT ?`).bind(limit)

  const { results } = await stmt.all<any>()
  return (results ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id ?? null,
    sessionId: r.session_id ?? null,
    rating: (r.rating === -1 ? -1 : 1) as CoachingRating,
    aiModel: r.ai_model ?? null,
    discipline: r.discipline ?? null,
    createdAt: r.created_at,
  }))
}
