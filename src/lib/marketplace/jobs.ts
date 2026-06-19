/**
 * marketplace/jobs.ts
 *
 * Service layer for marketplace_jobs — owns fetch-and-mutate-and-audit cycles
 * so the route handlers stay thin. Every mutation writes:
 *   1. A row update on marketplace_jobs
 *   2. An event row on marketplace_job_events
 *   3. (If money moved) rows on marketplace_transactions via ledger.ts
 */

import { platformFeeBps, meetsBeltRequirement, maxCapacity } from './beltTier'
import {
  defaultClaimDeadlineAt,
  defaultDeliveryDeadlineAt,
  MIN_JOB_AMOUNT_CENTS,
} from './deadlines'
import { computeFeeSplit, recordHold, recordRelease, recordRefund } from './ledger'
import { assertTransition } from './stateMachine'
import type { JobEvent, JobStatus } from './stateMachine'
import type {
  AnalystProfileRow,
  D1Database,
  JobEventRow,
  JobType,
  MarketplaceJobRow,
} from './types'
import { newId } from './types'
import type { BeltTier } from './beltTier'

const nowIso = () => new Date().toISOString()

// ──────────────────────────────────────────────────────────────────────────
// Fetchers
// ──────────────────────────────────────────────────────────────────────────
export async function fetchJob(
  db: D1Database,
  jobId: string,
): Promise<MarketplaceJobRow | null> {
  return db
    .prepare('SELECT * FROM marketplace_jobs WHERE id = ?')
    .bind(jobId)
    .first<MarketplaceJobRow>()
}

export async function fetchAnalystProfile(
  db: D1Database,
  userId: string,
): Promise<AnalystProfileRow | null> {
  return db
    .prepare('SELECT * FROM analyst_profiles WHERE user_id = ?')
    .bind(userId)
    .first<AnalystProfileRow>()
}

/**
 * Ensure an analyst_profiles row exists for the user (upsert-on-read).
 * Most endpoints that touch analyst stats need this.
 */
export async function ensureAnalystProfile(
  db: D1Database,
  userId: string,
): Promise<AnalystProfileRow> {
  const existing = await fetchAnalystProfile(db, userId)
  if (existing) return existing

  const now = nowIso()
  await db
    .prepare(
      `INSERT INTO analyst_profiles (
         user_id, is_analyst_enabled, bio, specialties, languages,
         turnaround_hours, direct_hire_enabled, direct_hire_rate_cents,
         belt_tier, belt_score, created_at, updated_at
       ) VALUES (?, 0, '', '[]', '["en"]', 72, 0, 0, 'white', 0, ?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .bind(userId, now, now)
    .run()

  const row = await fetchAnalystProfile(db, userId)
  if (!row) throw new Error('Failed to ensure analyst profile')
  return row
}

// ──────────────────────────────────────────────────────────────────────────
// Audit log helper
// ──────────────────────────────────────────────────────────────────────────
export async function appendJobEvent(
  db: D1Database,
  args: {
    jobId: string
    eventType: string
    fromStatus?: JobStatus | null
    toStatus?: JobStatus | null
    actorUserId?: string | null
    payload?: Record<string, unknown>
  },
): Promise<JobEventRow> {
  const id = newId('evt')
  const now = nowIso()
  await db
    .prepare(
      `INSERT INTO marketplace_job_events (
         id, job_id, event_type, from_status, to_status, actor_user_id, payload, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      args.jobId,
      args.eventType,
      args.fromStatus ?? null,
      args.toStatus ?? null,
      args.actorUserId ?? null,
      JSON.stringify(args.payload ?? {}),
      now,
    )
    .run()
  return {
    id,
    job_id: args.jobId,
    event_type: args.eventType,
    from_status: args.fromStatus ?? null,
    to_status: args.toStatus ?? null,
    actor_user_id: args.actorUserId ?? null,
    payload: JSON.stringify(args.payload ?? {}),
    created_at: now,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Capacity helpers
// ──────────────────────────────────────────────────────────────────────────
async function bumpAnalystCapacity(
  db: D1Database,
  analystId: string,
  delta: number,
): Promise<void> {
  await db
    .prepare(
      `UPDATE analyst_profiles
          SET current_capacity = MAX(0, current_capacity + ?),
              updated_at = ?
        WHERE user_id = ?`,
    )
    .bind(delta, nowIso(), analystId)
    .run()
}

export async function currentActiveJobCount(
  db: D1Database,
  analystId: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) as c
         FROM marketplace_jobs
        WHERE analyst_id = ?
          AND status IN ('CLAIMED','IN_PROGRESS','SUBMITTED','APPROVED','DISPUTED')`,
    )
    .bind(analystId)
    .first<{ c: number }>()
  return Number(row?.c ?? 0)
}

// ──────────────────────────────────────────────────────────────────────────
// CREATE
// ──────────────────────────────────────────────────────────────────────────
export interface CreateJobInput {
  fighterId: string
  jobType: JobType
  title: string
  brief: string
  videos?: string[]
  amountCents: number
  requiredBeltTier?: BeltTier
  // Direct-hire only: analyst the fighter wants to book
  analystId?: string | null
  scoutingRequestId?: string | null
  breakdownOfferId?: string | null
  clientRequestId?: string | null
  claimDeadlineAt?: string | null
  deliveryDeadlineAt?: string | null
}

export async function createJob(
  db: D1Database,
  input: CreateJobInput,
): Promise<MarketplaceJobRow> {
  if (input.amountCents < MIN_JOB_AMOUNT_CENTS) {
    throw new Error(`amountCents must be >= ${MIN_JOB_AMOUNT_CENTS}`)
  }
  if (!input.title.trim()) throw new Error('title required')

  // Idempotency — if the same client_request_id already made a job, return it.
  if (input.clientRequestId) {
    const dup = await db
      .prepare('SELECT * FROM marketplace_jobs WHERE client_request_id = ?')
      .bind(input.clientRequestId)
      .first<MarketplaceJobRow>()
    if (dup) return dup
  }

  // Direct-hire preflight: analyst must be enabled, tier-eligible, and have capacity.
  let requiredBelt = input.requiredBeltTier ?? 'white'
  let feeBps = 1500
  if (input.jobType === 'direct_hire') {
    if (!input.analystId) throw new Error('direct_hire requires analystId')
    const analyst = await fetchAnalystProfile(db, input.analystId)
    if (!analyst || !analyst.is_analyst_enabled) {
      throw new Error('Analyst is not accepting direct hires')
    }
    if (!analyst.direct_hire_enabled) {
      throw new Error('Analyst has direct hire disabled')
    }
    requiredBelt = analyst.belt_tier
    feeBps = platformFeeBps(analyst.belt_tier)
  } else {
    feeBps = platformFeeBps(requiredBelt)
  }

  const { platformFeeCents, analystPayoutCents } = computeFeeSplit(
    input.amountCents,
    feeBps,
  )

  const id = newId('job')
  const now = nowIso()
  const claimDeadlineAt = input.claimDeadlineAt ?? defaultClaimDeadlineAt()
  const deliveryDeadlineAt = input.deliveryDeadlineAt ?? null
  const videosJson = JSON.stringify(input.videos ?? [])

  await db
    .prepare(
      `INSERT INTO marketplace_jobs (
         id, scouting_request_id, breakdown_offer_id, fighter_id, analyst_id,
         job_type, required_belt_tier, title, brief, videos,
         amount_cents, platform_fee_bps, platform_fee_cents, analyst_payout_cents,
         currency, status, claim_deadline_at, delivery_deadline_at,
         client_request_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', 'CREATED', ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.scoutingRequestId ?? null,
      input.breakdownOfferId ?? null,
      input.fighterId,
      input.jobType === 'direct_hire' ? input.analystId : null,
      input.jobType,
      requiredBelt,
      input.title.trim(),
      input.brief ?? '',
      videosJson,
      Math.trunc(input.amountCents),
      feeBps,
      platformFeeCents,
      analystPayoutCents,
      claimDeadlineAt,
      deliveryDeadlineAt,
      input.clientRequestId ?? null,
      now,
      now,
    )
    .run()

  const job = await fetchJob(db, id)
  if (!job) throw new Error('Job created but not found')

  await appendJobEvent(db, {
    jobId: id,
    eventType: 'CREATED',
    toStatus: 'CREATED',
    actorUserId: input.fighterId,
    payload: { jobType: input.jobType, amountCents: input.amountCents },
  })

  return job
}

// ──────────────────────────────────────────────────────────────────────────
// Generic transition applier
// ──────────────────────────────────────────────────────────────────────────
export async function applyTransition(
  db: D1Database,
  args: {
    jobId: string
    event: JobEvent
    actorUserId?: string | null
    patch?: Record<string, unknown>  // extra columns to set (deliverable_url, etc.)
    payload?: Record<string, unknown>
  },
): Promise<MarketplaceJobRow> {
  const job = await fetchJob(db, args.jobId)
  if (!job) throw new Error('Job not found')
  const next = assertTransition(job.status, args.event, args.jobId)

  const now = nowIso()
  const patch = { ...(args.patch ?? {}) } as Record<string, unknown>
  patch.status = next
  patch.updated_at = now

  const columns = Object.keys(patch)
  const setClause = columns.map((c) => `${c} = ?`).join(', ')
  const values = columns.map((c) => patch[c])

  // Optimistic-concurrency guard: only advance if the row is still in the
  // status we validated against. A concurrent request that already moved the
  // job leaves 0 rows changed here — we refuse rather than clobber it. (There
  // is no cross-statement transaction available to serialize these writes, so
  // this guard is what prevents lost updates / double-claims.)
  const result = await db
    .prepare(`UPDATE marketplace_jobs SET ${setClause} WHERE id = ? AND status = ?`)
    .bind(...values, args.jobId, job.status)
    .run()
  if (Number(result?.meta?.changes ?? 0) === 0) {
    throw new Error('Job was modified concurrently; please retry')
  }

  await appendJobEvent(db, {
    jobId: args.jobId,
    eventType: args.event,
    fromStatus: job.status,
    toStatus: next,
    actorUserId: args.actorUserId ?? null,
    payload: args.payload,
  })

  const updated = await fetchJob(db, args.jobId)
  if (!updated) throw new Error('Job transition applied but not found')
  return updated
}

// ──────────────────────────────────────────────────────────────────────────
// FUND (ledger-first Stripe stub)
// ──────────────────────────────────────────────────────────────────────────
export async function fundJob(
  db: D1Database,
  args: { jobId: string; actorUserId: string },
): Promise<MarketplaceJobRow> {
  const job = await fetchJob(db, args.jobId)
  if (!job) throw new Error('Job not found')
  if (job.fighter_id !== args.actorUserId) {
    throw new Error('Only the fighter can fund their job')
  }

  // Direct-hire preflight: confirm the pre-assigned analyst still has capacity
  // BEFORE any money is held. These writes aren't wrapped in a transaction, so
  // throwing after recordHold/FUND would strand escrow on a FUNDED job that can
  // never be claimed. Check first, mutate second.
  if (job.job_type === 'direct_hire' && job.analyst_id) {
    const analyst = await ensureAnalystProfile(db, job.analyst_id)
    const active = await currentActiveJobCount(db, job.analyst_id)
    const cap = Math.min(analyst.max_capacity, maxCapacity(analyst.belt_tier))
    if (active >= cap) {
      throw new Error(`Analyst capacity full: ${active}/${cap} active jobs`)
    }
  }

  // Ledger first (pending_stripe — real Stripe call happens later)
  await recordHold(db, {
    jobId: args.jobId,
    amountCents: job.amount_cents,
    currency: job.currency,
    actorUserId: args.actorUserId,
  })

  let funded = await applyTransition(db, {
    jobId: args.jobId,
    event: 'FUND',
    actorUserId: args.actorUserId,
    payload: { amountCents: job.amount_cents },
  })

  // Direct hire: analyst is pre-assigned — auto-claim so they can start work.
  // Capacity was already verified in the preflight above.
  if (funded.job_type === 'direct_hire' && funded.analyst_id) {
    const analystId = funded.analyst_id
    funded = await applyTransition(db, {
      jobId: args.jobId,
      event: 'CLAIM',
      actorUserId: analystId,
      patch: {
        analyst_id: analystId,
        delivery_deadline_at: defaultDeliveryDeadlineAt(),
      },
      payload: { autoClaimed: true, jobType: 'direct_hire' },
    })
    await bumpAnalystCapacity(db, analystId, 1)
  }

  return funded
}

// ──────────────────────────────────────────────────────────────────────────
// CLAIM (open_bounty only; direct_hire is pre-assigned)
// ──────────────────────────────────────────────────────────────────────────
export async function claimJob(
  db: D1Database,
  args: { jobId: string; analystId: string },
): Promise<MarketplaceJobRow> {
  const job = await fetchJob(db, args.jobId)
  if (!job) throw new Error('Job not found')
  if (job.job_type !== 'open_bounty') {
    throw new Error('Only open bounties can be claimed')
  }
  if (job.analyst_id) {
    throw new Error('Job is already claimed')
  }
  if (job.fighter_id === args.analystId) {
    throw new Error('Cannot claim your own job')
  }

  const analyst = await ensureAnalystProfile(db, args.analystId)
  if (!analyst.is_analyst_enabled) {
    throw new Error('Enable your analyst profile before claiming jobs')
  }
  if (!meetsBeltRequirement(analyst.belt_tier, job.required_belt_tier)) {
    throw new Error(
      `This bounty requires ${job.required_belt_tier} belt (you are ${analyst.belt_tier})`,
    )
  }
  const active = await currentActiveJobCount(db, args.analystId)
  const cap = Math.min(analyst.max_capacity, maxCapacity(analyst.belt_tier))
  if (active >= cap) {
    throw new Error(`Capacity full: ${active}/${cap} active jobs`)
  }

  const claimed = await applyTransition(db, {
    jobId: args.jobId,
    event: 'CLAIM',
    actorUserId: args.analystId,
    patch: {
      analyst_id: args.analystId,
      delivery_deadline_at: defaultDeliveryDeadlineAt(),
    },
    payload: { beltTier: analyst.belt_tier },
  })
  await bumpAnalystCapacity(db, args.analystId, 1)
  return claimed
}

// ──────────────────────────────────────────────────────────────────────────
// SUBMIT / APPROVE / RELEASE
// ──────────────────────────────────────────────────────────────────────────
export async function submitJob(
  db: D1Database,
  args: {
    jobId: string
    analystId: string
    deliverableUrl: string
    deliverableNotes?: string
  },
): Promise<MarketplaceJobRow> {
  const job = await fetchJob(db, args.jobId)
  if (!job) throw new Error('Job not found')
  if (job.analyst_id !== args.analystId) {
    throw new Error('Only the assigned analyst can submit')
  }
  if (!args.deliverableUrl.trim()) throw new Error('deliverableUrl required')

  return applyTransition(db, {
    jobId: args.jobId,
    event: 'SUBMIT',
    actorUserId: args.analystId,
    patch: {
      deliverable_url: args.deliverableUrl.trim(),
      deliverable_notes: args.deliverableNotes ?? null,
      submitted_at: nowIso(),
      // 72-hour auto-release window unless fighter acts
      approval_deadline_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    },
    payload: { deliverableUrl: args.deliverableUrl },
  })
}

export async function approveJob(
  db: D1Database,
  args: { jobId: string; actorUserId: string },
): Promise<MarketplaceJobRow> {
  const job = await fetchJob(db, args.jobId)
  if (!job) throw new Error('Job not found')
  if (job.fighter_id !== args.actorUserId) {
    throw new Error('Only the fighter can approve')
  }
  return applyTransition(db, {
    jobId: args.jobId,
    event: 'APPROVE',
    actorUserId: args.actorUserId,
    patch: { approved_at: nowIso() },
  })
}

export async function releaseJob(
  db: D1Database,
  args: { jobId: string; actorUserId?: string | null; autoReleased?: boolean },
): Promise<MarketplaceJobRow> {
  const job = await fetchJob(db, args.jobId)
  if (!job) throw new Error('Job not found')

  // Ledger first — fee + payout rows (pending_stripe)
  await recordRelease(db, {
    jobId: args.jobId,
    amountCents: job.amount_cents,
    platformFeeCents: job.platform_fee_cents,
    analystPayoutCents: job.analyst_payout_cents,
    currency: job.currency,
    actorUserId: args.actorUserId,
  })

  const next = await applyTransition(db, {
    jobId: args.jobId,
    event: 'RELEASE',
    actorUserId: args.actorUserId ?? null,
    patch: { released_at: nowIso() },
    payload: { autoReleased: !!args.autoReleased },
  })

  await recordAnalystPayoutStats(db, {
    analystId: next.analyst_id,
    analystPayoutCents: job.analyst_payout_cents,
  })

  return next
}

/** Bump denormalized analyst stats after a payout (release or dispute resolve). */
export async function recordAnalystPayoutStats(
  db: D1Database,
  args: { analystId: string | null; analystPayoutCents: number },
): Promise<void> {
  if (!args.analystId) return
  await db
    .prepare(
      `UPDATE analyst_profiles
          SET jobs_completed = jobs_completed + 1,
              total_earned_cents = total_earned_cents + ?,
              current_capacity = MAX(0, current_capacity - 1),
              updated_at = ?
        WHERE user_id = ?`,
    )
    .bind(args.analystPayoutCents, nowIso(), args.analystId)
    .run()
}

// ──────────────────────────────────────────────────────────────────────────
// CANCEL (refund path before work has been approved)
// ──────────────────────────────────────────────────────────────────────────
export async function cancelJob(
  db: D1Database,
  args: { jobId: string; actorUserId: string; reason?: string },
): Promise<MarketplaceJobRow> {
  const job = await fetchJob(db, args.jobId)
  if (!job) throw new Error('Job not found')

  // Refund only if money has been held
  if (['FUNDED', 'CLAIMED', 'IN_PROGRESS'].includes(job.status)) {
    await recordRefund(db, {
      jobId: args.jobId,
      amountCents: job.amount_cents,
      reason: args.reason ?? 'cancelled',
      currency: job.currency,
      actorUserId: args.actorUserId,
    })
  }

  return applyTransition(db, {
    jobId: args.jobId,
    event: 'CANCEL',
    actorUserId: args.actorUserId,
    payload: { reason: args.reason ?? null },
  })
}
