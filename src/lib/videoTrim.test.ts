import { describe, expect, test } from 'vitest'
import {
  clampTrimWindow,
  defaultTrimWindow,
  defaultUploadTrimWindow,
  forceNormalPlaybackRate,
  isTrimDurationAcceptable,
  MIN_TRIM_DURATION_TOLERANCE_SEC,
  MIN_TRIM_SEC,
  trimDurationToleranceSec,
} from './videoTrim'

describe('defaultTrimWindow', () => {
  test('caps the initial window at maxSec for a long clip', () => {
    expect(defaultTrimWindow(120, 30)).toEqual({ start: 0, end: 30 })
  })

  test('uses the full clip when it is shorter than the limit', () => {
    expect(defaultTrimWindow(18, 30)).toEqual({ start: 0, end: 18 })
  })
})

describe('defaultUploadTrimWindow', () => {
  test('starts admin and paid uploads with a safe ten-second artifact', () => {
    expect(defaultUploadTrimWindow(300, 600)).toEqual({ start: 0, end: 10 })
    expect(defaultUploadTrimWindow(120, 30)).toEqual({ start: 0, end: 10 })
  })

  test('uses the whole source when it is shorter than ten seconds', () => {
    expect(defaultUploadTrimWindow(6.5, 600)).toEqual({ start: 0, end: 6.5 })
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

describe('trim artifact validation helpers', () => {
  test('allows at least 0.75 seconds of encoder timestamp drift', () => {
    expect(trimDurationToleranceSec(5)).toBe(MIN_TRIM_DURATION_TOLERANCE_SEC)
    expect(isTrimDurationAcceptable(4.25, 5)).toBe(true)
    expect(isTrimDurationAcceptable(4.24, 5)).toBe(false)
  })

  test('allows ten percent drift for longer selected intervals', () => {
    expect(trimDurationToleranceSec(30)).toBe(3)
    expect(isTrimDurationAcceptable(27, 30)).toBe(true)
    expect(isTrimDurationAcceptable(26.99, 30)).toBe(false)
  })

  test('rejects invalid actual or expected durations', () => {
    expect(isTrimDurationAcceptable(0, 10)).toBe(false)
    expect(isTrimDurationAcceptable(10, 0)).toBe(false)
    expect(isTrimDurationAcceptable(Number.NaN, 10)).toBe(false)
  })

  test('forces capture playback and default rates back to real time', () => {
    const media = { playbackRate: 0.25, defaultPlaybackRate: 2 }
    forceNormalPlaybackRate(media)
    expect(media).toEqual({ playbackRate: 1, defaultPlaybackRate: 1 })
  })
})
