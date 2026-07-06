/**
 * Ledger persistence + human correction loop (the "Level 2" learning system).
 *
 * Every FightLang compile can be saved here (symbolic layers only — events,
 * faults, patterns; raw pose frames stay out so rows remain small). Humans
 * then confirm / reject / relabel individual detections. The accumulated
 * verdicts are the proprietary labeled dataset: short-term they drive
 * detector-threshold tuning, long-term they train learned detectors.
 *
 * Tables: fight_analysis_ledgers, ledger_corrections (migration 0018).
 */
import type { D1Database } from '@/lib/db'
import type { FightEvidenceLedger } from '@/lib/fightlang/fightlang.types'

export type CorrectionItemType = 'event' | 'fault' | 'pattern'
export type CorrectionVerdict = 'confirm' | 'reject' | 'relabel'

export type LedgerSummary = {
  id: string
  userId: string | null
  sourceId: string | null
  videoFileName: string | null
  clipDurationMs: number | null
  eventCount: number
  faultCount: number
  patternCount: number
  correctionCount: number
  createdAt: string
}

export type LedgerCorrection = {
  id: string
  ledgerId: string
  itemType: CorrectionItemType
  itemId: string
  originalKind: string
  verdict: CorrectionVerdict
  correctedKind: string | null
  actorId: string | null
  note: string | null
  createdBy: string | null
  createdAt: string
}

/** Analysis request context persisted alongside the ledger for admin review. */
export type StoredAnalysisContext = {
  sport?: string | null
  clipType?: string | null
  fighterFocus?: string | null
  poseEngine?: string | null
  poseQuality?: number | string | null
}

/** Trimmed final coaching payload persisted for admin review (not the raw LLM text). */
export type StoredCoachingSummary = {
  model?: string | null
  mainDiagnosis?: string
  quickCues?: unknown[]
  suggestedCorrections?: unknown[]
} | null

/** The slice of the ledger that gets persisted for review. */
export type StoredLedgerJson = Pick<
  FightEvidenceLedger,
  'actors' | 'clip' | 'events' | 'faults' | 'patterns'
> & {
  /** Sport / clipType / fighterFocus / pose metadata for this analysis (admin review). */
  context?: StoredAnalysisContext
  /** Final coaching shown to the user, when the LLM pass ran (admin review). */
  coaching?: StoredCoachingSummary
}

export async function saveAnalysisLedger(args: {
  db: D1Database
  ledger: FightEvidenceLedger
  userId?: string | null
  sourceId?: string | null
  videoFileName?: string | null
  context?: StoredAnalysisContext
  coaching?: StoredCoachingSummary
}): Promise<string> {
  const { db, ledger } = args
  const id = `ledg_${crypto.randomUUID()}`
  const stored: StoredLedgerJson = {
    actors: ledger.actors,
    clip: ledger.clip,
    events: ledger.events,
    faults: ledger.faults,
    patterns: ledger.patterns,
    ...(args.context ? { context: args.context } : {}),
    ...(args.coaching ? { coaching: args.coaching } : {}),
  }
  await db
    .prepare(
      `INSERT INTO fight_analysis_ledgers
         (id, user_id, source_id, video_file_name, clip_duration_ms,
          event_count, fault_count, pattern_count, ledger_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      args.userId ?? null,
      args.sourceId ?? null,
      args.videoFileName ?? null,
      (ledger.clip as { durationMs?: number } | undefined)?.durationMs ?? null,
      ledger.events.length,
      ledger.faults.length,
      ledger.patterns.length,
      JSON.stringify(stored),
      new Date().toISOString()
    )
    .run()
  return id
}

export async function listAnalysisLedgers(db: D1Database, limit = 25): Promise<LedgerSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT l.id, l.user_id, l.source_id, l.video_file_name, l.clip_duration_ms,
              l.event_count, l.fault_count, l.pattern_count, l.created_at,
              (SELECT COUNT(*) FROM ledger_corrections c WHERE c.ledger_id = l.id) AS correction_count
       FROM fight_analysis_ledgers l
       ORDER BY l.created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all<any>()
  return (results ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id ?? null,
    sourceId: r.source_id ?? null,
    videoFileName: r.video_file_name ?? null,
    clipDurationMs: r.clip_duration_ms ?? null,
    eventCount: r.event_count ?? 0,
    faultCount: r.fault_count ?? 0,
    patternCount: r.pattern_count ?? 0,
    correctionCount: r.correction_count ?? 0,
    createdAt: r.created_at,
  }))
}

export async function getAnalysisLedger(
  db: D1Database,
  id: string
): Promise<{ summary: LedgerSummary; ledger: StoredLedgerJson; corrections: LedgerCorrection[] } | null> {
  const row = await db
    .prepare(`SELECT * FROM fight_analysis_ledgers WHERE id = ?`)
    .bind(id)
    .first<any>()
  if (!row) return null
  const { results } = await db
    .prepare(`SELECT * FROM ledger_corrections WHERE ledger_id = ? ORDER BY created_at ASC`)
    .bind(id)
    .all<any>()
  const corrections = (results ?? []).map(rowToCorrection)
  return {
    summary: {
      id: row.id,
      userId: row.user_id ?? null,
      sourceId: row.source_id ?? null,
      videoFileName: row.video_file_name ?? null,
      clipDurationMs: row.clip_duration_ms ?? null,
      eventCount: row.event_count ?? 0,
      faultCount: row.fault_count ?? 0,
      patternCount: row.pattern_count ?? 0,
      correctionCount: corrections.length,
      createdAt: row.created_at,
    },
    ledger: JSON.parse(row.ledger_json) as StoredLedgerJson,
    corrections,
  }
}

export async function addLedgerCorrection(args: {
  db: D1Database
  ledgerId: string
  itemType: CorrectionItemType
  itemId: string
  originalKind: string
  verdict: CorrectionVerdict
  correctedKind?: string | null
  actorId?: string | null
  note?: string | null
  createdBy?: string | null
}): Promise<string> {
  if (args.verdict === 'relabel' && !args.correctedKind) {
    throw new Error('correctedKind is required when verdict is "relabel"')
  }
  const exists = await args.db
    .prepare(`SELECT id FROM fight_analysis_ledgers WHERE id = ?`)
    .bind(args.ledgerId)
    .first<any>()
  if (!exists) throw new Error(`Ledger not found: ${args.ledgerId}`)

  const id = `corr_${crypto.randomUUID()}`
  await args.db
    .prepare(
      `INSERT INTO ledger_corrections
         (id, ledger_id, item_type, item_id, original_kind, verdict,
          corrected_kind, actor_id, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      args.ledgerId,
      args.itemType,
      args.itemId,
      args.originalKind,
      args.verdict,
      args.verdict === 'relabel' ? args.correctedKind ?? null : null,
      args.actorId ?? null,
      args.note ?? null,
      args.createdBy ?? null,
      new Date().toISOString()
    )
    .run()
  return id
}

/**
 * Export the labeled dataset: one record per corrected item, joined with the
 * item's full detection payload from the stored ledger. This is the training
 * data — pose-derived detection + human ground truth.
 */
export async function exportCorrectionDataset(db: D1Database, limit = 5000): Promise<
  Array<{
    ledgerId: string
    videoFileName: string | null
    itemType: CorrectionItemType
    item: unknown
    originalKind: string
    verdict: CorrectionVerdict
    correctedKind: string | null
    note: string | null
    correctedAt: string
  }>
> {
  const { results } = await db
    .prepare(
      `SELECT c.*, l.video_file_name, l.ledger_json
       FROM ledger_corrections c
       JOIN fight_analysis_ledgers l ON l.id = c.ledger_id
       ORDER BY c.created_at ASC
       LIMIT ?`
    )
    .bind(limit)
    .all<any>()

  const out = []
  for (const r of results ?? []) {
    let item: unknown = null
    try {
      const ledger = JSON.parse(r.ledger_json) as StoredLedgerJson
      const pool =
        r.item_type === 'event' ? ledger.events : r.item_type === 'fault' ? ledger.faults : ledger.patterns
      item = (pool as ReadonlyArray<{ id: string }>).find((it) => it.id === r.item_id) ?? null
    } catch {
      // corrupt ledger_json — export the verdict without the item payload
    }
    out.push({
      ledgerId: r.ledger_id,
      videoFileName: r.video_file_name ?? null,
      itemType: r.item_type as CorrectionItemType,
      item,
      originalKind: r.original_kind,
      verdict: r.verdict as CorrectionVerdict,
      correctedKind: r.corrected_kind ?? null,
      note: r.note ?? null,
      correctedAt: r.created_at,
    })
  }
  return out
}

function rowToCorrection(r: any): LedgerCorrection {
  return {
    id: r.id,
    ledgerId: r.ledger_id,
    itemType: r.item_type,
    itemId: r.item_id,
    originalKind: r.original_kind,
    verdict: r.verdict,
    correctedKind: r.corrected_kind ?? null,
    actorId: r.actor_id ?? null,
    note: r.note ?? null,
    createdBy: r.created_by ?? null,
    createdAt: r.created_at,
  }
}
