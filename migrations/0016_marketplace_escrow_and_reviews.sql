-- Migration number: 0016  2026-04-17
-- Musashi Marketplace — Escrow, Jobs, Multi-Dim Reviews, Disputes, Belt Tiers
--
-- Design notes:
--   * Extends (does NOT replace) existing `scouting_requests` + `breakdown_offers` from 0013.
--     A marketplace_job is the *contracted work* that flows from an accepted offer
--     (open_bounty) or from a direct hire (analyst pre-listed with a direct_hire_rate).
--   * All money values are stored in integer CENTS to avoid float drift.
--   * State machines are enforced in app code via assertTransition(); the CHECK
--     constraints here are the last line of defense, not the only one.
--   * Stripe integration is intentionally stubbed: the `marketplace_transactions`
--     ledger is event-sourced so we can back-fill real Stripe IDs later without
--     schema churn.
--   * The missing `purchases` table referenced by /api/social/offers is created
--     here as a minimal compatibility shim (bug fix carried in this migration).

-- ============================================================
-- 0. COMPATIBILITY SHIM — purchases table
-- ============================================================
-- /api/social/offers/route.ts writes to `purchases` on offer accept/complete,
-- but the table was never created in any earlier migration. This creates it
-- with the exact columns that route uses, so the existing accept flow stops
-- throwing. Long-term the marketplace_jobs table supersedes this.
CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  buyer_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'refunded', 'failed')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_purchases_buyer ON purchases(buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product_id, status);

-- ============================================================
-- 1. analyst_profiles — opt-in analyst layer on top of fighter_profiles
-- ============================================================
-- A user becomes an analyst when they flip is_analyst_enabled=1. Belt tier is
-- derived from lifetime reviews + completed jobs (computed in app code, denorm
-- cached here). Direct hire is a higher-friction pathway: requires belt_tier
-- >= required_minimum AND direct_hire_enabled=1 AND Stripe Connect active.
CREATE TABLE IF NOT EXISTS analyst_profiles (
  user_id TEXT PRIMARY KEY,
  is_analyst_enabled INTEGER NOT NULL DEFAULT 0,
  bio TEXT NOT NULL DEFAULT '',
  specialties TEXT NOT NULL DEFAULT '[]',        -- JSON: ['boxing','mma','bjj']
  languages TEXT NOT NULL DEFAULT '["en"]',      -- JSON array
  turnaround_hours INTEGER NOT NULL DEFAULT 72,  -- self-declared SLA
  direct_hire_enabled INTEGER NOT NULL DEFAULT 0,
  direct_hire_rate_cents INTEGER NOT NULL DEFAULT 0,
  -- Belt tier: white < blue < purple < brown < black < red (coral).
  -- Gating for direct-hire visibility and high-value bounties.
  belt_tier TEXT NOT NULL DEFAULT 'white'
    CHECK (belt_tier IN ('white','blue','purple','brown','black','red')),
  belt_score REAL NOT NULL DEFAULT 0,            -- composite avg * log(jobs)
  -- Stripe Connect (wired later — kept nullable so non-Stripe environments work)
  stripe_connect_id TEXT,
  stripe_payouts_enabled INTEGER NOT NULL DEFAULT 0,
  stripe_onboarding_completed_at TEXT,
  -- Denormalized stats (recomputed on job events)
  jobs_completed INTEGER NOT NULL DEFAULT 0,
  jobs_cancelled INTEGER NOT NULL DEFAULT 0,
  jobs_disputed INTEGER NOT NULL DEFAULT 0,
  total_earned_cents INTEGER NOT NULL DEFAULT 0,
  avg_tactical_accuracy REAL NOT NULL DEFAULT 0,
  avg_actionability REAL NOT NULL DEFAULT 0,
  avg_communication REAL NOT NULL DEFAULT 0,
  avg_overall REAL NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  -- Concurrency throttle: hard cap on in-flight jobs
  current_capacity INTEGER NOT NULL DEFAULT 0,
  max_capacity INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_analyst_profiles_enabled
  ON analyst_profiles(is_analyst_enabled, belt_tier, avg_overall DESC);
CREATE INDEX IF NOT EXISTS idx_analyst_profiles_direct_hire
  ON analyst_profiles(direct_hire_enabled, belt_tier, direct_hire_rate_cents);
CREATE INDEX IF NOT EXISTS idx_analyst_profiles_belt_score
  ON analyst_profiles(belt_score DESC, jobs_completed DESC);

-- ============================================================
-- 2. marketplace_jobs — the contracted work unit
-- ============================================================
-- State machine (enforced in lib/marketplace/stateMachine.ts):
--
--   CREATED ──► FUNDED ──► CLAIMED ──► IN_PROGRESS ──► SUBMITTED ──► APPROVED ──► RELEASED
--                                            │              │            │
--                                            ▼              ▼            ▼
--                                        DISPUTED ◄────────┘            RELEASED (auto)
--                                            │
--                                            ▼
--                                      RESOLVED_*  (refund / release / split)
--   Any state before SUBMITTED can short-circuit to CANCELLED (with refund).
--
CREATE TABLE IF NOT EXISTS marketplace_jobs (
  id TEXT PRIMARY KEY,
  -- Origin link (nullable: direct-hire jobs can skip the scouting_requests doc)
  scouting_request_id TEXT,
  breakdown_offer_id TEXT,
  fighter_id TEXT NOT NULL,
  analyst_id TEXT,                    -- nullable until CLAIMED
  job_type TEXT NOT NULL
    CHECK (job_type IN ('open_bounty','direct_hire')),
  -- For open_bounty: minimum belt an analyst must hold to claim.
  -- For direct_hire: the analyst's current belt at time of booking.
  required_belt_tier TEXT NOT NULL DEFAULT 'white'
    CHECK (required_belt_tier IN ('white','blue','purple','brown','black','red')),
  title TEXT NOT NULL,
  brief TEXT NOT NULL DEFAULT '',
  videos TEXT NOT NULL DEFAULT '[]',          -- JSON array of asset URLs/ids
  -- Money (integer cents)
  amount_cents INTEGER NOT NULL DEFAULT 0,
  platform_fee_bps INTEGER NOT NULL DEFAULT 1500,   -- 15% default
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  analyst_payout_cents INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  -- Lifecycle state
  status TEXT NOT NULL DEFAULT 'CREATED' CHECK (status IN (
    'CREATED',
    'FUNDED',
    'CLAIMED',
    'IN_PROGRESS',
    'SUBMITTED',
    'APPROVED',
    'RELEASED',
    'DISPUTED',
    'RESOLVED_REFUND',
    'RESOLVED_RELEASE',
    'RESOLVED_SPLIT',
    'CANCELLED',
    'EXPIRED'
  )),
  -- Deliverable
  deliverable_url TEXT,
  deliverable_notes TEXT,
  submitted_at TEXT,
  approved_at TEXT,
  released_at TEXT,
  -- Deadlines (all ISO-8601 strings)
  claim_deadline_at TEXT,             -- bounties expire if not claimed
  delivery_deadline_at TEXT,          -- analyst must submit by this
  approval_deadline_at TEXT,          -- auto-release if fighter stalls
  -- Idempotency — dedup client-side retries of create/fund
  client_request_id TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (fighter_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (analyst_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (scouting_request_id) REFERENCES scouting_requests(id) ON DELETE SET NULL,
  FOREIGN KEY (breakdown_offer_id) REFERENCES breakdown_offers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_fighter ON marketplace_jobs(fighter_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_analyst ON marketplace_jobs(analyst_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_status_type ON marketplace_jobs(status, job_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_claim_deadline ON marketplace_jobs(status, claim_deadline_at);
CREATE INDEX IF NOT EXISTS idx_jobs_approval_deadline ON marketplace_jobs(status, approval_deadline_at);
CREATE INDEX IF NOT EXISTS idx_jobs_scouting ON marketplace_jobs(scouting_request_id);
CREATE INDEX IF NOT EXISTS idx_jobs_client_request ON marketplace_jobs(client_request_id);

-- ============================================================
-- 3. marketplace_transactions — event-sourced escrow ledger
-- ============================================================
-- Every money movement (real or pending) appends a row. The job's balance is
-- derived by summing entries. This lets us:
--   * Reconcile with Stripe after the fact (back-fill stripe_* columns)
--   * Run without Stripe in dev (status='pending_stripe', no real charge)
--   * Audit every change to every dollar
--
-- Sign convention: positive cents = money INTO escrow from fighter's perspective.
-- A RELEASE entry is negative (money leaves escrow to analyst).
CREATE TABLE IF NOT EXISTS marketplace_transactions (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  -- What happened
  type TEXT NOT NULL CHECK (type IN (
    'HOLD',            -- funds locked in escrow (payment intent authorized)
    'CAPTURE',         -- authorization captured (funds now sitting with platform)
    'RELEASE',         -- funds transferred to analyst
    'PLATFORM_FEE',    -- platform's cut
    'REFUND',          -- funds returned to fighter
    'PARTIAL_REFUND',  -- split resolution
    'PAYOUT',          -- Stripe Connect transfer to analyst
    'CHARGEBACK',      -- Stripe dispute / fraud
    'ADJUSTMENT'       -- manual admin correction
  )),
  amount_cents INTEGER NOT NULL,   -- signed
  currency TEXT NOT NULL DEFAULT 'USD',
  -- Stripe linkage (nullable — set when real Stripe call completes)
  stripe_payment_intent_id TEXT,
  stripe_charge_id TEXT,
  stripe_transfer_id TEXT,
  stripe_refund_id TEXT,
  -- Operational state (so we can ledger-first and sync to Stripe async)
  status TEXT NOT NULL DEFAULT 'pending_stripe' CHECK (status IN (
    'pending_stripe',  -- ledger row written, Stripe call not yet attempted
    'processing',      -- Stripe call in flight
    'succeeded',
    'failed',
    'reversed'
  )),
  failure_reason TEXT,
  -- Idempotency key — Stripe requires this for safe retries
  idempotency_key TEXT UNIQUE NOT NULL,
  actor_user_id TEXT,              -- who triggered it (nullable for cron/system)
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES marketplace_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_txn_job ON marketplace_transactions(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_status ON marketplace_transactions(status, type, created_at);
CREATE INDEX IF NOT EXISTS idx_txn_stripe_pi ON marketplace_transactions(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_txn_idempotency ON marketplace_transactions(idempotency_key);

-- ============================================================
-- 4. marketplace_reviews — multi-dimensional feedback (1-5 each)
-- ============================================================
-- One review per job from the fighter. Feeds into the analyst's belt_score.
-- Tactical Accuracy: was the analysis technically correct?
-- Actionability:     could you actually train on the notes?
-- Communication:     clear, respectful, professional?
CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,     -- one review per job, max
  reviewer_id TEXT NOT NULL,       -- fighter
  analyst_id TEXT NOT NULL,        -- target
  tactical_accuracy INTEGER NOT NULL
    CHECK (tactical_accuracy >= 1 AND tactical_accuracy <= 5),
  actionability INTEGER NOT NULL
    CHECK (actionability >= 1 AND actionability <= 5),
  communication INTEGER NOT NULL
    CHECK (communication >= 1 AND communication <= 5),
  avg_score REAL NOT NULL,          -- denormalized (ta+act+com)/3
  comment TEXT NOT NULL DEFAULT '',
  would_hire_again INTEGER NOT NULL DEFAULT 1,
  -- Moderation
  is_hidden INTEGER NOT NULL DEFAULT 0,
  hidden_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES marketplace_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (analyst_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reviews_analyst
  ON marketplace_reviews(analyst_id, is_hidden, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewer
  ON marketplace_reviews(reviewer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reviews_scores
  ON marketplace_reviews(analyst_id, avg_score DESC);

-- ============================================================
-- 5. marketplace_disputes — escalation + admin resolution queue
-- ============================================================
-- One open dispute per job. Resolution writes back to the job (status=RESOLVED_*)
-- and appends the appropriate transaction ledger entries.
CREATE TABLE IF NOT EXISTS marketplace_disputes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL UNIQUE,
  opened_by_id TEXT NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN (
    'not_delivered',
    'poor_quality',
    'off_brief',
    'late',
    'plagiarism',
    'harassment',
    'fraud',
    'other'
  )),
  description TEXT NOT NULL,
  evidence_urls TEXT NOT NULL DEFAULT '[]',   -- JSON array
  counter_statement TEXT,                      -- analyst's response
  counter_evidence_urls TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN (
    'OPEN',
    'UNDER_REVIEW',
    'RESOLVED_REFUND',
    'RESOLVED_RELEASE',
    'RESOLVED_SPLIT',
    'DISMISSED'
  )),
  -- Split resolution amounts (only populated for RESOLVED_SPLIT)
  refund_amount_cents INTEGER,
  payout_amount_cents INTEGER,
  resolver_id TEXT,                 -- admin who resolved
  resolved_at TEXT,
  resolution_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES marketplace_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (opened_by_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (resolver_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_disputes_status
  ON marketplace_disputes(status, created_at);
CREATE INDEX IF NOT EXISTS idx_disputes_opened_by
  ON marketplace_disputes(opened_by_id, created_at DESC);

-- ============================================================
-- 6. marketplace_job_events — immutable audit log (complements transactions)
-- ============================================================
-- Transactions track money. Events track every state transition, claim, edit,
-- evidence upload, etc. Together they form the full history of a job.
CREATE TABLE IF NOT EXISTS marketplace_job_events (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  event_type TEXT NOT NULL,         -- 'STATE_CHANGE', 'CLAIM', 'SUBMIT', 'EVIDENCE_ADDED', etc.
  from_status TEXT,
  to_status TEXT,
  actor_user_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',   -- JSON context (deliverable_url, reason, etc.)
  created_at TEXT NOT NULL,
  FOREIGN KEY (job_id) REFERENCES marketplace_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_job_events_job
  ON marketplace_job_events(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_events_type
  ON marketplace_job_events(event_type, created_at DESC);
