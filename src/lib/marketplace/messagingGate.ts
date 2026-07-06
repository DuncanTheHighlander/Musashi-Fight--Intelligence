/**
 * marketplace/messagingGate.ts
 *
 * Anti-disintermediation gate for direct messaging. Two users may only DM each
 * other while they share a LIVE, funded marketplace job — i.e. money has moved
 * into escrow and a coach is actively engaged. Once the job reaches a terminal
 * state (released, refunded, cancelled, expired) the conversation closes again,
 * so nobody can keep talking for free after a transaction without funding a new
 * bounty.
 *
 * This blocks the "meet through the marketplace, then take the relationship
 * off-platform to dodge the fee" workaround. `shogun` (admin/support) is exempt
 * — see the messages route.
 */
import type { D1Database } from '@/lib/db'

/**
 * Statuses in which a coach is engaged on a FUNDED job. Mirrors the active-set
 * used elsewhere (jobs.ts). FUNDED is intentionally excluded: an open bounty is
 * funded but not yet claimed, so no specific coach is on the other end yet.
 */
export const MESSAGING_OPEN_STATUSES = [
  'CLAIMED',
  'IN_PROGRESS',
  'SUBMITTED',
  'APPROVED',
  'DISPUTED',
] as const

/**
 * True when `userA` and `userB` are the fighter/analyst pair on at least one
 * job whose status is currently in MESSAGING_OPEN_STATUSES (either direction).
 */
export async function hasActiveJobBetween(
  db: D1Database,
  userA: string,
  userB: string,
): Promise<boolean> {
  if (!userA || !userB || userA === userB) return false

  const placeholders = MESSAGING_OPEN_STATUSES.map(() => '?').join(',')
  const row = await db
    .prepare(
      `SELECT 1 FROM marketplace_jobs
        WHERE status IN (${placeholders})
          AND (
            (fighter_id = ? AND analyst_id = ?)
            OR (fighter_id = ? AND analyst_id = ?)
          )
        LIMIT 1`,
    )
    .bind(...MESSAGING_OPEN_STATUSES, userA, userB, userB, userA)
    .first()

  return Boolean(row)
}
