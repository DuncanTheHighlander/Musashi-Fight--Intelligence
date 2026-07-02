-- Migration 0025: Gyms (team seats) + unified analysis credits.
--
-- Replaces the per-video lifetime/weekly counters (0023) as the spend unit:
-- 1 credit = one AI video analysis of <= 30s. Credits are poolable (gym) and
-- stackable (personal + gym). Old 0023 tables remain for back-compat but are
-- no longer the source of truth for enforcement.

-- A gym/team that buys seats. The owner pays; attached members analyze for free
-- against the gym's shared monthly credit pool.
CREATE TABLE IF NOT EXISTS musashi_gyms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  seats_purchased INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','past_due','canceled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (owner_user_id) REFERENCES musashi_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_musashi_gyms_owner ON musashi_gyms(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_musashi_gyms_sub ON musashi_gyms(stripe_subscription_id);

-- Membership. status='disabled' is the gym's on/off toggle (keeps the seat but
-- blocks the member); removed_at set means fully removed (seat freed).
CREATE TABLE IF NOT EXISTS musashi_gym_members (
  gym_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  removed_at TEXT,
  PRIMARY KEY (gym_id, user_id),
  FOREIGN KEY (gym_id) REFERENCES musashi_gyms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES musashi_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_musashi_gym_members_user ON musashi_gym_members(user_id, status);

-- Email invites to join a gym (same hashed-token shape as auth_email_tokens).
CREATE TABLE IF NOT EXISTS musashi_gym_invites (
  id TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL,
  email TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  expires_at TEXT NOT NULL,
  accepted_user_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (gym_id) REFERENCES musashi_gyms(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_musashi_gym_invites_gym ON musashi_gym_invites(gym_id, status);
CREATE INDEX IF NOT EXISTS idx_musashi_gym_invites_email ON musashi_gym_invites(email, status);

-- Unified credit ledger. One row per (scope, scope_id, period, source).
--   scope 'user'  + source 'free'     : one-time lifetime grant (period 'lifetime')
--   scope 'user'  + source 'pro'      : monthly Pro allotment   (period 'YYYY-MM')
--   scope 'user'  + source 'grant'    : admin one-off user grant
--   scope 'gym'   + source 'gym_seat' : monthly pool = seats * per-seat credits
--   scope 'gym'   + source 'grant'    : admin one-off gym grant
CREATE TABLE IF NOT EXISTS musashi_credit_balances (
  scope TEXT NOT NULL CHECK (scope IN ('user','gym')),
  scope_id TEXT NOT NULL,
  period_month TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('free','pro','gym_seat','grant')),
  granted INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (scope, scope_id, period_month, source)
);
CREATE INDEX IF NOT EXISTS idx_musashi_credit_balances_scope
  ON musashi_credit_balances(scope, scope_id, period_month);
