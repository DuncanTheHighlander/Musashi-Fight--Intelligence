-- Migration 0021: Marketplace upload assets (R2-backed, mock-friendly in dev)
--
-- Tracks uploaded job videos, deliverables, dispute evidence, and profile media.
-- object_key is the storage path; videos/deliverables reference assets as asset:<id>.

CREATE TABLE IF NOT EXISTS marketplace_assets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  job_id TEXT,
  dispute_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('job_video','deliverable','dispute_evidence','profile_media')),
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

CREATE INDEX IF NOT EXISTS idx_marketplace_assets_owner
  ON marketplace_assets(owner_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_assets_job
  ON marketplace_assets(job_id, purpose, status);
CREATE INDEX IF NOT EXISTS idx_marketplace_assets_dispute
  ON marketplace_assets(dispute_id, purpose, status);
