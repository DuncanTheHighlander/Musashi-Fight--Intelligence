-- Migration number: 0024  2026-06-27
-- Technique clips: many tagged video instances per technique_entries row
-- (OutlierDB-style clip library). YouTube clips are embedded via the
-- official player and never downloaded; owned clips point at R2 objects.

CREATE TABLE IF NOT EXISTS technique_clips (
  id TEXT PRIMARY KEY,
  technique_id TEXT NOT NULL,
  discipline TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('youtube', 'owned')),
  youtube_video_id TEXT,          -- set when source_type = 'youtube'
  r2_object_key TEXT,             -- set when source_type = 'owned'
  start_sec REAL NOT NULL,
  end_sec REAL NOT NULL,
  label TEXT NOT NULL,            -- short human-readable caption Gemini/curator gave this moment
  confidence REAL,                -- model confidence when auto-tagged, null when manually curated
  verified INTEGER NOT NULL DEFAULT 0,  -- 1 once a human has spot-checked it
  tags TEXT DEFAULT '[]',
  metadata TEXT DEFAULT '{}',     -- e.g. { sourceChannel, sourceTitle, taggedBy: 'gemini'|'manual' }
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (technique_id) REFERENCES technique_entries(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_technique_clips_technique ON technique_clips(technique_id);
CREATE INDEX IF NOT EXISTS idx_technique_clips_discipline ON technique_clips(discipline);
