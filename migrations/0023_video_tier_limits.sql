-- Migration number: 0023  2026-06-23
-- Per-user video analysis tier limits (free lifetime + Pro weekly)

-- Lifetime free-tier video analyses (free users get exactly 1)
CREATE TABLE IF NOT EXISTS musashi_video_lifetime (
  user_id TEXT PRIMARY KEY,
  free_videos_used INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES musashi_users (id) ON DELETE CASCADE
);

-- Pro weekly video analysis counter (resets each ISO week, Monday UTC)
CREATE TABLE IF NOT EXISTS musashi_video_weekly (
  user_id TEXT NOT NULL,
  week_start TEXT NOT NULL,
  video_count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, week_start),
  FOREIGN KEY (user_id) REFERENCES musashi_users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_musashi_video_weekly_user ON musashi_video_weekly(user_id);

-- Dedupe: follow-up chat/coaching on the same clip must not re-charge video quota
CREATE TABLE IF NOT EXISTS musashi_video_clips_consumed (
  user_id TEXT NOT NULL,
  clip_key TEXT NOT NULL,
  consumed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, clip_key),
  FOREIGN KEY (user_id) REFERENCES musashi_users (id) ON DELETE CASCADE
);

-- Optional per-user overrides (NULL = use code defaults)
ALTER TABLE musashi_user_limits ADD COLUMN weekly_video_limit INTEGER;
ALTER TABLE musashi_user_limits ADD COLUMN max_video_duration_sec INTEGER;
