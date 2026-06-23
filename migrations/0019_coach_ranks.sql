-- Migration number: 0019  2026-06-19
-- Musashi Coach Rank — earned (sticky) belt storage, Quality Reviewer grants,
-- and a promotion/award audit log.
--
-- Design notes:
--   * The belt a customer sees is the EARNED belt here (ratchets up, never auto
--     demoted). Stripes / leaderboard order are still computed live from form;
--     this table only stores the sticky credential + promotion bookkeeping.
--   * Promotion logic lives in lib/marketplace/coachPromotion.ts; the sweep that
--     writes here runs from the marketplace cron.
--   * Quality Reviewers are granted by a shogun. They may be coaches or staff —
--     so this is a per-user grant table, NOT a change to the musashi_users role.

-- ============================================================
-- 1. coach_ranks — the sticky earned belt per coach
-- ============================================================
CREATE TABLE IF NOT EXISTS coach_ranks (
  user_id TEXT PRIMARY KEY,
  earned_belt_key TEXT NOT NULL DEFAULT 'white'
    CHECK (earned_belt_key IN ('white','gray','yellow','blue','purple','brown','black','coral','red')),
  earned_rank_index INTEGER NOT NULL DEFAULT 0,
  held_since TEXT NOT NULL,            -- time-in-grade clock; resets on promotion
  promoted_at TEXT,                    -- last promotion timestamp
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive')),
  -- Set when metrics qualify a coach for a review-gated belt (Black+); cleared
  -- on approve/hold. NULL = nothing awaiting Quality Review.
  pending_review_belt TEXT
    CHECK (pending_review_belt IN ('white','gray','yellow','blue','purple','brown','black','coral','red')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_coach_ranks_pending ON coach_ranks(pending_review_belt);
CREATE INDEX IF NOT EXISTS idx_coach_ranks_belt ON coach_ranks(earned_belt_key);

-- ============================================================
-- 2. coach_rank_reviewers — who may perform a Musashi Quality Review
-- ============================================================
-- A shogun is always allowed (checked in code). This table holds the extra
-- reviewers a shogun appoints — other coaches or company staff.
CREATE TABLE IF NOT EXISTS coach_rank_reviewers (
  user_id TEXT PRIMARY KEY,
  granted_by TEXT,
  granted_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (granted_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- 3. coach_rank_events — promotion / award / review audit log
-- ============================================================
CREATE TABLE IF NOT EXISTS coach_rank_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  event_type TEXT NOT NULL,            -- PROMOTION, REVIEW_QUEUED, REVIEW_APPROVED,
                                       -- REVIEW_HELD, HAND_AWARD, REVIEWER_GRANTED, REVIEWER_REVOKED
  from_belt TEXT,
  to_belt TEXT,
  actor_user_id TEXT,                  -- NULL for the automated cron sweep
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_coach_rank_events_user ON coach_rank_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coach_rank_events_type ON coach_rank_events(event_type, created_at DESC);
