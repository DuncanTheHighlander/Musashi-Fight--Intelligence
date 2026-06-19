/**
 * marketplace/beltTier.ts
 *
 * Belt tier is the analyst's public rank — it gates direct-hire visibility,
 * unlocks high-value bounties, and sets the "respect tax" (platform fee).
 *
 * Score formula:
 *   belt_score = avg_overall_review (1..5) * log10(jobs_completed + 10)
 *
 * That keeps new-but-excellent analysts from being overshadowed by
 * mid-quality veterans, while still rewarding volume. Thresholds below are
 * tuned so that:
 *   - white:  default for new signups
 *   - blue:   ~10 jobs at 4.0+ avg
 *   - purple: ~30 jobs at 4.3+ avg
 *   - brown:  ~75 jobs at 4.5+ avg
 *   - black:  ~200 jobs at 4.7+ avg
 *   - red:    hand-awarded (never auto-promotes)
 */

export type BeltTier = 'white' | 'blue' | 'purple' | 'brown' | 'black' | 'red'

export const BELT_ORDER: readonly BeltTier[] = [
  'white',
  'blue',
  'purple',
  'brown',
  'black',
  'red',
] as const

/**
 * Score thresholds for auto-promotion. Red is always manual.
 */
const BELT_SCORE_THRESHOLDS: Record<Exclude<BeltTier, 'red' | 'white'>, number> = {
  blue: 4.0,
  purple: 6.4,
  brown: 8.3,
  black: 10.8,
}

/**
 * Minimum jobs_completed per tier — prevents score-gaming with a single
 * 5-star review.
 */
const BELT_MIN_JOBS: Record<BeltTier, number> = {
  white: 0,
  blue: 10,
  purple: 30,
  brown: 75,
  black: 200,
  red: 500,
}

export function computeBeltScore(
  avgOverall: number,
  jobsCompleted: number,
): number {
  if (!Number.isFinite(avgOverall) || avgOverall <= 0) return 0
  if (!Number.isFinite(jobsCompleted) || jobsCompleted <= 0) return 0
  return avgOverall * Math.log10(jobsCompleted + 10)
}

/**
 * Compute the highest tier an analyst is eligible for given their stats.
 * Red is NEVER returned by this function — it must be awarded manually.
 */
export function computeEligibleTier(
  avgOverall: number,
  jobsCompleted: number,
  currentTier: BeltTier,
): BeltTier {
  // Red is sticky once awarded (hand-check in admin UI to revoke)
  if (currentTier === 'red') return 'red'

  const score = computeBeltScore(avgOverall, jobsCompleted)

  if (jobsCompleted >= BELT_MIN_JOBS.black && score >= BELT_SCORE_THRESHOLDS.black)
    return 'black'
  if (jobsCompleted >= BELT_MIN_JOBS.brown && score >= BELT_SCORE_THRESHOLDS.brown)
    return 'brown'
  if (jobsCompleted >= BELT_MIN_JOBS.purple && score >= BELT_SCORE_THRESHOLDS.purple)
    return 'purple'
  if (jobsCompleted >= BELT_MIN_JOBS.blue && score >= BELT_SCORE_THRESHOLDS.blue)
    return 'blue'
  return 'white'
}

/**
 * Can an analyst at `candidate` belt claim a job requiring `required` belt?
 * Higher tiers implicitly satisfy lower requirements.
 */
export function meetsBeltRequirement(
  candidate: BeltTier,
  required: BeltTier,
): boolean {
  return BELT_ORDER.indexOf(candidate) >= BELT_ORDER.indexOf(required)
}

/**
 * Platform fee in basis points (1 bps = 0.01%). Higher-belt analysts get a
 * lower cut extracted — a "respect tax" discount. These are starting values;
 * they can move into DB config later without touching code.
 */
export function platformFeeBps(tier: BeltTier): number {
  switch (tier) {
    case 'red':
      return 1000 // 10%
    case 'black':
      return 1100 // 11%
    case 'brown':
      return 1200 // 12%
    case 'purple':
      return 1300 // 13%
    case 'blue':
      return 1400 // 14%
    case 'white':
    default:
      return 1500 // 15%
  }
}

/**
 * Capacity cap — hard limit on simultaneous in-flight jobs per analyst.
 * Prevents a single analyst from claiming 50 bounties and ghosting.
 */
export function maxCapacity(tier: BeltTier): number {
  switch (tier) {
    case 'red':
      return 10
    case 'black':
      return 8
    case 'brown':
      return 6
    case 'purple':
      return 5
    case 'blue':
      return 4
    case 'white':
    default:
      return 3
  }
}

/**
 * Direct-hire visibility gate. A user can only enable direct_hire_enabled
 * once they reach this tier.
 */
export const DIRECT_HIRE_MIN_TIER: BeltTier = 'blue'

export function canEnableDirectHire(tier: BeltTier): boolean {
  return meetsBeltRequirement(tier, DIRECT_HIRE_MIN_TIER)
}
