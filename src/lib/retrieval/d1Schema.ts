/**
 * D1 schema for retrieval memory.
 *
 * Note: D1/SQLite doesn't provide native vector similarity. We store embeddings as JSON and
 * do cosine similarity in application code on a capped candidate set.
 */

export const RETRIEVAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS retrieval_docs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  source_id TEXT,
  session_id TEXT,
  clip_id TEXT,
  title TEXT,
  text TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}',
  embedding_json TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  media_kind TEXT NOT NULL DEFAULT 'text',
  source_file_uri TEXT,
  segment_start_ms INTEGER,
  segment_end_ms INTEGER,
  created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
  updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
);

CREATE INDEX IF NOT EXISTS idx_retrieval_docs_user_namespace_created
  ON retrieval_docs(user_id, namespace, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_retrieval_docs_session
  ON retrieval_docs(user_id, session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_retrieval_docs_clip
  ON retrieval_docs(user_id, clip_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_retrieval_docs_media_kind
  ON retrieval_docs(user_id, media_kind, namespace, created_at DESC);
`
