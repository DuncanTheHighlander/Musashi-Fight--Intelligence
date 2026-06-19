-- Migration 0018: Ledger persistence + human corrections (learning loop)
-- Every compiled FightLang ledger is saved; humans confirm/reject/relabel the
-- detected items. The corrections accumulate into a proprietary labeled
-- dataset used to tune detector thresholds and, later, train learned detectors.

CREATE TABLE IF NOT EXISTS fight_analysis_ledgers (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  source_id TEXT,
  video_file_name TEXT,
  clip_duration_ms INTEGER,
  event_count INTEGER NOT NULL DEFAULT 0,
  fault_count INTEGER NOT NULL DEFAULT 0,
  pattern_count INTEGER NOT NULL DEFAULT 0,
  ledger_json TEXT NOT NULL, -- symbolic layers only (actors/clip/events/faults/patterns); no raw pose frames
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_ledgers_created ON fight_analysis_ledgers(created_at);
CREATE INDEX IF NOT EXISTS idx_analysis_ledgers_user ON fight_analysis_ledgers(user_id);

CREATE TABLE IF NOT EXISTS ledger_corrections (
  id TEXT PRIMARY KEY,
  ledger_id TEXT NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('event', 'fault', 'pattern')),
  item_id TEXT NOT NULL,
  original_kind TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('confirm', 'reject', 'relabel')),
  corrected_kind TEXT,
  actor_id TEXT,
  note TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (ledger_id) REFERENCES fight_analysis_ledgers(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ledger_corrections_ledger ON ledger_corrections(ledger_id);
CREATE INDEX IF NOT EXISTS idx_ledger_corrections_verdict ON ledger_corrections(verdict);
