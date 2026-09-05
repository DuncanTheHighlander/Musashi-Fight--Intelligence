/**
 * Training dataset flywheel — capture labeled pose windows when admins review detections.
 *
 * Pose snapshots are saved at analyze time (compact 2D). On confirm/relabel, a
 * ±500ms window around the event is extracted and stored in training_dataset.
 */
import type { D1Database } from '@/lib/db'
import type { PoseFrame, PoseLandmark } from '@/lib/fightlang/fightlang.types'
import type { CorrectionItemType, CorrectionVerdict, StoredLedgerJson } from '@/lib/ledgerStore'

export type CompactPoseFrame = {
  tMs: number
  A?: number[][]
  B?: number[][]
}

export type TrainingDatasetRow = {
  id: string
  clipId: string
  ledgerId: string
  correctionId: string | null
  sport: string | null
  raw2dKeypoints: CompactPoseFrame[]
  originalLabel: string | null
  correctedLabel: string
  confidence: number
  createdAt: string
}

const WINDOW_MS = 500
const MAX_SNAPSHOT_FRAMES = 900

function toCompactLandmarks(lms: ReadonlyArray<PoseLandmark>): number[][] {
  return lms.map((lm) => {
    const row: number[] = [lm.x, lm.y]
    if (typeof lm.z === 'number') row.push(lm.z)
    if (typeof lm.visibility === 'number') row.push(lm.visibility)
    return row
  })
}

/** Compact pose frames for DB storage (subsample if clip is very long). */
export function compactPoseFrames(frames: ReadonlyArray<PoseFrame>): CompactPoseFrame[] {
  if (frames.length === 0) return []
  const step = frames.length > MAX_SNAPSHOT_FRAMES ? Math.ceil(frames.length / MAX_SNAPSHOT_FRAMES) : 1
  const out: CompactPoseFrame[] = []
  for (let i = 0; i < frames.length; i += step) {
    const f = frames[i]!
    const row: CompactPoseFrame = { tMs: f.tMs }
    if (f.actors.A?.length) row.A = toCompactLandmarks(f.actors.A)
    if (f.actors.B?.length) row.B = toCompactLandmarks(f.actors.B)
    out.push(row)
  }
  return out
}

export async function saveLedgerPoseSnapshot(args: {
  db: D1Database
  ledgerId: string
  poseFrames: ReadonlyArray<PoseFrame>
}): Promise<void> {
  const compact = compactPoseFrames(args.poseFrames)
  if (compact.length === 0) return
  await args.db
    .prepare(
      `INSERT INTO ledger_pose_snapshots (ledger_id, pose_frames_json, created_at)
       VALUES (?, ?, ?)
       ON CONFLICT(ledger_id) DO UPDATE SET pose_frames_json = excluded.pose_frames_json`
    )
    .bind(args.ledgerId, JSON.stringify(compact), new Date().toISOString())
    .run()
}

function eventCenterMs(item: { t?: { startMs?: number; endMs?: number } } | null): number | null {
  if (!item?.t) return null
  const start = Number(item.t.startMs ?? 0)
  const end = Number(item.t.endMs ?? start)
  return Math.round((start + end) / 2)
}

export function extractPoseWindow(
  frames: ReadonlyArray<CompactPoseFrame>,
  centerMs: number,
  windowMs: number = WINDOW_MS
): CompactPoseFrame[] {
  const lo = centerMs - windowMs
  const hi = centerMs + windowMs
  return frames.filter((f) => f.tMs >= lo && f.tMs <= hi)
}

export async function captureTrainingSampleFromCorrection(args: {
  db: D1Database
  ledgerId: string
  correctionId: string
  itemType: CorrectionItemType
  itemId: string
  originalKind: string
  verdict: CorrectionVerdict
  correctedKind?: string | null
}): Promise<string | null> {
  // Only positive labels feed the training flywheel (confirm = keep label, relabel = new label).
  if (args.verdict !== 'confirm' && args.verdict !== 'relabel') return null

  const correctedLabel =
    args.verdict === 'relabel' ? (args.correctedKind ?? args.originalKind) : args.originalKind

  const ledgerRow = await args.db
    .prepare(`SELECT ledger_json, source_id FROM fight_analysis_ledgers WHERE id = ?`)
    .bind(args.ledgerId)
    .first<{ ledger_json: string; source_id: string | null }>()
  if (!ledgerRow) return null

  let ledger: StoredLedgerJson
  try {
    ledger = JSON.parse(ledgerRow.ledger_json) as StoredLedgerJson
  } catch {
    return null
  }

  const pool =
    args.itemType === 'event' ? ledger.events : args.itemType === 'fault' ? ledger.faults : ledger.patterns
  const item = (pool as ReadonlyArray<{ id: string; t?: { startMs?: number; endMs?: number } }>).find(
    (it) => it.id === args.itemId
  )
  const centerMs = eventCenterMs(item ?? null)
  if (centerMs == null) return null

  const snapRow = await args.db
    .prepare(`SELECT pose_frames_json FROM ledger_pose_snapshots WHERE ledger_id = ?`)
    .bind(args.ledgerId)
    .first<{ pose_frames_json: string }>()

  if (!snapRow?.pose_frames_json) {
    console.warn(`[TrainingDataset] No pose snapshot for ledger ${args.ledgerId} — skip capture`)
    return null
  }

  let allFrames: CompactPoseFrame[]
  try {
    allFrames = JSON.parse(snapRow.pose_frames_json) as CompactPoseFrame[]
  } catch {
    return null
  }

  const window = extractPoseWindow(allFrames, centerMs)
  if (window.length === 0) return null

  const clipId = ledgerRow.source_id ?? args.ledgerId
  const sport = ledger.context?.sport ?? null
  const id = `tds_${crypto.randomUUID()}`

  await args.db
    .prepare(
      `INSERT INTO training_dataset
         (id, clip_id, ledger_id, correction_id, sport, raw_2d_keypoints,
          original_label, corrected_label, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      clipId,
      args.ledgerId,
      args.correctionId,
      sport,
      JSON.stringify(window),
      args.originalKind,
      correctedLabel,
      1.0,
      new Date().toISOString()
    )
    .run()

  return id
}

export async function listTrainingDataset(db: D1Database, limit = 5000): Promise<TrainingDatasetRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, clip_id, ledger_id, correction_id, sport, raw_2d_keypoints,
              original_label, corrected_label, confidence, created_at
       FROM training_dataset
       ORDER BY created_at ASC
       LIMIT ?`
    )
    .bind(limit)
    .all<any>()

  return (results ?? []).map((r) => ({
    id: r.id,
    clipId: r.clip_id,
    ledgerId: r.ledger_id,
    correctionId: r.correction_id ?? null,
    sport: r.sport ?? null,
    raw2dKeypoints: JSON.parse(r.raw_2d_keypoints) as CompactPoseFrame[],
    originalLabel: r.original_label ?? null,
    correctedLabel: r.corrected_label,
    confidence: r.confidence ?? 1.0,
    createdAt: r.created_at,
  }))
}

/** Export format for ML pipelines. */
export function toTrainingExportRecord(row: TrainingDatasetRow) {
  return {
    clipId: row.clipId,
    sport: row.sport ?? 'unknown',
    raw_2d_keypoints: row.raw2dKeypoints,
    corrected_label: row.correctedLabel,
    confidence: row.confidence,
    original_label: row.originalLabel,
    ledgerId: row.ledgerId,
    correctionId: row.correctionId,
    createdAt: row.createdAt,
  }
}
