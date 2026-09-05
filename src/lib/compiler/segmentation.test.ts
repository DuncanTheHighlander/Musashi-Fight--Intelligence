import { describe, expect, it } from 'vitest'
import { findExchangeWindows, inExchangeWindow } from './segmentation'
import type { KinematicsSnapshot } from '@/lib/kinematics'
import type { PoseFrame } from '@/lib/fightlang/fightlang.types'

function kinSample(
  tMs: number,
  distanceBw: number,
  handBurst: number,
  closing = 0,
  hipSpeed = 0,
): KinematicsSnapshot {
  return {
    capturedAtMs: tMs,
    videoTimeSec: tMs / 1000,
    posesDetected: 2,
    fighters: {
      A: {
        torsoScalePx: 1,
        handSpeedBwps: handBurst,
        handBurstBwps: handBurst,
        footSpeedBwps: 0,
        hipSpeedBwps: hipSpeed,
        powerIndex: 0,
      },
      B: {
        torsoScalePx: 1,
        handSpeedBwps: handBurst,
        handBurstBwps: handBurst,
        footSpeedBwps: 0,
        hipSpeedBwps: hipSpeed,
        powerIndex: 0,
      },
    },
    range: { distanceBw, closingBwps: closing, band: distanceBw <= 2.5 ? 'close' : 'long' },
  }
}

describe('findExchangeWindows', () => {
  it('returns no windows when fighters stay far apart with no activity', () => {
    const series = Array.from({ length: 40 }, (_, i) => kinSample(i * 100, 8, 0))
    const windows = findExchangeWindows([], series, { sport: 'boxing' })
    expect(windows).toEqual([])
  })

  it('detects a single exchange during a closing burst', () => {
    const series: KinematicsSnapshot[] = []
    for (let i = 0; i < 30; i++) series.push(kinSample(i * 100, 8, 0))
    for (let i = 30; i < 45; i++) series.push(kinSample(i * 100, 2, 6, 2))
    for (let i = 45; i < 60; i++) series.push(kinSample(i * 100, 8, 0))

    const windows = findExchangeWindows([], series, { sport: 'boxing', fps: 10 })
    expect(windows.length).toBeGreaterThanOrEqual(1)
    expect(windows[0]!.startMs).toBeLessThan(4500)
    expect(windows[0]!.endMs).toBeGreaterThan(3000)
  })

  it('merges exchanges separated by a short gap', () => {
    const series: KinematicsSnapshot[] = []
    for (let t = 0; t <= 4000; t += 100) series.push(kinSample(t, 2, 6))
    for (let t = 4100; t <= 4200; t += 100) series.push(kinSample(t, 8, 0))
    for (let t = 4300; t <= 7000; t += 100) series.push(kinSample(t, 2, 6))

    const windows = findExchangeWindows([], series, { sport: 'boxing', mergeGapMs: 200, fps: 10 })
    expect(windows.length).toBe(1)
  })

  it('opens grappling windows on hip scramble even with low wrist motion', () => {
    const series: KinematicsSnapshot[] = []
    for (let i = 0; i < 20; i++) series.push(kinSample(i * 100, 2, 0.5, 0, 0.5))
    for (let i = 20; i < 35; i++) series.push(kinSample(i * 100, 1.8, 0.5, 0.5, 3.5))
    for (let i = 35; i < 50; i++) series.push(kinSample(i * 100, 2.5, 0.5, 0, 0.5))

    const windows = findExchangeWindows([], series, { sport: 'bjj', clipType: 'rolling', fps: 10 })
    expect(windows.length).toBeGreaterThanOrEqual(1)
  })

  it('uses full clip window for single-actor bag work', () => {
    const frames: PoseFrame[] = [
      { tMs: 0, videoTimeSec: 0, actors: { A: [{ x: 0.5, y: 0.5 }] } },
      { tMs: 1000, videoTimeSec: 1, actors: { A: [{ x: 0.51, y: 0.5 }] } },
    ]
    const windows = findExchangeWindows(frames, [], { sport: 'boxing', clipType: 'bag_work' })
    expect(windows).toEqual([{ startMs: 0, endMs: 1000, trigger: 'combined' }])
  })
})

describe('inExchangeWindow', () => {
  it('returns false when no windows exist', () => {
    expect(inExchangeWindow(1000, [])).toBe(false)
  })

  it('returns true inside an open window', () => {
    expect(inExchangeWindow(2500, [{ startMs: 2000, endMs: 3000 }])).toBe(true)
  })
})
