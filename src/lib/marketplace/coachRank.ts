/**
 * marketplace/coachRank.ts
 *
 * Coach ranking engine — a full BJJ-style belt ladder for the *unified* coach
 * population (anyone who does analyst jobs, sells content, or gets reviewed as
 * a coach). This is a presentation/leaderboard layer and is deliberately kept
 * separate from `beltTier.ts`, which still governs analyst platform-fees,
 * capacity, and direct-hire gating. Changing this file never moves money.
 *
 * Ladder (ascending), mirroring IBJJF progression incl. youth belts:
 *   White → Gray → Yellow → Blue → Purple → Brown   (each: 0–4 stripes)
 *   → Black 1st–8th degree → Coral 9th degree → Red 10th degree
 *
 * Score (continuous):
 *   base       = qualityRating × log10(volume + 10)         // reviews × engagement
 *   prepBonus  = SCALE × (Wp·feeling + Wr·winRate) × log10(prepResponses + 1)
 *   score      = base + prepBonus
 *
 * Per product intent, a student's *feeling of preparation* (pre/post-competition
 * reviews) is weighted HIGHER than their actual win/loss results:
 *   PREP_FEELING_WEIGHT (0.7) > RESULT_WEIGHT (0.3)
 *
 * Final rank = min(score→rank, volume cap). Volume gating prevents a single
 * 5-star review from vaulting a brand-new coach to black belt.
 */

export type BeltColorKey =
  | 'white'
  | 'gray'
  | 'yellow'
  | 'blue'
  | 'purple'
  | 'brown'
  | 'black'
  | 'coral'
  | 'red'

type BeltKind = 'stripes' | 'degree' | 'single'

interface BeltDef {
  key: BeltColorKey
  label: string
  kind: BeltKind
  levels: number // discrete sublevels within this belt
  isKids?: boolean
  degreeBase?: number // first degree number (degree/single belts)
}

/** Ordered belt definitions. Order here defines the whole ladder. */
const BELTS: readonly BeltDef[] = [
  { key: 'white', label: 'White', kind: 'stripes', levels: 5 },
  { key: 'gray', label: 'Gray', kind: 'stripes', levels: 5, isKids: true },
  { key: 'yellow', label: 'Yellow', kind: 'stripes', levels: 5, isKids: true },
  { key: 'blue', label: 'Blue', kind: 'stripes', levels: 5 },
  { key: 'purple', label: 'Purple', kind: 'stripes', levels: 5 },
  { key: 'brown', label: 'Brown', kind: 'stripes', levels: 5 },
  { key: 'black', label: 'Black', kind: 'degree', levels: 8, degreeBase: 1 },
  { key: 'coral', label: 'Coral', kind: 'single', levels: 1, degreeBase: 9 },
  { key: 'red', label: 'Red', kind: 'single', levels: 1, degreeBase: 10 },
] as const

export interface CoachRank {
  rankIndex: number // 0..MAX_RANK_INDEX
  beltKey: BeltColorKey
  beltLabel: string // 'Black'
  isKids: boolean
  stripes: number // 0..4 for stripe belts, else 0
  degree: number // 1..10 for degree/single belts, else 0
  label: string // 'Black Belt · 3rd degree'
}

const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

/** Flattened ladder, lowest (index 0 = White Belt) to highest (Red 10th degree). */
export const RANK_LADDER: readonly CoachRank[] = (() => {
  const out: CoachRank[] = []
  let idx = 0
  for (const b of BELTS) {
    for (let lvl = 0; lvl < b.levels; lvl++) {
      let stripes = 0
      let degree = 0
      // Customer-facing rank detail uses "Rank", not "Belt" — a coach's Musashi
      // rank is distinct from any real-world martial-arts belt they hold.
      let label = `${b.label} Rank`
      if (b.kind === 'stripes') {
        stripes = lvl
        if (stripes > 0) label = `${b.label} Rank · ${stripes} Stripe${stripes > 1 ? 's' : ''}`
      } else {
        degree = (b.degreeBase ?? 1) + lvl
        label = `${b.label} Rank · ${ordinal(degree)} degree`
      }
      out.push({
        rankIndex: idx++,
        beltKey: b.key,
        beltLabel: b.label,
        isKids: Boolean(b.isKids),
        stripes,
        degree,
        label,
      })
    }
  }
  return out
})()

export const MAX_RANK_INDEX = RANK_LADDER.length - 1

/** Belt colours in ascending order — the shared source of truth for the ladder. */
export const BELT_COLOR_ORDER: readonly BeltColorKey[] = BELTS.map((b) => b.key)

/**
 * One representative rank per belt colour, ascending (lowest → highest) — the
 * canonical progression for legends / the belt-ladder key.
 */
export const BELT_SUMMARY: readonly CoachRank[] = (() => {
  const seen = new Set<BeltColorKey>()
  const out: CoachRank[] = []
  for (const r of RANK_LADDER) {
    if (!seen.has(r.beltKey)) {
      seen.add(r.beltKey)
      out.push(r)
    }
  }
  return out
})()

/** Highest ladder index belonging to a given belt color. */
const topIndexOf = (key: BeltColorKey): number => {
  let last = 0
  for (const r of RANK_LADDER) if (r.beltKey === key) last = r.rankIndex
  return last
}

// ──────────────────────────────────────────────────────────────────────────
// Scoring
// ──────────────────────────────────────────────────────────────────────────
export interface CoachSignals {
  qualityRating: number // 0..5 combined avg review rating
  totalReviews: number // count of quality reviews
  jobsCompleted: number
  salesCount: number
  prepFeeling: number // 0..5 avg of pre/post-competition review ratings
  prepResponses: number // count of pre/post-competition reviews
  wins: number
  losses: number
  draws: number
}

/** Feeling of preparation is weighted higher than actual competition results. */
export const PREP_FEELING_WEIGHT = 0.7
export const RESULT_WEIGHT = 0.3
/** How many score points a maxed-out competition signal can contribute. */
const COMPETITION_SCALE = 4
/** Score that maps to the very top of the ladder (tunable). */
const SCORE_REF = 16

const clamp = (n: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo))

export const engagementVolume = (s: CoachSignals): number =>
  Math.max(0, (s.jobsCompleted || 0) + (s.salesCount || 0) + (s.totalReviews || 0))

/** Normalized win rate in [0,1]; draws count as half. */
export const winRateOf = (s: CoachSignals): number => {
  const comps = (s.wins || 0) + (s.losses || 0) + (s.draws || 0)
  if (comps <= 0) return 0
  return ((s.wins || 0) + 0.5 * (s.draws || 0)) / comps
}

export function computeCoachScore(s: CoachSignals): number {
  const volume = engagementVolume(s)
  if (volume <= 0) return 0

  const base = clamp(s.qualityRating, 0, 5) * Math.log10(volume + 10)

  let prepBonus = 0
  if ((s.prepResponses || 0) > 0) {
    const feeling01 = clamp(s.prepFeeling, 0, 5) / 5
    const competitionSignal =
      PREP_FEELING_WEIGHT * feeling01 + RESULT_WEIGHT * winRateOf(s) // 0..1
    prepBonus = COMPETITION_SCALE * competitionSignal * Math.log10((s.prepResponses || 0) + 1)
  }

  return base + prepBonus
}

/** Map a continuous score onto a ladder index, before volume gating. */
export function scoreToRankIndex(score: number): number {
  const progress = clamp(score / SCORE_REF, 0, 1)
  return Math.round(progress * MAX_RANK_INDEX)
}

/** Hard cap on attainable rank by total engagement — earns the belt, not buys it. */
export function volumeCapIndex(volume: number): number {
  if (volume < 3) return topIndexOf('white')
  if (volume < 10) return topIndexOf('yellow')
  if (volume < 25) return topIndexOf('blue')
  if (volume < 60) return topIndexOf('purple')
  if (volume < 120) return topIndexOf('brown')
  if (volume < 300) return topIndexOf('black')
  if (volume < 600) return topIndexOf('coral')
  return MAX_RANK_INDEX
}

export interface CoachRankResult extends CoachRank {
  score: number
  volume: number
}

export function computeCoachRank(s: CoachSignals): CoachRankResult {
  const score = computeCoachScore(s)
  const volume = engagementVolume(s)
  const idx = Math.min(scoreToRankIndex(score), volumeCapIndex(volume))
  return { ...RANK_LADDER[idx], score, volume }
}

// ──────────────────────────────────────────────────────────────────────────
// Customer-facing copy
// ──────────────────────────────────────────────────────────────────────────
export const COACH_RANK_SYSTEM_NAME = 'Musashi Coach Rank'

export const COACH_RANK_BLURB =
  'Coaches progress through ranks based on review quality, student preparation, ' +
  'consistency, and Musashi verification. Senior ranks require sustained ' +
  'excellence — rank is earned, not bought.'

/**
 * Public "Coach Title" — the premium, plain-language status a customer sees
 * first. Distinct from the rank detail (e.g. "Purple Rank · 3 Stripes"). Black
 * splits into three tiers by degree. "Title sells, rank proves."
 */
export function coachTitle(rank: Pick<CoachRank, 'beltKey' | 'degree'>): string {
  switch (rank.beltKey) {
    case 'white':
      return 'Foundation Coach'
    case 'gray':
      return 'Emerging Coach'
    case 'yellow':
      return 'Rising Coach'
    case 'blue':
      return 'Technical Coach'
    case 'purple':
      return 'Advanced Coach'
    case 'brown':
      return 'Senior Coach'
    case 'black':
      if (rank.degree <= 2) return 'Elite Coach'
      if (rank.degree <= 4) return 'Professor Coach'
      return 'Senior Professor Coach'
    case 'coral':
      return 'Master Coach'
    case 'red':
      return 'Legend Coach'
    default:
      return 'Coach'
  }
}
