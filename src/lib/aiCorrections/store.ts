import type { D1Database } from '@/lib/db'

export type AiCorrectionStatus = 'draft' | 'approved' | 'gold' | 'rejected' | 'archived'
export type AiCorrectionResponseType = 'coach_card' | 'chat'

export type AiCorrectionRow = {
  id: string
  ownerUserId: string
  clipId: string | null
  videoFingerprint: string | null
  ledgerId: string | null
  responseType: AiCorrectionResponseType
  responseRef: string | null
  cardSection: string | null
  sport: string
  focusTarget: string | null
  startMs: number | null
  endMs: number | null
  wholeClip: boolean
  originalText: string
  correctionText: string
  correctedLabelsJson: string
  correctionCategoriesJson: string | null
  coachingNote: string | null
  status: AiCorrectionStatus
  modelName: string | null
  scope: string | null
  createdAt: string
  updatedAt: string
}

function mapRow(r: Record<string, unknown>): AiCorrectionRow {
  return {
    id: String(r.id),
    ownerUserId: String(r.owner_user_id),
    clipId: r.clip_id != null ? String(r.clip_id) : null,
    videoFingerprint: r.video_fingerprint != null ? String(r.video_fingerprint) : null,
    ledgerId: r.ledger_id != null ? String(r.ledger_id) : null,
    responseType: (r.response_type === 'chat' ? 'chat' : 'coach_card') as AiCorrectionResponseType,
    responseRef: r.response_ref != null ? String(r.response_ref) : null,
    cardSection: r.card_section != null ? String(r.card_section) : null,
    sport: String(r.sport),
    focusTarget: r.focus_target != null ? String(r.focus_target) : null,
    startMs: r.start_ms != null ? Number(r.start_ms) : null,
    endMs: r.end_ms != null ? Number(r.end_ms) : null,
    wholeClip: Number(r.whole_clip) === 1,
    originalText: String(r.original_text ?? ''),
    correctionText: String(r.correction_text ?? ''),
    correctedLabelsJson: String(r.corrected_labels_json ?? '{}'),
    correctionCategoriesJson: r.correction_categories_json != null ? String(r.correction_categories_json) : null,
    coachingNote: r.coaching_note != null ? String(r.coaching_note) : null,
    status: String(r.status) as AiCorrectionStatus,
    modelName: r.model_name != null ? String(r.model_name) : null,
    scope: r.scope != null ? String(r.scope) : null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }
}

export async function insertAiCorrection(
  db: D1Database,
  input: {
    ownerUserId: string
    clipId?: string | null
    videoFingerprint?: string | null
    ledgerId?: string | null
    responseType: AiCorrectionResponseType
    responseRef?: string | null
    cardSection?: string | null
    sport: string
    focusTarget?: string | null
    startMs?: number | null
    endMs?: number | null
    wholeClip?: boolean
    originalText: string
    correctionText: string
    correctedLabelsJson: string
    correctionCategoriesJson?: string | null
    coachingNote?: string | null
    status?: AiCorrectionStatus
    modelName?: string | null
  },
): Promise<AiCorrectionRow> {
  const id = `aic_${crypto.randomUUID()}`
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO ai_corrections (
        id, owner_user_id, clip_id, video_fingerprint, ledger_id,
        response_type, response_ref, card_section, sport, focus_target,
        start_ms, end_ms, whole_clip, original_text, correction_text,
        corrected_labels_json, correction_categories_json, coaching_note,
        status, model_name, scope, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    )
    .bind(
      id,
      input.ownerUserId,
      input.clipId ?? null,
      input.videoFingerprint ?? null,
      input.ledgerId ?? null,
      input.responseType,
      input.responseRef ?? null,
      input.cardSection ?? null,
      input.sport,
      input.focusTarget ?? null,
      input.startMs ?? null,
      input.endMs ?? null,
      input.wholeClip ? 1 : 0,
      input.originalText,
      input.correctionText,
      input.correctedLabelsJson,
      input.correctionCategoriesJson ?? null,
      input.coachingNote ?? null,
      input.status ?? 'draft',
      input.modelName ?? null,
      now,
      now,
    )
    .run()

  const row = await db.prepare(`SELECT * FROM ai_corrections WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  if (!row) throw new Error('INSERT_FAILED')
  return mapRow(row)
}

export async function getAiCorrection(db: D1Database, id: string): Promise<AiCorrectionRow | null> {
  const row = await db.prepare(`SELECT * FROM ai_corrections WHERE id = ?`).bind(id).first<Record<string, unknown>>()
  return row ? mapRow(row) : null
}

export async function updateAiCorrectionStatus(
  db: D1Database,
  id: string,
  status: AiCorrectionStatus,
  patch?: Partial<{
    correctedLabelsJson: string
    correctionCategoriesJson: string | null
    coachingNote: string | null
    startMs: number | null
    endMs: number | null
    wholeClip: boolean
    correctionText: string
  }>,
): Promise<AiCorrectionRow | null> {
  const existing = await getAiCorrection(db, id)
  if (!existing) return null
  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE ai_corrections SET
        status = ?,
        corrected_labels_json = ?,
        correction_categories_json = ?,
        coaching_note = ?,
        start_ms = ?,
        end_ms = ?,
        whole_clip = ?,
        correction_text = ?,
        updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      status,
      patch?.correctedLabelsJson ?? existing.correctedLabelsJson,
      patch?.correctionCategoriesJson !== undefined
        ? patch.correctionCategoriesJson
        : existing.correctionCategoriesJson,
      patch?.coachingNote !== undefined ? patch.coachingNote : existing.coachingNote,
      patch?.startMs !== undefined ? patch.startMs : existing.startMs,
      patch?.endMs !== undefined ? patch.endMs : existing.endMs,
      patch?.wholeClip !== undefined ? (patch.wholeClip ? 1 : 0) : existing.wholeClip ? 1 : 0,
      patch?.correctionText ?? existing.correctionText,
      now,
      id,
    )
    .run()
  return getAiCorrection(db, id)
}

export async function listAiCorrections(
  db: D1Database,
  opts: {
    ownerUserId?: string
    status?: AiCorrectionStatus | AiCorrectionStatus[]
    limit?: number
  } = {},
): Promise<AiCorrectionRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  const statuses = opts.status
    ? Array.isArray(opts.status)
      ? opts.status
      : [opts.status]
    : null

  let sql = `SELECT * FROM ai_corrections WHERE 1=1`
  const binds: unknown[] = []
  if (opts.ownerUserId) {
    sql += ` AND owner_user_id = ?`
    binds.push(opts.ownerUserId)
  }
  if (statuses?.length) {
    sql += ` AND status IN (${statuses.map(() => '?').join(',')})`
    binds.push(...statuses)
  }
  sql += ` ORDER BY updated_at DESC LIMIT ?`
  binds.push(limit)

  const { results } = await db
    .prepare(sql)
    .bind(...binds)
    .all<Record<string, unknown>>()
  return (results ?? []).map(mapRow)
}

/**
 * Same-owner exact-clip retrieval for analyze-time memory.
 * Matches clip_id OR video_fingerprint, sport, approved|gold, window overlap.
 */
export async function fetchApprovedCorrectionsForClip(args: {
  db: D1Database
  ownerUserId: string
  clipId?: string | null
  videoFingerprint?: string | null
  sport: string
  rangeStartMs?: number | null
  rangeEndMs?: number | null
}): Promise<AiCorrectionRow[]> {
  const clipId = args.clipId?.trim() || null
  const fp = args.videoFingerprint?.trim() || null
  if (!clipId && !fp) return []

  const clauses: string[] = [`owner_user_id = ?`, `sport = ?`, `status IN ('approved', 'gold')`]
  const binds: unknown[] = [args.ownerUserId, args.sport]

  if (clipId && fp) {
    clauses.push(`(clip_id = ? OR video_fingerprint = ?)`)
    binds.push(clipId, fp)
  } else if (clipId) {
    clauses.push(`clip_id = ?`)
    binds.push(clipId)
  } else {
    clauses.push(`video_fingerprint = ?`)
    binds.push(fp)
  }

  const { results } = await args.db
    .prepare(
      `SELECT * FROM ai_corrections WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC LIMIT 40`,
    )
    .bind(...binds)
    .all<Record<string, unknown>>()

  const rows = (results ?? []).map(mapRow)
  const rangeStart = args.rangeStartMs ?? 0
  const rangeEnd = args.rangeEndMs ?? Number.POSITIVE_INFINITY

  return rows.filter((row) => {
    if (row.wholeClip || (row.startMs == null && row.endMs == null)) return true
    const s = row.startMs ?? 0
    const e = row.endMs ?? s
    // Overlap with analyzed range
    return s <= rangeEnd && e >= rangeStart
  })
}
