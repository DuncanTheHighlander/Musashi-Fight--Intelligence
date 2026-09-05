-- Credit lifecycle for native AI video analysis.
-- A reservation protects a short-lived upload attempt; a credit is only
-- consumed after the provider returns an ACTIVE/usable video file.
CREATE TABLE IF NOT EXISTS musashi_video_analysis_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('reserved', 'consumed', 'released')),
  tier TEXT NOT NULL,
  clip_duration_sec REAL NOT NULL,
  clip_key TEXT,
  week_start TEXT,
  reserved_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME,
  released_at DATETIME,
  failure_code TEXT,
  FOREIGN KEY (user_id) REFERENCES musashi_users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_video_analysis_sessions_active
  ON musashi_video_analysis_sessions (user_id, state, expires_at);
CREATE INDEX IF NOT EXISTS idx_video_analysis_sessions_week
  ON musashi_video_analysis_sessions (user_id, week_start, state, expires_at);
