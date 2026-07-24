import { describe, expect, it } from 'vitest'
import {
  conversionRate,
  estimateApiCostCents,
  growthPercent,
  lastNMonthKeys,
  monthKey,
  mrrCentsForPriceId,
  PLAN_MONTHLY_CENTS,
  PLAN_6MO_CENTS,
  PLAN_YEARLY_CENTS,
} from '@/lib/adminBusinessMetrics'

describe('adminBusinessMetrics helpers', () => {
  it('maps price ids to monthly MRR cents', () => {
    expect(
      mrrCentsForPriceId('price_month', {
        monthly: 'price_month',
        sixMo: 'price_6',
        yearly: 'price_y',
      }),
    ).toBe(PLAN_MONTHLY_CENTS)
    expect(
      mrrCentsForPriceId('price_6', {
        monthly: 'price_month',
        sixMo: 'price_6',
        yearly: 'price_y',
      }),
    ).toBe(Math.round(PLAN_6MO_CENTS / 6))
    expect(
      mrrCentsForPriceId('price_y', {
        monthly: 'price_month',
        sixMo: 'price_6',
        yearly: 'price_y',
      }),
    ).toBe(Math.round(PLAN_YEARLY_CENTS / 12))
  })

  it('estimates API cost from action counts', () => {
    expect(estimateApiCostCents({ analyze: 2, chat: 5, reflex: 1, track: 1 })).toBe(2 * 10 + 5 * 2 + 1 + 3)
  })

  it('computes conversion and growth rates', () => {
    expect(conversionRate(3, 10)).toBe(30)
    expect(conversionRate(0, 0)).toBeNull()
    expect(growthPercent(120, 100)).toBe(20)
    expect(growthPercent(50, 0)).toBe(100)
  })

  it('builds month keys', () => {
    const keys = lastNMonthKeys(3, new Date('2026-07-15T12:00:00Z'))
    expect(keys).toEqual(['2026-05', '2026-06', '2026-07'])
    expect(monthKey(new Date('2026-01-05T00:00:00Z'))).toBe('2026-01')
  })
})
