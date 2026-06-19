import { describe, expect, test } from 'vitest'
import {
  PROMOTION_GATES,
  nextBeltColor,
  evaluatePromotion,
  promotionStripes,
  type PromotionState,
} from '../coachPromotion'

const base: PromotionState = {
  earnedBelt: 'blue',
  daysInGrade: 999,
  positiveReviews: 999,
  avgRating: 5,
  activeRecently: true,
}
const s = (over: Partial<PromotionState>): PromotionState => ({ ...base, ...over })

describe('belt-colour ladder', () => {
  test('nextBeltColor walks White → Red and stops', () => {
    expect(nextBeltColor('white')).toBe('gray')
    expect(nextBeltColor('brown')).toBe('black')
    expect(nextBeltColor('black')).toBe('coral')
    expect(nextBeltColor('red')).toBeNull()
  })

  test('positive-review bars rise monotonically toward Black', () => {
    const order = ['gray', 'yellow', 'blue', 'purple', 'brown', 'black'] as const
    const reqs = order.map((b) => PROMOTION_GATES[b]!.minPositiveReviews)
    const sorted = [...reqs].sort((a, b) => a - b)
    expect(reqs).toEqual(sorted)
    expect(reqs[0]).toBe(10)
    expect(reqs[reqs.length - 1]).toBeGreaterThanOrEqual(200) // ~a year of good work
  })
})

describe('promotion gates', () => {
  test('all gates met ⇒ eligible', () => {
    const ev = evaluatePromotion(s({ earnedBelt: 'blue', positiveReviews: 90, avgRating: 4.5, daysInGrade: 60 }))
    expect(ev.nextBelt).toBe('purple')
    expect(ev.eligible).toBe(true)
    expect(ev.blockedBy).toEqual([])
  })

  test('good volume but poor reviews does NOT promote', () => {
    // Plenty of reviews + time, but average below the quality floor.
    const ev = evaluatePromotion(s({ earnedBelt: 'blue', positiveReviews: 500, avgRating: 3.4, daysInGrade: 999 }))
    expect(ev.eligible).toBe(false)
    expect(ev.blockedBy).toContain('quality')
  })

  test('not enough positive reviews blocks promotion even with time served', () => {
    const ev = evaluatePromotion(s({ earnedBelt: 'blue', positiveReviews: 12, avgRating: 5, daysInGrade: 999 }))
    expect(ev.eligible).toBe(false)
    expect(ev.blockedBy).toContain('reviews')
  })

  test('time-in-grade alone is not enough; reviews alone is not enough', () => {
    const onlyTime = evaluatePromotion(s({ earnedBelt: 'white', positiveReviews: 0, avgRating: 0, daysInGrade: 999 }))
    expect(onlyTime.eligible).toBe(false)
    const onlyReviews = evaluatePromotion(s({ earnedBelt: 'white', positiveReviews: 999, avgRating: 5, daysInGrade: 0 }))
    expect(onlyReviews.eligible).toBe(false)
    expect(onlyReviews.blockedBy).toContain('time')
  })

  test('inactive coaches are blocked', () => {
    const ev = evaluatePromotion(s({ earnedBelt: 'white', positiveReviews: 999, avgRating: 5, daysInGrade: 999, activeRecently: false }))
    expect(ev.blockedBy).toContain('inactive')
  })

  test('Brown → Black requires a Quality Review sign-off', () => {
    const ev = evaluatePromotion(s({ earnedBelt: 'brown', positiveReviews: 300, avgRating: 4.8, daysInGrade: 999 }))
    expect(ev.nextBelt).toBe('black')
    expect(ev.eligible).toBe(true) // metrics met...
    expect(ev.requiresReview).toBe(true) // ...but still needs human review
  })

  test('Coral / Red are hand-awarded only', () => {
    const ev = evaluatePromotion(s({ earnedBelt: 'black', positiveReviews: 9999, avgRating: 5, daysInGrade: 9999 }))
    expect(ev.nextBelt).toBe('coral')
    expect(ev.manualOnly).toBe(true)
    expect(ev.eligible).toBe(false)
  })
})

describe('flexible stripes (current form)', () => {
  test('stripes grow with positive reviews between belt bars', () => {
    // Blue→Purple spans 50→90 positive reviews.
    const none = promotionStripes(s({ earnedBelt: 'blue', positiveReviews: 50, avgRating: 4.5 }))
    const mid = promotionStripes(s({ earnedBelt: 'blue', positiveReviews: 70, avgRating: 4.5 }))
    const full = promotionStripes(s({ earnedBelt: 'blue', positiveReviews: 90, avgRating: 4.5 }))
    expect(none).toBe(0)
    expect(mid).toBeGreaterThan(none)
    expect(full).toBe(4)
  })

  test('dropping below the quality floor sheds stripes (belt stays)', () => {
    const inForm = promotionStripes(s({ earnedBelt: 'blue', positiveReviews: 80, avgRating: 4.5 }))
    const slump = promotionStripes(s({ earnedBelt: 'blue', positiveReviews: 80, avgRating: 2.0 }))
    expect(slump).toBeLessThan(inForm)
  })
})
