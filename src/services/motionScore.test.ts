import { describe, expect, it } from 'vitest'
import { findPeakMotionMs } from './motionScore'
import type { KinematicsSnapshot } from '@/lib/kinematics'

function snap(tMs: number, handBurst: number, hipSpeed = 0): KinematicsSnapshot {
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
        handSpeedBwps: handBurst * 0.8,
        handBurstBwps: handBurst * 0.8,
        footSpeedBwps: 0,
        hipSpeedBwps: hipSpeed,
        powerIndex: 0,
      },
    },
    range: { distanceBw: 2, closingBwps: 0, band: 'close' },
  }
}

describe('findPeakMotionMs', () => {
  it('returns null for empty series', () => {
    expect(findPeakMotionMs([])).toBeNull()
  })

  it('finds global peak at known timestamp (striking)', () => {
    const series = [
      snap(1000, 1),
      snap(3000, 2),
      snap(5000, 9),
      snap(7000, 3),
      snap(9000, 1),
    ]
    const peak = findPeakMotionMs(series, { grappling: false })
    expect(peak).not.toBeNull()
    expect(peak!.tMs).toBe(5000)
    expect(peak!.score).toBeGreaterThan(4)
  })

  it('weights hip speed higher in grappling mode', () => {
    const series = [
      snap(4000, 8, 0.5),
      snap(5000, 2, 6),
    ]
    const peak = findPeakMotionMs(series, { grappling: true })
    expect(peak!.tMs).toBe(5000)
  })
})
