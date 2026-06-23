import { describe, expect, it } from 'vitest'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import {
  isPoseAlignedToFrame,
  isPoseFreshForDisplay,
  resolveActorPoseAt,
  resolvePoseAt,
  type TimedPosePair,
} from './poseTimeline'

const lm = (x: number, y: number): NormalizedLandmark[] => [{ x, y, z: 0, visibility: 1 }]

describe('poseTimeline', () => {
  it('interpolates between bracketing history samples at the playhead', () => {
    const history: TimedPosePair[] = [
      { tMs: 1000, pose: { A: lm(0.2, 0.5), B: null } },
      { tMs: 1075, pose: { A: lm(0.4, 0.5), B: null } },
    ]

    const resolved = resolveActorPoseAt(history, 'A', 1037, null)
    expect(resolved?.[0]?.x).toBeCloseTo(0.299, 2)
  })

  it('holds the newest sample when the playhead is ahead and only one sample exists', () => {
    const history: TimedPosePair[] = [{ tMs: 1000, pose: { A: lm(0.2, 0.5), B: null } }]
    const resolved = resolveActorPoseAt(history, 'A', 1060, null)
    expect(resolved?.[0]?.x).toBeCloseTo(0.2, 3)
  })

  it('extrapolates modestly when the playhead is ahead of the newest sample', () => {
    const history: TimedPosePair[] = [
      { tMs: 1000, pose: { A: lm(0.2, 0.5), B: null } },
      { tMs: 1075, pose: { A: lm(0.4, 0.5), B: null } },
    ]
    const resolved = resolveActorPoseAt(history, 'A', 1100, null)
    expect(resolved?.[0]?.x).toBeCloseTo(0.466, 2)
  })

  it('resolves both actors independently', () => {
    const history: TimedPosePair[] = [
      { tMs: 1000, pose: { A: lm(0.1, 0.5), B: lm(0.8, 0.5) } },
      { tMs: 1100, pose: { A: lm(0.3, 0.5), B: lm(0.6, 0.5) } },
    ]
    const pose = resolvePoseAt(history, 1050, { A: null, B: null })
    expect(pose.A?.[0]?.x).toBeCloseTo(0.2, 2)
    expect(pose.B?.[0]?.x).toBeCloseTo(0.7, 2)
  })

  it('treats detections within one pose interval of display as fresh', () => {
    expect(isPoseFreshForDisplay(1000, 1035)).toBe(true)
    expect(isPoseFreshForDisplay(1000, 1180)).toBe(true)
    expect(isPoseFreshForDisplay(1000, 1181)).toBe(false)
    expect(isPoseFreshForDisplay(1035, 1000)).toBe(false)
    expect(isPoseFreshForDisplay(1020, 1000)).toBe(true)
  })

  it('only allows direct draw when detection is within one composited frame', () => {
    expect(isPoseAlignedToFrame(1000, 1015)).toBe(true)
    expect(isPoseAlignedToFrame(1000, 1020)).toBe(true)
    expect(isPoseAlignedToFrame(1000, 1021)).toBe(false)
    expect(isPoseAlignedToFrame(1000, 1100)).toBe(false)
    expect(isPoseAlignedToFrame(1035, 1000)).toBe(false)
    expect(isPoseAlignedToFrame(1020, 1000)).toBe(true)
  })

  it('caps forward extrapolation when the playhead runs past the newest sample', () => {
    const history: TimedPosePair[] = [
      { tMs: 1000, pose: { A: lm(0.2, 0.5), B: null } },
      { tMs: 1075, pose: { A: lm(0.4, 0.5), B: null } },
    ]
    const resolved = resolveActorPoseAt(history, 'A', 1150, null)
    // ratio would be 2.0 without cap; capped at 1.6 -> 0.2 + 1.6*(0.4-0.2) = 0.52
    expect(resolved?.[0]?.x).toBeCloseTo(0.52, 2)
  })
})
