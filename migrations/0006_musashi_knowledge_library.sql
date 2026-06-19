CREATE TABLE IF NOT EXISTS musashi_library_documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'manual',
  author TEXT,
  tags TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',
  content TEXT NOT NULL,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  vector_count INTEGER NOT NULL DEFAULT 0,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_musashi_library_documents_status ON musashi_library_documents(status);
CREATE INDEX IF NOT EXISTS idx_musashi_library_documents_created ON musashi_library_documents(created_at);

CREATE TABLE IF NOT EXISTS musashi_library_ingestions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES musashi_library_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_musashi_library_ingestions_status ON musashi_library_ingestions(status);

CREATE TABLE IF NOT EXISTS musashi_library_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  vector_id TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES musashi_library_documents(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_musashi_library_chunks_doc_idx ON musashi_library_chunks(document_id, chunk_index);

CREATE TABLE IF NOT EXISTS musashi_activity_log (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  subtype TEXT,
  reference_id TEXT,
  metadata TEXT DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_musashi_activity_type ON musashi_activity_log(type, created_at DESC);
