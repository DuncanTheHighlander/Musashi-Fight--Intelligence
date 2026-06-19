/** Default marketplace job deadlines (used when caller omits explicit values). */

export const DEFAULT_CLAIM_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000
export const DEFAULT_DELIVERY_DEADLINE_MS = 72 * 60 * 60 * 1000
export const MIN_JOB_AMOUNT_CENTS = 100

export function defaultClaimDeadlineAt(from = Date.now()): string {
  return new Date(from + DEFAULT_CLAIM_DEADLINE_MS).toISOString()
}

export function defaultDeliveryDeadlineAt(from = Date.now()): string {
  return new Date(from + DEFAULT_DELIVERY_DEADLINE_MS).toISOString()
}
