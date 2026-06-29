/**
 * marketplace/types.ts
 *
 * Row shapes + shared DB binding type for the marketplace module.
 * Mirrors columns defined in migration 0016_marketplace_escrow_and_reviews.sql.
 */

import type { BeltTier } from './beltTier'
import type { JobStatus } from './stateMachine'

export type { D1Database } from '@/lib/db'
export { getDb, getDbOrNull } from '@/lib/db'

// ──────────────────────────────────────────────────────────────────────────
// analyst_profiles
// ──────────────────────────────────────────────────────────────────────────
export interface AnalystProfileRow {
  user_id: string
  is_analyst_enabled: number
  bio: string
  specialties: string          // JSON
  languages: string            // JSON
  turnaround_hours: number
  direct_hire_enabled: number
  direct_hire_rate_cents: number
  belt_tier: BeltTier
  belt_score: number
  stripe_connect_id: string | null
  stripe_payouts_enabled: number
  stripe_onboarding_completed_at: string | null
  jobs_completed: number
  jobs_cancelled: number
  jobs_disputed: number
  total_earned_cents: number
  avg_tactical_accuracy: number
  avg_actionability: number
  avg_communication: number
  avg_overall: number
  review_count: number
  current_capacity: number
  max_capacity: number
  created_at: string
  updated_at: string
}

// ──────────────────────────────────────────────────────────────────────────
// marketplace_jobs
// ──────────────────────────────────────────────────────────────────────────
export type JobType = 'open_bounty' | 'direct_hire'

export interface MarketplaceJobRow {
  id: string
  scouting_request_id: string | null
  breakdown_offer_id: string | null
  fighter_id: string
  analyst_id: string | null
  job_type: JobType
  required_belt_tier: BeltTier
  title: string
  brief: string
  videos: string               // JSON
  amount_cents: number
  platform_fee_bps: number
  platform_fee_cents: number
  analyst_payout_cents: number
  currency: string
  status: JobStatus
  deliverable_url: string | null
  deliverable_notes: string | null
  submitted_at: string | null
  approved_at: string | null
  released_at: string | null
  claim_deadline_at: string | null
  delivery_deadline_at: string | null
  approval_deadline_at: string | null
  client_request_id: string | null
  created_at: string
  updated_at: string
}

// ──────────────────────────────────────────────────────────────────────────
// marketplace_transactions
// ──────────────────────────────────────────────────────────────────────────
export interface MarketplaceTransactionRow {
  id: string
  job_id: string
  type: string
  amount_cents: number
  currency: string
  stripe_payment_intent_id: string | null
  stripe_charge_id: string | null
  stripe_transfer_id: string | null
  stripe_refund_id: string | null
  status: string
  failure_reason: string | null
  idempotency_key: string
  actor_user_id: string | null
  metadata: string // JSON
  created_at: string
  updated_at: string
}

// ──────────────────────────────────────────────────────────────────────────
// marketplace_reviews
// ──────────────────────────────────────────────────────────────────────────
export interface MarketplaceReviewRow {
  id: string
  job_id: string
  reviewer_id: string
  analyst_id: string
  tactical_accuracy: number
  actionability: number
  communication: number
  avg_score: number
  comment: string
  would_hire_again: number
  is_hidden: number
  hidden_reason: string | null
  created_at: string
  updated_at: string
}

// ──────────────────────────────────────────────────────────────────────────
// marketplace_disputes
// ──────────────────────────────────────────────────────────────────────────
export type DisputeStatus =
  | 'OPEN'
  | 'UNDER_REVIEW'
  | 'RESOLVED_REFUND'
  | 'RESOLVED_RELEASE'
  | 'RESOLVED_SPLIT'
  | 'DISMISSED'

export type DisputeReason =
  | 'not_delivered'
  | 'poor_quality'
  | 'off_brief'
  | 'late'
  | 'plagiarism'
  | 'harassment'
  | 'fraud'
  | 'other'

export interface MarketplaceDisputeRow {
  id: string
  job_id: string
  opened_by_id: string
  reason: DisputeReason
  description: string
  evidence_urls: string
  counter_statement: string | null
  counter_evidence_urls: string
  status: DisputeStatus
  refund_amount_cents: number | null
  payout_amount_cents: number | null
  resolver_id: string | null
  resolved_at: string | null
  resolution_notes: string | null
  created_at: string
  updated_at: string
}

// ──────────────────────────────────────────────────────────────────────────
// marketplace_job_events
// ──────────────────────────────────────────────────────────────────────────
export interface JobEventRow {
  id: string
  job_id: string
  event_type: string
  from_status: string | null
  to_status: string | null
  actor_user_id: string | null
  payload: string
  created_at: string
}

// ──────────────────────────────────────────────────────────────────────────
// marketplace_assets
// ──────────────────────────────────────────────────────────────────────────
export type MarketplaceAssetPurpose =
  | 'job_video'
  | 'deliverable'
  | 'dispute_evidence'
  | 'profile_media'
  | 'analysis_clip'

export type MarketplaceAssetStatus =
  | 'pending_upload'
  | 'uploaded'
  | 'failed'
  | 'deleted'

export interface MarketplaceAssetRow {
  id: string
  owner_user_id: string
  job_id: string | null
  dispute_id: string | null
  purpose: MarketplaceAssetPurpose
  bucket: string
  object_key: string
  original_name: string
  content_type: string
  size_bytes: number
  sha256: string | null
  status: MarketplaceAssetStatus
  created_at: string
  uploaded_at: string | null
  updated_at: string
}

// ──────────────────────────────────────────────────────────────────────────
// small id helper shared across routes
// ──────────────────────────────────────────────────────────────────────────
export const newId = (prefix = ''): string => {
  try {
    return prefix ? `${prefix}_${crypto.randomUUID()}` : crypto.randomUUID()
  } catch {
    const rand = `${Date.now()}_${Math.random().toString(16).slice(2)}`
    return prefix ? `${prefix}_${rand}` : rand
  }
}
