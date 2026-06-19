-- Migration number: 0003	 2025-12-13
-- Musashi Fight App: Auth, Roles (user/shogun), Sessions, Usage + Rate Limits

-- Musashi-specific users (separate from legacy cleaning-app users table)
CREATE TABLE IF NOT EXISTS musashi_users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'shogun')),
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Signed session records (token is stored client-side as cookie; we keep a server record for revocation)
CREATE TABLE IF NOT EXISTS musashi_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME,
  user_agent TEXT,
  ip TEXT,
  FOREIGN KEY (user_id) REFERENCES musashi_users (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_musashi_sessions_user_id ON musashi_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_musashi_sessions_expires_at ON musashi_sessions(expires_at);

-- Per-user daily usage counters (cheap and easy quotas)
CREATE TABLE IF NOT EXISTS musashi_usage_daily (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  analyze_count INTEGER NOT NULL DEFAULT 0,
  chat_count INTEGER NOT NULL DEFAULT 0,
  reflex_count INTEGER NOT NULL DEFAULT 0,
  track_count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, day),
  FOREIGN KEY (user_id) REFERENCES musashi_users (id) ON DELETE CASCADE
);

-- Per-user per-minute buckets for basic rate limiting
CREATE TABLE IF NOT EXISTS musashi_rate_limit_minute (
  user_id TEXT NOT NULL,
  bucket_minute INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, bucket_minute),
  FOREIGN KEY (user_id) REFERENCES musashi_users (id) ON DELETE CASCADE
);

-- Limits (set per-user; if missing use defaults in code)
CREATE TABLE IF NOT EXISTS musashi_user_limits (
  user_id TEXT PRIMARY KEY,
  daily_analyze_limit INTEGER,
  daily_chat_limit INTEGER,
  daily_reflex_limit INTEGER,
  daily_track_limit INTEGER,
  per_minute_limit INTEGER,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES musashi_users (id) ON DELETE CASCADE
);
