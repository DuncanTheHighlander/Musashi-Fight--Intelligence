-- Migration number: 0017  2026-06-09
-- Follows table + users/musashi_users sync
--
-- 1. `follows` was referenced by the social design (src/lib/database.sql) but
--    never created by any migration.
-- 2. Auth writes accounts to `musashi_users`, while the social/marketplace
--    tables (fighter_profiles, marketplace_jobs, content_products, ...) all
--    have FOREIGN KEYs to the legacy `users` table from 0001. Backfill every
--    musashi user into `users` so those FKs hold for real signups. The app
--    also mirrors new registrations into `users` at register/login time
--    (see src/lib/musashiAuth.ts).

CREATE TABLE IF NOT EXISTS follows (
  id TEXT PRIMARY KEY,
  follower_id TEXT NOT NULL,
  following_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (follower_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (following_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(follower_id, following_id)
);

CREATE INDEX IF NOT EXISTS idx_follows_follower_id ON follows(follower_id);
CREATE INDEX IF NOT EXISTS idx_follows_following_id ON follows(following_id);

-- Backfill: mirror existing musashi_users into the legacy users table.
-- The legacy schema requires role IN ('admin','manager','cleaner','client')
-- plus NOT NULL password_hash/first_name/last_name, so we satisfy it with
-- neutral placeholder values ('client' role; auth still lives in musashi_users).
INSERT INTO users (id, role, email, password_hash, first_name, last_name, created_at, updated_at)
SELECT
  m.id,
  'client',
  m.email,
  '',
  COALESCE(m.display_name, ''),
  '',
  m.created_at,
  m.updated_at
FROM musashi_users m
WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.id)
  AND NOT EXISTS (SELECT 1 FROM users u2 WHERE u2.email = m.email);
