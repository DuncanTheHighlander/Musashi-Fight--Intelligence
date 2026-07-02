-- Migration number: 0026  2026-06-29
-- Per-clip follow-up question cap (free 3 / Pro 15 per analyzed clip)

CREATE TABLE IF NOT EXISTS musashi_clip_questions (
  user_id TEXT NOT NULL,
  clip_key TEXT NOT NULL,
  question_count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, clip_key),
  FOREIGN KEY (user_id) REFERENCES musashi_users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_musashi_clip_questions_user ON musashi_clip_questions(user_id);
