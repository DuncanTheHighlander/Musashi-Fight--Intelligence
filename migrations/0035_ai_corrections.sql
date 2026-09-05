-- Teach Musashi Phase 1: exact-clip correction memory.
-- Extends coaching_feedback (thumbs reasons) and adds ai_corrections (Shogun teach → approve → reanalyze).

ALTER TABLE coaching_feedback ADD COLUMN card_section TEXT;
ALTER TABLE coaching_feedback ADD COLUMN error_categories_json TEXT;
ALTER TABLE coaching_feedback ADD COLUMN feedback_text TEXT;

CREATE TABLE IF NOT EXISTS ai_corrections (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  clip_id TEXT,
  video_fingerprint TEXT,
  ledger_id TEXT,
  response_type TEXT NOT NULL CHECK (response_type IN ('coach_card', 'chat')),
  response_ref TEXT,
  card_section TEXT,
  sport TEXT NOT NULL,
  focus_target TEXT,
  start_ms INTEGER,
  end_ms INTEGER,
  whole_clip INTEGER NOT NULL DEFAULT 0,
  original_text TEXT NOT NULL,
  correction_text TEXT NOT NULL,
  corrected_labels_json TEXT NOT NULL,
  correction_categories_json TEXT,
  coaching_note TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'gold', 'rejected', 'archived')),
  model_name TEXT,
  -- Phase 2: similar-clip retrieval scope. Unused in Phase 1.
  scope TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_corrections_owner_clip
  ON ai_corrections(owner_user_id, clip_id);
CREATE INDEX IF NOT EXISTS idx_ai_corrections_fingerprint
  ON ai_corrections(video_fingerprint);
CREATE INDEX IF NOT EXISTS idx_ai_corrections_status
  ON ai_corrections(status);
CREATE INDEX IF NOT EXISTS idx_ai_corrections_sport
  ON ai_corrections(sport);
