import { getDbOrNull } from '@/lib/db'

export type RecurringFault = {
  label: string
  faultKind?: string
  occurrences: number
  lastSeenAt?: string
  source: 'technique_history' | 'profile_weakness' | 'ledger_history'
}

const TECHNIQUE_LABELS: Record<string, string> = {
  guard_retention: 'guard retention under pressure',
  guard_low: 'guard dropping before entries',
  chin_exposed: 'chin exposure off the base line',
  overextension: 'overreaching on strikes',
  flat_back: 'hips flattened on bottom',
  bench_press_escape: 'bench-press escape instead of frames',
  square_in_pocket: 'squaring up in the pocket',
  takedown_defense: 'takedown defense / level change',
  back_control: 'back control maintenance',
}

function labelForTechniqueId(id: string): string {
  const norm = id.trim().toLowerCase().replace(/[\s-]+/g, '_')
  return TECHNIQUE_LABELS[norm] ?? id.replace(/_/g, ' ')
}

/**
 * Cross-session recurring faults for coach-brain personalization.
 * Returns [] when DB unavailable (non-fatal).
 */
export async function getRecurringFaultsForUser(
  userId: string,
  opts?: { sport?: string | null; limit?: number },
): Promise<RecurringFault[]> {
  const db = getDbOrNull()
  if (!db) return []

  const limit = opts?.limit ?? 5
  const out: RecurringFault[] = []
  const seen = new Set<string>()

  try {
    const weakRows = await db
      .prepare(
        `SELECT technique_id, success_rate, attempts, last_practiced
         FROM user_technique_history
         WHERE user_id = ? AND success_rate < 0.6 AND attempts >= 2
         ORDER BY last_practiced DESC
         LIMIT ?`,
      )
      .bind(userId, limit * 2)
      .all()

    for (const row of weakRows.results ?? []) {
      const techniqueId = String(row.technique_id ?? '')
      if (!techniqueId || seen.has(techniqueId)) continue
      seen.add(techniqueId)
      out.push({
        label: labelForTechniqueId(techniqueId),
        faultKind: techniqueId,
        occurrences: Number(row.attempts ?? 1),
        lastSeenAt: typeof row.last_practiced === 'string' ? row.last_practiced : undefined,
        source: 'technique_history',
      })
      if (out.length >= limit) return out
    }

    const profileRow = await db
      .prepare(`SELECT weaknesses FROM user_fight_profiles WHERE user_id = ?`)
      .bind(userId)
      .first()

    if (profileRow?.weaknesses) {
      let weaknesses: string[] = []
      try {
        weaknesses = JSON.parse(String(profileRow.weaknesses))
      } catch {
        weaknesses = []
      }
      for (const weaknessId of weaknesses) {
        if (seen.has(weaknessId)) continue
        seen.add(weaknessId)
        out.push({
          label: labelForTechniqueId(weaknessId),
          faultKind: weaknessId,
          occurrences: 1,
          source: 'profile_weakness',
        })
        if (out.length >= limit) return out
      }
    }
  } catch {
    return []
  }

  return out.slice(0, limit)
}
