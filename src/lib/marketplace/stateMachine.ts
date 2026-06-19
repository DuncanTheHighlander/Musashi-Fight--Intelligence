/**
 * marketplace/stateMachine.ts
 *
 * Single source of truth for marketplace_jobs state transitions.
 * Mirrors the CHECK(status IN ...) in migration 0016, but is the authoritative
 * guard — CHECK is a last-line-of-defense, not primary enforcement.
 *
 * Every route that mutates a job status MUST call assertTransition() first.
 */

export type JobStatus =
  | 'CREATED'
  | 'FUNDED'
  | 'CLAIMED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'APPROVED'
  | 'RELEASED'
  | 'DISPUTED'
  | 'RESOLVED_REFUND'
  | 'RESOLVED_RELEASE'
  | 'RESOLVED_SPLIT'
  | 'CANCELLED'
  | 'EXPIRED'

export type JobEvent =
  | 'FUND'
  | 'CLAIM'
  | 'START'
  | 'SUBMIT'
  | 'APPROVE'
  | 'RELEASE'
  | 'DISPUTE'
  | 'RESOLVE_REFUND'
  | 'RESOLVE_RELEASE'
  | 'RESOLVE_SPLIT'
  | 'CANCEL'
  | 'EXPIRE'

/**
 * Transition table. Keys are the "from" status, values map event → target.
 * Omitted cells are invalid transitions.
 */
const TRANSITIONS: Record<JobStatus, Partial<Record<JobEvent, JobStatus>>> = {
  CREATED: {
    FUND: 'FUNDED',
    CANCEL: 'CANCELLED',
    EXPIRE: 'EXPIRED',
  },
  FUNDED: {
    CLAIM: 'CLAIMED',
    CANCEL: 'CANCELLED', // refund issued
    EXPIRE: 'EXPIRED',   // no one claimed by deadline
  },
  CLAIMED: {
    START: 'IN_PROGRESS',
    CANCEL: 'CANCELLED',
    EXPIRE: 'EXPIRED',
  },
  IN_PROGRESS: {
    SUBMIT: 'SUBMITTED',
    DISPUTE: 'DISPUTED',
    CANCEL: 'CANCELLED',
    EXPIRE: 'EXPIRED',
  },
  SUBMITTED: {
    APPROVE: 'APPROVED',
    DISPUTE: 'DISPUTED',
    // Auto-release when approval_deadline passes
    RELEASE: 'RELEASED',
  },
  APPROVED: {
    RELEASE: 'RELEASED',
    DISPUTE: 'DISPUTED',
  },
  RELEASED: {
    // Terminal — chargeback handled as a transaction, not a state change
    DISPUTE: 'DISPUTED',
  },
  DISPUTED: {
    RESOLVE_REFUND: 'RESOLVED_REFUND',
    RESOLVE_RELEASE: 'RESOLVED_RELEASE',
    RESOLVE_SPLIT: 'RESOLVED_SPLIT',
  },
  // Terminals
  RESOLVED_REFUND: {},
  RESOLVED_RELEASE: {},
  RESOLVED_SPLIT: {},
  CANCELLED: {},
  EXPIRED: {},
}

export class InvalidTransitionError extends Error {
  code = 'INVALID_TRANSITION'
  constructor(
    public from: JobStatus,
    public event: JobEvent,
    public jobId?: string,
  ) {
    super(
      `Invalid job transition: ${event} from ${from}` +
        (jobId ? ` (job=${jobId})` : ''),
    )
  }
}

/**
 * Compute the target status for a given (from, event) pair.
 * Throws InvalidTransitionError if the transition is not allowed.
 */
export function assertTransition(
  from: JobStatus,
  event: JobEvent,
  jobId?: string,
): JobStatus {
  const next = TRANSITIONS[from]?.[event]
  if (!next) throw new InvalidTransitionError(from, event, jobId)
  return next
}

/**
 * Pure check — returns boolean instead of throwing. Useful in conditionals.
 */
export function canTransition(from: JobStatus, event: JobEvent): boolean {
  return Boolean(TRANSITIONS[from]?.[event])
}

/**
 * Terminal detection — useful for filters ("show me only active jobs").
 */
export const TERMINAL_STATES: ReadonlyArray<JobStatus> = [
  'RESOLVED_REFUND',
  'RESOLVED_RELEASE',
  'RESOLVED_SPLIT',
  'CANCELLED',
  'EXPIRED',
  'RELEASED',
]

export function isTerminal(status: JobStatus): boolean {
  return TERMINAL_STATES.includes(status)
}

/**
 * Jobs in one of these states are "active" — the money is still in escrow or
 * awaiting movement. Useful for analyst capacity calculation.
 */
export const ACTIVE_STATES: ReadonlyArray<JobStatus> = [
  'CLAIMED',
  'IN_PROGRESS',
  'SUBMITTED',
  'APPROVED',
  'DISPUTED',
]

export function isActive(status: JobStatus): boolean {
  return ACTIVE_STATES.includes(status)
}
