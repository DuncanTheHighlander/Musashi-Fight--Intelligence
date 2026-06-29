-- Migration 0022: Email verification and password reset tokens

ALTER TABLE musashi_users ADD COLUMN email_verified_at TEXT;
ALTER TABLE musashi_users ADD COLUMN password_updated_at TEXT;

CREATE TABLE IF NOT EXISTS auth_email_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'password_reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES musashi_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_user
  ON auth_email_tokens(user_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_hash
  ON auth_email_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_expires
  ON auth_email_tokens(expires_at, used_at);
