import { getDb } from '@/lib/db'
import { makeId } from '@/lib/fightlang/fightlang.ids'
import type { TaggedSegment } from './clipTagger'

export type TechniqueClip = {
  id: string
  techniqueId: string
  discipline: string
  sourceType: 'youtube' | 'owned'
  youtubeVideoId: string | null
  r2ObjectKey: string | null
  startSec: number
  endSec: number
  label: string
  confidence: number | null
  verified: boolean
  tags: string[]
  metadata: Record<string, any>
  createdAt: string
}

export type TechniqueClipWithEntry = TechniqueClip & {
  techniqueName: string
  categoryId: string
  difficulty: string | null
}

const rowToClip = (r: any): TechniqueClipWithEntry => ({
  id: String(r.id),
  techniqueId: String(r.technique_id),
  discipline: String(r.discipline),
  sourceType: r.source_type as TechniqueClip['sourceType'],
  youtubeVideoId: r.youtube_video_id ? String(r.youtube_video_id) : null,
  r2ObjectKey: r.r2_object_key ? String(r.r2_object_key) : null,
  startSec: Number(r.start_sec),
  endSec: Number(r.end_sec),
  label: String(r.label),
  confidence: r.confidence == null ? null : Number(r.confidence),
  verified: Boolean(r.verified),
  tags: JSON.parse(r.tags || '[]'),
  metadata: JSON.parse(r.metadata || '{}'),
  createdAt: String(r.created_at),
  techniqueName: String(r.technique_name ?? ''),
  categoryId: String(r.category_id ?? ''),
  difficulty: r.difficulty ? String(r.difficulty) : null,
})

export async function insertClip(args: {
  techniqueId: string
  discipline: string
  sourceType: 'youtube' | 'owned'
  youtubeVideoId?: string | null
  r2ObjectKey?: string | null
  startSec: number
  endSec: number
  label: string
  confidence?: number | null
  tags?: string[]
  metadata?: Record<string, unknown>
}): Promise<string> {
  const db = getDb()
  const id = makeId('clip')
  await db
    .prepare(
      `INSERT INTO technique_clips
       (id, technique_id, discipline, source_type, youtube_video_id, r2_object_key,
        start_sec, end_sec, label, confidence, tags, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
    .bind(
      id,
      args.techniqueId,
      args.discipline,
      args.sourceType,
      args.youtubeVideoId ?? null,
      args.r2ObjectKey ?? null,
      args.startSec,
      args.endSec,
      args.label,
      args.confidence ?? null,
      JSON.stringify(args.tags ?? []),
      JSON.stringify(args.metadata ?? {})
    )
    .run()
  return id
}

export async function insertTaggedSegments(args: {
  segments: TaggedSegment[]
  discipline: string
  source: { sourceType: 'youtube'; youtubeVideoId: string } | { sourceType: 'owned'; r2ObjectKey: string }
  metadata?: Record<string, unknown>
}): Promise<number> {
  let stored = 0
  for (const seg of args.segments) {
    await insertClip({
      techniqueId: seg.techniqueId,
      discipline: args.discipline,
      sourceType: args.source.sourceType,
      youtubeVideoId: args.source.sourceType === 'youtube' ? args.source.youtubeVideoId : null,
      r2ObjectKey: args.source.sourceType === 'owned' ? args.source.r2ObjectKey : null,
      startSec: seg.startSec,
      endSec: seg.endSec,
      label: seg.label,
      confidence: seg.confidence,
      tags: seg.tags,
      metadata: { ...args.metadata, taggedBy: 'gemini' },
    })
    stored++
  }
  return stored
}

export type ClipFilter = {
  discipline?: string
  categoryId?: string
  techniqueId?: string
  includeTags?: string[]
  excludeTags?: string[]
  difficulty?: string
  limit?: number
}

export async function queryClips(filter: ClipFilter): Promise<TechniqueClipWithEntry[]> {
  const db = getDb()
  const params: any[] = []
  const conditions: string[] = []

  if (filter.discipline) {
    conditions.push('c.discipline = ?')
    params.push(filter.discipline)
  }
  if (filter.categoryId) {
    conditions.push('te.category_id = ?')
    params.push(filter.categoryId)
  }
  if (filter.techniqueId) {
    conditions.push('c.technique_id = ?')
    params.push(filter.techniqueId)
  }
  if (filter.difficulty) {
    conditions.push('te.difficulty = ?')
    params.push(filter.difficulty)
  }
  for (const tag of filter.includeTags ?? []) {
    conditions.push('(c.tags LIKE ? OR te.tags LIKE ?)')
    params.push(`%${tag}%`, `%${tag}%`)
  }
  for (const tag of filter.excludeTags ?? []) {
    conditions.push('NOT (c.tags LIKE ? OR te.tags LIKE ?)')
    params.push(`%${tag}%`, `%${tag}%`)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const limit = Math.max(1, Math.min(100, filter.limit ?? 30))

  const rows = await db
    .prepare(
      `SELECT c.*, te.name AS technique_name, te.category_id AS category_id, te.difficulty AS difficulty
       FROM technique_clips c
       JOIN technique_entries te ON te.id = c.technique_id
       ${where}
       ORDER BY (c.confidence IS NULL), c.confidence DESC, c.created_at DESC
       LIMIT ?`
    )
    .bind(...params, limit)
    .all()

  return (rows.results || []).map(rowToClip)
}
