-- Migration 0027: allow 'analysis_clip' in marketplace_assets.purpose
--
-- The review/labeling pipeline (FightCoachExperience clip auto-save +
-- /api/uploads) writes purpose='analysis_clip', but 0021 created the table
-- with a CHECK that only allows the four marketplace purposes. Every clip
-- auto-save failed with "CHECK constraint failed" (fail-safe warn, so
-- analysis kept working but /review had no clips to review).
--
-- SQLite can't alter a CHECK constraint, so rebuild the table in place.

CREATE TABLE marketplace_assets_new (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  job_id TEXT,
  dispute_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('job_video','deliverable','dispute_evidence','profile_media','analysis_clip')),
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending_upload'
    CHECK (status IN ('pending_upload','uploaded','failed','deleted')),
  created_at TEXT NOT NULL,
  uploaded_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES marketplace_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (dispute_id) REFERENCES marketplace_disputes(id) ON DELETE CASCADE
);

INSERT INTO marketplace_assets_new SELECT * FROM marketplace_assets;

DROP TABLE marketplace_assets;

ALTER TABLE marketplace_assets_new RENAME TO marketplace_assets;

CREATE INDEX IF NOT EXISTS idx_marketplace_assets_owner
  ON marketplace_assets(owner_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_assets_job
  ON marketplace_assets(job_id, purpose, status);
CREATE INDEX IF NOT EXISTS idx_marketplace_assets_dispute
  ON marketplace_assets(dispute_id, purpose, status);
