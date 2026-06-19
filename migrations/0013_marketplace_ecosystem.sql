-- Migration: Marketplace Ecosystem Enhancement
-- Extends scouting_requests into fight posts, adds breakdown offers,
-- and enhances reviews for two-phase coach feedback system.

-- ============================================================
-- 1. Extend scouting_requests for marketplace integration
-- ============================================================
ALTER TABLE scouting_requests ADD COLUMN budget REAL DEFAULT 0;
ALTER TABLE scouting_requests ADD COLUMN visibility TEXT DEFAULT 'public'
  CHECK (visibility IN ('public', 'targeted'));
ALTER TABLE scouting_requests ADD COLUMN opponent_videos TEXT DEFAULT '[]';

-- ============================================================
-- 2. Breakdown offers from coaches
-- ============================================================
CREATE TABLE IF NOT EXISTS breakdown_offers (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  coach_id TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  estimated_delivery TEXT,
  status TEXT DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'completed', 'declined')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES scouting_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (coach_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 3. Extend reviews for two-phase coach feedback
-- ============================================================
-- reviews was previously only defined in src/lib/database.sql (never a
-- migration), which made the ALTER TABLE statements below fail on a fresh
-- database. Create the base table here so the chain applies cleanly.
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  reviewer_id TEXT NOT NULL,
  target_id TEXT NOT NULL, -- user_id or product_id
  target_type TEXT NOT NULL CHECK (target_type IN ('user', 'product')),
  rating REAL NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_reviews_target_id ON reviews(target_id);
CREATE INDEX IF NOT EXISTS idx_reviews_target_type ON reviews(target_type);

ALTER TABLE reviews ADD COLUMN review_phase TEXT DEFAULT NULL
  CHECK (review_phase IN ('pre_fight', 'post_fight'));
ALTER TABLE reviews ADD COLUMN fight_outcome TEXT DEFAULT NULL
  CHECK (fight_outcome IN ('win', 'loss', 'draw'));
ALTER TABLE reviews ADD COLUMN coaching_session_id TEXT DEFAULT NULL;
ALTER TABLE reviews ADD COLUMN advice_effectiveness INTEGER DEFAULT NULL
  CHECK (advice_effectiveness >= 1 AND advice_effectiveness <= 5);

-- ============================================================
-- 4. Indexes for new columns and tables
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_breakdown_offers_request ON breakdown_offers(request_id);
CREATE INDEX IF NOT EXISTS idx_breakdown_offers_coach ON breakdown_offers(coach_id, status);
CREATE INDEX IF NOT EXISTS idx_breakdown_offers_status ON breakdown_offers(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_phase ON reviews(review_phase, target_id);
CREATE INDEX IF NOT EXISTS idx_reviews_coaching ON reviews(coaching_session_id);
CREATE INDEX IF NOT EXISTS idx_scouting_budget ON scouting_requests(budget, status);
CREATE INDEX IF NOT EXISTS idx_scouting_visibility ON scouting_requests(visibility, created_at DESC);
