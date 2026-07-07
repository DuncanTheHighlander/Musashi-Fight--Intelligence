import { describe, expect, test } from 'vitest'
import { defaultTrimWindow, clampTrimWindow, MIN_TRIM_SEC } from './videoTrim'

describe('defaultTrimWindow', () => {
  test('caps the initial window at maxSec for a long clip', () => {
    expect(defaultTrimWindow(120, 30)).toEqual({ start: 0, end: 30 })
  })

  test('uses the full clip when it is shorter than the limit', () => {
    expect(defaultTrimWindow(18, 30)).toEqual({ start: 0, end: 18 })
  })
})

describe('clampTrimWindow', () => {
  test('never allows a window longer than maxSec (moving end)', () => {
    const { start, end } = clampTrimWindow(0, 90, 120, 30, 'end')
    expect(end - start).toBeLessThanOrEqual(30)
  })

  test('capping via the start handle pulls end down', () => {
    const w = clampTrimWindow(50, 120, 120, 30, 'start')
    expect(w.start).toBe(50)
    expect(w.end).toBe(80)
  })

  test('keeps the window inside the clip', () => {
    const w = clampTrimWindow(100, 200, 120, 30, 'end')
    expect(w.end).toBeLessThanOrEqual(120)
    expect(w.start).toBeGreaterThanOrEqual(0)
    expect(w.end - w.start).toBeLessThanOrEqual(30)
  })

  test('enforces the minimum window length', () => {
    const w = clampTrimWindow(10, 10.2, 120, 30, 'end')
    expect(w.end - w.start).toBeGreaterThanOrEqual(MIN_TRIM_SEC)
  })

  test('swaps inverted handles', () => {
    const w = clampTrimWindow(40, 20, 120, 30, 'end')
    expect(w.start).toBeLessThan(w.end)
  })
})
