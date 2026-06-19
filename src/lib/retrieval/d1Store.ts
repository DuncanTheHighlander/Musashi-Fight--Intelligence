import type { RetrievalDoc, RetrievalNamespace, VideoSegmentDoc } from './types'

type D1Database = {
  prepare: (query: string) => {
    bind: (...args: any[]) => {
      all: <T = any>() => Promise<{ results: T[] }>
      first: <T = any>() => Promise<T | null>
      run: () => Promise<{ success: boolean; meta: Record<string, any> }>
    }
  }
}

const safeJsonParse = <T>(text: string, fallback: T): T => {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

// ── Text / generic doc upsert ───────────────────────────────────────────────

export async function upsertRetrievalDoc(db: D1Database, doc: RetrievalDoc): Promise<void> {
  const embedding = Array.isArray(doc.embedding) ? doc.embedding : null
  if (!embedding || embedding.length === 0) throw new Error('upsertRetrievalDoc requires embedding')
  const embeddingJson = JSON.stringify(embedding)
  const metadataJson = JSON.stringify(doc.metadata || {})

  await db.prepare(
    `
INSERT INTO retrieval_docs (
  id, user_id, namespace, source_id, session_id, clip_id, title, text,
  metadata_json, embedding_json, embedding_model, media_kind,
  source_file_uri, segment_start_ms, segment_end_ms,
  created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET
  user_id=excluded.user_id,
  namespace=excluded.namespace,
  source_id=excluded.source_id,
  session_id=excluded.session_id,
  clip_id=excluded.clip_id,
  title=excluded.title,
  text=excluded.text,
  metadata_json=excluded.metadata_json,
  embedding_json=excluded.embedding_json,
  embedding_model=excluded.embedding_model,
  media_kind=excluded.media_kind,
  source_file_uri=excluded.source_file_uri,
  segment_start_ms=excluded.segment_start_ms,
  segment_end_ms=excluded.segment_end_ms,
  updated_at=CURRENT_TIMESTAMP
`
  )
    .bind(
      doc.id,
      doc.userId,
      doc.namespace,
      doc.sourceId ?? null,
      doc.sessionId ?? null,
      doc.clipId ?? null,
      doc.title ?? null,
      doc.text,
      metadataJson,
      embeddingJson,
      doc.embeddingModel || 'gemini-embedding-2-preview',
      doc.mediaKind || 'text',
      doc.sourceFileUri ?? null,
      doc.segmentStartMs ?? null,
      doc.segmentEndMs ?? null,
      doc.createdAt ?? null
    )
    .run()
}

// ── Video segment upsert ────────────────────────────────────────────────────

export async function upsertVideoSegmentDoc(db: D1Database, doc: VideoSegmentDoc): Promise<void> {
  if (!Array.isArray(doc.embedding) || doc.embedding.length === 0) {
    throw new Error('upsertVideoSegmentDoc requires embedding')
  }

  const embeddingJson = JSON.stringify(doc.embedding)
  const metadataJson = JSON.stringify({
    ...doc.metadata,
    mimeType: doc.mimeType,
  })

  await db.prepare(
    `
INSERT INTO retrieval_docs (
  id, user_id, namespace, source_id, session_id, clip_id, title, text,
  metadata_json, embedding_json, embedding_model, media_kind,
  source_file_uri, segment_start_ms, segment_end_ms,
  created_at, updated_at
) VALUES (?, ?, 'video_segment', NULL, ?, ?, ?, ?, ?, ?, ?, 'video_segment', ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
ON CONFLICT(id) DO UPDATE SET
  user_id=excluded.user_id,
  session_id=excluded.session_id,
  clip_id=excluded.clip_id,
  title=excluded.title,
  text=excluded.text,
  metadata_json=excluded.metadata_json,
  embedding_json=excluded.embedding_json,
  embedding_model=excluded.embedding_model,
  source_file_uri=excluded.source_file_uri,
  segment_start_ms=excluded.segment_start_ms,
  segment_end_ms=excluded.segment_end_ms,
  updated_at=CURRENT_TIMESTAMP
`
  )
    .bind(
      doc.id,
      doc.userId,
      doc.sessionId,
      doc.clipId,
      `${(doc.segmentStartMs / 1000).toFixed(1)}s–${(doc.segmentEndMs / 1000).toFixed(1)}s`,
      doc.displayText,
      metadataJson,
      embeddingJson,
      doc.embeddingModel,
      doc.sourceFileUri,
      doc.segmentStartMs,
      doc.segmentEndMs,
      doc.createdAt ?? null
    )
    .run()
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function listCandidateDocs(db: D1Database, args: {
  userId: string
  namespaces: RetrievalNamespace[]
  limit: number
}): Promise<RetrievalDoc[]> {
  const ns = args.namespaces.length ? args.namespaces : (['ledger_summary'] as RetrievalNamespace[])
  const placeholders = ns.map(() => '?').join(', ')
  const limit = Math.max(1, Math.min(400, args.limit))

  const { results } = await db.prepare(
    `
SELECT id, user_id, namespace, source_id, session_id, clip_id, title, text,
       metadata_json, embedding_json, embedding_model, media_kind,
       source_file_uri, segment_start_ms, segment_end_ms,
       created_at, updated_at
FROM retrieval_docs
WHERE user_id = ? AND namespace IN (${placeholders})
ORDER BY created_at DESC
LIMIT ?
`
  )
    .bind(args.userId, ...ns, limit)
    .all<any>()

  return (results || []).map(mapRow)
}

export async function listVideoCandidates(db: D1Database, args: {
  userId: string
  limit: number
}): Promise<RetrievalDoc[]> {
  const limit = Math.max(1, Math.min(400, args.limit))

  const { results } = await db.prepare(
    `
SELECT id, user_id, namespace, source_id, session_id, clip_id, title, text,
       metadata_json, embedding_json, embedding_model, media_kind,
       source_file_uri, segment_start_ms, segment_end_ms,
       created_at, updated_at
FROM retrieval_docs
WHERE user_id = ? AND media_kind = 'video_segment'
ORDER BY created_at DESC
LIMIT ?
`
  )
    .bind(args.userId, limit)
    .all<any>()

  return (results || []).map(mapRow)
}

// ── Row mapper ──────────────────────────────────────────────────────────────

function mapRow(row: any): RetrievalDoc {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    namespace: row.namespace as RetrievalNamespace,
    sourceId: row.source_id ?? null,
    sessionId: row.session_id ?? null,
    clipId: row.clip_id ?? null,
    title: row.title ?? null,
    text: String(row.text || ''),
    metadata: safeJsonParse<Record<string, unknown>>(String(row.metadata_json || '{}'), {}),
    embedding: safeJsonParse<number[]>(String(row.embedding_json || '[]'), []),
    embeddingModel: row.embedding_model ?? null,
    mediaKind: row.media_kind ?? 'text',
    sourceFileUri: row.source_file_uri ?? null,
    segmentStartMs: typeof row.segment_start_ms === 'number' ? row.segment_start_ms : null,
    segmentEndMs: typeof row.segment_end_ms === 'number' ? row.segment_end_ms : null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  }
}
