import { describe, expect, test } from 'vitest'
import {
  RANK_LADDER,
  MAX_RANK_INDEX,
  BELT_SUMMARY,
  coachTitle,
  computeCoachRank,
  computeCoachScore,
  scoreToRankIndex,
  type CoachSignals,
} from '../coachRank'

const baseSignals: CoachSignals = {
  qualityRating: 0,
  totalReviews: 0,
  jobsCompleted: 0,
  salesCount: 0,
  prepFeeling: 0,
  prepResponses: 0,
  wins: 0,
  losses: 0,
  draws: 0,
}

const s = (over: Partial<CoachSignals>): CoachSignals => ({ ...baseSignals, ...over })

describe('coach rank ladder shape', () => {
  test('has 40 ranks: 6 stripe belts ×5 + black ×8 + coral + red', () => {
    expect(RANK_LADDER.length).toBe(40)
    expect(MAX_RANK_INDEX).toBe(39)
  })

  test('rank indices are contiguous and ascending', () => {
    RANK_LADDER.forEach((r, i) => expect(r.rankIndex).toBe(i))
  })

  test('starts at White and ends at Red 10th degree', () => {
    expect(RANK_LADDER[0]).toMatchObject({ beltKey: 'white', stripes: 0 })
    const top = RANK_LADDER[MAX_RANK_INDEX]
    expect(top).toMatchObject({ beltKey: 'red', degree: 10 })
    expect(top.label).toBe('Red Rank · 10th degree')
  })

  test('coral sits at 9th degree, just below red', () => {
    const coral = RANK_LADDER.find((r) => r.beltKey === 'coral')
    expect(coral).toMatchObject({ degree: 9 })
    expect(coral!.rankIndex).toBe(MAX_RANK_INDEX - 1)
  })

  test('kids belts (gray, yellow) sit between white and blue', () => {
    const order = ['white', 'gray', 'yellow', 'blue', 'purple', 'brown', 'black', 'coral', 'red']
    const firstIndexByBelt = order.map((k) => RANK_LADDER.findIndex((r) => r.beltKey === k))
    const sorted = [...firstIndexByBelt].sort((a, b) => a - b)
    expect(firstIndexByBelt).toEqual(sorted)
    expect(RANK_LADDER.find((r) => r.beltKey === 'gray')!.isKids).toBe(true)
    expect(RANK_LADDER.find((r) => r.beltKey === 'yellow')!.isKids).toBe(true)
  })

  test('BELT_SUMMARY is one rank per colour, ascending White → Red', () => {
    expect(BELT_SUMMARY.map((r) => r.beltKey)).toEqual([
      'white', 'gray', 'yellow', 'blue', 'purple', 'brown', 'black', 'coral', 'red',
    ])
    BELT_SUMMARY.forEach((r, i) => {
      if (i > 0) expect(r.rankIndex).toBeGreaterThan(BELT_SUMMARY[i - 1].rankIndex)
    })
  })

  test('black belt degrees run 1st through 8th', () => {
    const black = RANK_LADDER.filter((r) => r.beltKey === 'black')
    expect(black.map((r) => r.degree)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(black[2].label).toBe('Black Rank · 3rd degree')
  })
})

describe('public coach titles', () => {
  test('each kyu rank maps to its customer-facing title', () => {
    const titleFor = (key: string) =>
      coachTitle(RANK_LADDER.find((r) => r.beltKey === key)!)
    expect(titleFor('white')).toBe('Foundation Coach')
    expect(titleFor('gray')).toBe('Emerging Coach')
    expect(titleFor('yellow')).toBe('Rising Coach')
    expect(titleFor('blue')).toBe('Technical Coach')
    expect(titleFor('purple')).toBe('Advanced Coach')
    expect(titleFor('brown')).toBe('Senior Coach')
    expect(titleFor('coral')).toBe('Master Coach')
    expect(titleFor('red')).toBe('Legend Coach')
  })

  test('black title tiers split by degree', () => {
    expect(coachTitle({ beltKey: 'black', degree: 1 })).toBe('Elite Coach')
    expect(coachTitle({ beltKey: 'black', degree: 2 })).toBe('Elite Coach')
    expect(coachTitle({ beltKey: 'black', degree: 3 })).toBe('Professor Coach')
    expect(coachTitle({ beltKey: 'black', degree: 4 })).toBe('Professor Coach')
    expect(coachTitle({ beltKey: 'black', degree: 5 })).toBe('Senior Professor Coach')
    expect(coachTitle({ beltKey: 'black', degree: 8 })).toBe('Senior Professor Coach')
  })
})

describe('coach scoring', () => {
  test('a brand-new coach is an undecorated White Belt', () => {
    const rank = computeCoachRank(baseSignals)
    expect(rank.rankIndex).toBe(0)
    expect(rank.beltKey).toBe('white')
    expect(rank.score).toBe(0)
  })

  test('feeling of preparation is weighted higher than actual results', () => {
    // Identical except where the strength sits: prep-feeling vs win-rate.
    const common = { qualityRating: 4, totalReviews: 40, jobsCompleted: 40, prepResponses: 20 }
    const highPrepLowResults = computeCoachScore(
      s({ ...common, prepFeeling: 5, wins: 0, losses: 20 }),
    )
    const lowPrepHighResults = computeCoachScore(
      s({ ...common, prepFeeling: 1, wins: 20, losses: 0 }),
    )
    expect(highPrepLowResults).toBeGreaterThan(lowPrepHighResults)
  })

  test('competition feedback raises the score above reviews alone', () => {
    const withoutPrep = computeCoachScore(s({ qualityRating: 4, totalReviews: 30, jobsCompleted: 30 }))
    const withPrep = computeCoachScore(
      s({ qualityRating: 4, totalReviews: 30, jobsCompleted: 30, prepFeeling: 4.5, prepResponses: 15, wins: 10, losses: 5 }),
    )
    expect(withPrep).toBeGreaterThan(withoutPrep)
  })

  test('volume gates advancement: elite rating, tiny sample stays low', () => {
    const rank = computeCoachRank(s({ qualityRating: 5, totalReviews: 1, jobsCompleted: 1 }))
    // 2 engagements → capped at the top of White.
    expect(rank.beltKey).toBe('white')
  })

  test('high quality + high volume + strong prep reaches a senior belt', () => {
    const rank = computeCoachRank(
      s({
        qualityRating: 4.9,
        totalReviews: 220,
        jobsCompleted: 240,
        salesCount: 180,
        prepFeeling: 4.8,
        prepResponses: 120,
        wins: 70,
        losses: 20,
        draws: 5,
      }),
    )
    const seniorBelts = ['brown', 'black', 'coral', 'red']
    expect(seniorBelts).toContain(rank.beltKey)
  })

  test('scoreToRankIndex is monotonic and clamps to the ladder', () => {
    expect(scoreToRankIndex(-5)).toBe(0)
    expect(scoreToRankIndex(0)).toBe(0)
    expect(scoreToRankIndex(1000)).toBe(MAX_RANK_INDEX)
    expect(scoreToRankIndex(8)).toBeGreaterThan(scoreToRankIndex(4))
  })
})
