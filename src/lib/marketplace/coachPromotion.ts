/**
 * marketplace/coachPromotion.ts
 *
 * Determines when a coach earns the NEXT belt colour. Promotion is never time
 * alone — every belt from White→Black is gated by all of:
 *   1. Positive-review count   — a rising bar (≈ a year of steady good work to Black)
 *   2. Quality floor           — recent average rating must clear the bar
 *                                (bad reviews ⇒ no promotion, no matter the volume)
 *   3. Time-in-grade           — minimum days held at the current belt
 *   4. Recent activity         — inactive coaches stop climbing
 *
 * Belts are sticky (earned, never auto-demoted); stripes flex with current form
 * (see promotionStripes). Brown→Black and beyond also require a human
 * "Musashi Quality Review" sign-off. Coral (9°) and Red (10°) are hand-awarded
 * only — no metric path reaches them.
 *
 * This module is pure: callers supply the coach's stats, it returns a verdict.
 * Storage, the cron promotion job, and the review queue wire it up separately.
 */

import { BELT_COLOR_ORDER, type BeltColorKey } from './coachRank'

/** A review counts as "positive" toward a promotion at or above this rating. */
export const POSITIVE_REVIEW_MIN_RATING = 4

export interface PromotionGate {
  /** Cumulative positive reviews (rating ≥ POSITIVE_REVIEW_MIN_RATING) to reach this belt. */
  minPositiveReviews: number
  /** Recent rolling average rating required (anti-gaming quality floor). */
  minAvgRating: number
  /** Minimum days held at the previous belt before this promotion. */
  minDaysInGrade: number
  /** Whether a human Musashi Quality Review must sign off before it lands. */
  requiresReview: boolean
}

/**
 * Per-target-belt requirements. Review counts escalate so reaching Black is
 * roughly a year of sustained, well-reviewed work. All values are tunable.
 * Coral/Red are intentionally absent — they are hand-awarded only.
 */
export const PROMOTION_GATES: Partial<Record<BeltColorKey, PromotionGate>> = {
  gray: { minPositiveReviews: 10, minAvgRating: 4.0, minDaysInGrade: 7, requiresReview: false },
  yellow: { minPositiveReviews: 25, minAvgRating: 4.0, minDaysInGrade: 14, requiresReview: false },
  blue: { minPositiveReviews: 50, minAvgRating: 4.2, minDaysInGrade: 30, requiresReview: false },
  purple: { minPositiveReviews: 90, minAvgRating: 4.3, minDaysInGrade: 60, requiresReview: false },
  brown: { minPositiveReviews: 150, minAvgRating: 4.4, minDaysInGrade: 90, requiresReview: false },
  black: { minPositiveReviews: 250, minAvgRating: 4.5, minDaysInGrade: 120, requiresReview: true },
}

/** The next belt colour up, or null at the top of the ladder. */
export function nextBeltColor(belt: BeltColorKey): BeltColorKey | null {
  const i = BELT_COLOR_ORDER.indexOf(belt)
  if (i < 0 || i >= BELT_COLOR_ORDER.length - 1) return null
  return BELT_COLOR_ORDER[i + 1]
}

export interface PromotionState {
  earnedBelt: BeltColorKey
  /** Days the coach has held their current belt. */
  daysInGrade: number
  /** Cumulative count of positive reviews (rating ≥ POSITIVE_REVIEW_MIN_RATING). */
  positiveReviews: number
  /** Recent rolling average rating, 0–5. */
  avgRating: number
  /** Reviewed/worked within the activity window. */
  activeRecently: boolean
}

export type PromotionBlocker = 'reviews' | 'quality' | 'time' | 'inactive' | 'manual_only' | 'max_rank'

export interface PromotionEvaluation {
  nextBelt: BeltColorKey | null
  /** True when every automatic gate (reviews, quality, time, activity) is satisfied. */
  eligible: boolean
  /** True when this promotion still needs a human Musashi Quality Review sign-off. */
  requiresReview: boolean
  /** True for Coral/Red — reachable only by hand-award, never by metrics. */
  manualOnly: boolean
  /** Which gates are not yet met (empty when eligible). */
  blockedBy: PromotionBlocker[]
  gate: PromotionGate | null
}

/**
 * Evaluate whether the coach qualifies for their next belt. `eligible` means the
 * metric gates are met; if `requiresReview` is also true the cron should queue a
 * Quality Review rather than promote outright.
 */
export function evaluatePromotion(state: PromotionState): PromotionEvaluation {
  const nextBelt = nextBeltColor(state.earnedBelt)
  if (!nextBelt) {
    return { nextBelt: null, eligible: false, requiresReview: false, manualOnly: false, blockedBy: ['max_rank'], gate: null }
  }

  const gate = PROMOTION_GATES[nextBelt]
  if (!gate) {
    // Coral / Red — hand-awarded only.
    return { nextBelt, eligible: false, requiresReview: true, manualOnly: true, blockedBy: ['manual_only'], gate: null }
  }

  const blockedBy: PromotionBlocker[] = []
  if (state.positiveReviews < gate.minPositiveReviews) blockedBy.push('reviews')
  if (state.avgRating < gate.minAvgRating) blockedBy.push('quality')
  if (state.daysInGrade < gate.minDaysInGrade) blockedBy.push('time')
  if (!state.activeRecently) blockedBy.push('inactive')

  return {
    nextBelt,
    eligible: blockedBy.length === 0,
    requiresReview: gate.requiresReview,
    manualOnly: false,
    blockedBy,
    gate,
  }
}

/**
 * Flexible stripes (0–4) shown on the current belt — progress toward the next
 * belt's review bar, dampened when recent quality is below the current belt's
 * floor. Caps at 4 ("Promotion Eligible") once the review bar is cleared, where
 * it waits on time-in-grade / Quality Review. Reflects current form, so it can
 * recede without ever touching the earned belt colour.
 */
export function promotionStripes(state: PromotionState): number {
  const nextBelt = nextBeltColor(state.earnedBelt)
  const nextGate = nextBelt ? PROMOTION_GATES[nextBelt] : undefined
  if (!nextGate) return 4 // top of the metric ladder (Black) or beyond — fully decorated

  const base = PROMOTION_GATES[state.earnedBelt]?.minPositiveReviews ?? 0
  const span = Math.max(1, nextGate.minPositiveReviews - base)
  let progress = (state.positiveReviews - base) / span

  // Form penalty: falling below the current belt's quality floor sheds stripes.
  const floor = PROMOTION_GATES[state.earnedBelt]?.minAvgRating
  if (floor && state.avgRating < floor) {
    progress *= Math.max(0, state.avgRating / floor)
  }

  const clamped = Math.max(0, Math.min(1, progress))
  return Math.max(0, Math.min(4, Math.round(clamped * 4)))
}
