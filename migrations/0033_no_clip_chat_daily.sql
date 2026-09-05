-- Server-authoritative daily allowance for general coaching without a video.
-- A browser refresh must not reset the three-question Free limit.

CREATE TABLE IF NOT EXISTS musashi_no_clip_chat_daily (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id) REFERENCES musashi_users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_no_clip_chat_daily_day
  ON musashi_no_clip_chat_daily (day, updated_at);
