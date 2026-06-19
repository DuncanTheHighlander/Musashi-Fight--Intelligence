/**
 * Unit tests for kinematics utility functions
 */

import { describe, it, expect } from 'vitest'
import {
  landmarkDistance,
  calculateTorsoScale,
  calculateLandmarkSpeed,
  calculateHandSpeed,
  calculateFootSpeed,
  calculateHipSpeed,
  calculateBurstSpeed,
  calculatePowerIndex,
  calculateFighterDistance,
  getRangeBand,
  assignFightersByPosition,
  assignFightersWithTracking,
  pruneHistory,
  POSE_LANDMARKS,
  smoothLandmarks,
  type LandmarkHistory,
} from './kinematics'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// Helper to create a mock landmark
const mockLandmark = (x: number, y: number, z: number = 0, visibility: number = 1): NormalizedLandmark => ({
  x,
  y,
  z,
  visibility,
})

// Helper to create a full pose with 33 landmarks
const createMockPose = (offsetX: number = 0, offsetY: number = 0): NormalizedLandmark[] => {
  const landmarks: NormalizedLandmark[] = []
  for (let i = 0; i < 33; i++) {
    landmarks.push(mockLandmark(0.5 + offsetX, 0.5 + offsetY, 0, 1))
  }
  // Set specific landmarks for a realistic pose
  landmarks[POSE_LANDMARKS.NOSE] = mockLandmark(0.5 + offsetX, 0.2 + offsetY)
  landmarks[POSE_LANDMARKS.LEFT_SHOULDER] = mockLandmark(0.4 + offsetX, 0.35 + offsetY)
  landmarks[POSE_LANDMARKS.RIGHT_SHOULDER] = mockLandmark(0.6 + offsetX, 0.35 + offsetY)
  landmarks[POSE_LANDMARKS.LEFT_HIP] = mockLandmark(0.45 + offsetX, 0.55 + offsetY)
  landmarks[POSE_LANDMARKS.RIGHT_HIP] = mockLandmark(0.55 + offsetX, 0.55 + offsetY)
  landmarks[POSE_LANDMARKS.LEFT_WRIST] = mockLandmark(0.35 + offsetX, 0.45 + offsetY)
  landmarks[POSE_LANDMARKS.RIGHT_WRIST] = mockLandmark(0.65 + offsetX, 0.45 + offsetY)
  landmarks[POSE_LANDMARKS.LEFT_ANKLE] = mockLandmark(0.45 + offsetX, 0.85 + offsetY)
  landmarks[POSE_LANDMARKS.RIGHT_ANKLE] = mockLandmark(0.55 + offsetX, 0.85 + offsetY)
  return landmarks
}

const createTrackedPose = (offsetX: number, headLeanX: number): NormalizedLandmark[] => {
  const pose = createMockPose(offsetX, 0)
  pose[POSE_LANDMARKS.NOSE] = mockLandmark(0.5 + offsetX + headLeanX, 0.2)
  return pose
}

describe('landmarkDistance', () => {
  it('should calculate distance between two landmarks', () => {
    const a = mockLandmark(0, 0, 0)
    const b = mockLandmark(3, 4, 0)
    expect(landmarkDistance(a, b)).toBeCloseTo(5, 5)
  })

  it('should handle 3D distance', () => {
    const a = mockLandmark(0, 0, 0)
    const b = mockLandmark(1, 2, 2)
    expect(landmarkDistance(a, b)).toBeCloseTo(3, 5)
  })

  it('should return 0 for same point', () => {
    const a = mockLandmark(0.5, 0.5, 0.1)
    expect(landmarkDistance(a, a)).toBe(0)
  })
})

describe('calculateTorsoScale', () => {
  it('should calculate torso scale from landmarks', () => {
    const pose = createMockPose()
    const canvasWidth = 1920
    const scale = calculateTorsoScale(pose, canvasWidth)
    expect(scale).toBeGreaterThan(0)
    expect(scale).toBeLessThan(canvasWidth)
  })

  it('should return 0 if landmarks are missing', () => {
    const emptyPose: NormalizedLandmark[] = []
    expect(calculateTorsoScale(emptyPose, 1920)).toBe(0)
  })

  it('should scale with canvas width', () => {
    const pose = createMockPose()
    const scale1 = calculateTorsoScale(pose, 1920)
    const scale2 = calculateTorsoScale(pose, 960)
    expect(scale1).toBeCloseTo(scale2 * 2, 1)
  })
})

describe('calculateLandmarkSpeed', () => {
  it('should calculate speed in body-widths per second', () => {
    const current = mockLandmark(0.5, 0.5)
    const previous = mockLandmark(0.4, 0.5)
    const deltaMs = 100 // 100ms
    const torsoScaleNorm = 0.2 // 20% of canvas width

    const speed = calculateLandmarkSpeed(current, previous, deltaMs, torsoScaleNorm)
    // Movement of 0.1 in 100ms = 1.0/s, divided by 0.2 torso = 5 bw/s
    expect(speed).toBeCloseTo(5, 1)
  })

  it('should return 0 for zero delta time', () => {
    const current = mockLandmark(0.5, 0.5)
    const previous = mockLandmark(0.4, 0.5)
    expect(calculateLandmarkSpeed(current, previous, 0, 0.2)).toBe(0)
  })

  it('should return 0 for zero torso scale', () => {
    const current = mockLandmark(0.5, 0.5)
    const previous = mockLandmark(0.4, 0.5)
    expect(calculateLandmarkSpeed(current, previous, 100, 0)).toBe(0)
  })
})

describe('calculateHandSpeed', () => {
  it('should calculate average hand speed', () => {
    const current = createMockPose()
    const previous = createMockPose()
    // Move wrists
    previous[POSE_LANDMARKS.LEFT_WRIST] = mockLandmark(0.3, 0.45)
    previous[POSE_LANDMARKS.RIGHT_WRIST] = mockLandmark(0.6, 0.45)

    const speed = calculateHandSpeed(current, previous, 100, 0.2)
    expect(speed).toBeGreaterThan(0)
  })

  it('should return 0 if wrists are missing', () => {
    const current: NormalizedLandmark[] = []
    const previous: NormalizedLandmark[] = []
    expect(calculateHandSpeed(current, previous, 100, 0.2)).toBe(0)
  })
})

describe('calculateFootSpeed', () => {
  it('should calculate average foot speed', () => {
    const current = createMockPose()
    const previous = createMockPose()
    // Move ankles
    previous[POSE_LANDMARKS.LEFT_ANKLE] = mockLandmark(0.4, 0.85)
    previous[POSE_LANDMARKS.RIGHT_ANKLE] = mockLandmark(0.5, 0.85)

    const speed = calculateFootSpeed(current, previous, 100, 0.2)
    expect(speed).toBeGreaterThan(0)
  })
})

describe('calculateHipSpeed', () => {
  it('should calculate hip center speed', () => {
    const current = createMockPose()
    const previous = createMockPose()
    // Move hips
    previous[POSE_LANDMARKS.LEFT_HIP] = mockLandmark(0.4, 0.55)
    previous[POSE_LANDMARKS.RIGHT_HIP] = mockLandmark(0.5, 0.55)

    const speed = calculateHipSpeed(current, previous, 100, 0.2)
    expect(speed).toBeGreaterThan(0)
  })
})

describe('calculateBurstSpeed', () => {
  it('should return max speed over history window', () => {
    const now = Date.now()
    const history: LandmarkHistory[] = [
      { landmarks: createMockPose(), timestampMs: now - 300 },
      { landmarks: createMockPose(), timestampMs: now - 200 },
      { landmarks: createMockPose(), timestampMs: now - 100 },
      { landmarks: createMockPose(), timestampMs: now },
    ]
    // Move wrist in last frame
    history[3].landmarks[POSE_LANDMARKS.LEFT_WRIST] = mockLandmark(0.25, 0.45)

    const burst = calculateBurstSpeed(history, POSE_LANDMARKS.LEFT_WRIST, 500)
    expect(burst).toBeGreaterThan(0)
  })

  it('should return 0 for insufficient history', () => {
    const history: LandmarkHistory[] = [
      { landmarks: createMockPose(), timestampMs: Date.now() },
    ]
    expect(calculateBurstSpeed(history, POSE_LANDMARKS.LEFT_WRIST)).toBe(0)
  })
})

describe('calculatePowerIndex', () => {
  it('should combine hand burst with hip engagement', () => {
    const handBurst = 5
    const hipSpeed = 1
    const power = calculatePowerIndex(handBurst, hipSpeed)
    expect(power).toBeGreaterThan(handBurst)
  })

  it('should return hand burst when hip speed is 0', () => {
    const handBurst = 5
    const power = calculatePowerIndex(handBurst, 0)
    expect(power).toBe(handBurst)
  })

  it('should cap hip multiplier effect', () => {
    const handBurst = 5
    const power1 = calculatePowerIndex(handBurst, 2)
    const power2 = calculatePowerIndex(handBurst, 10) // Should be capped
    expect(power1).toBe(power2)
  })
})

describe('calculateFighterDistance', () => {
  it('should calculate distance between two fighters', () => {
    const poseA = createMockPose(-0.2, 0) // Left fighter
    const poseB = createMockPose(0.2, 0) // Right fighter

    const distance = calculateFighterDistance(poseA, poseB, 0.2)
    expect(distance).toBeGreaterThan(0)
  })

  it('should return 0 if hips are missing', () => {
    const emptyPose: NormalizedLandmark[] = []
    expect(calculateFighterDistance(emptyPose, emptyPose, 0.2)).toBe(0)
  })
})

describe('getRangeBand', () => {
  it('should return close for distance < 1.5 bw', () => {
    expect(getRangeBand(1)).toBe('close')
    expect(getRangeBand(1.4)).toBe('close')
  })

  it('should return mid for distance 1.5-3 bw', () => {
    expect(getRangeBand(1.5)).toBe('mid')
    expect(getRangeBand(2.5)).toBe('mid')
  })

  it('should return long for distance >= 3 bw', () => {
    expect(getRangeBand(3)).toBe('long')
    expect(getRangeBand(5)).toBe('long')
  })
})

describe('assignFightersByPosition', () => {
  it('should assign left fighter as A, right as B', () => {
    const poseLeft = createMockPose(-0.2, 0)
    const poseRight = createMockPose(0.2, 0)

    const { A, B } = assignFightersByPosition([poseRight, poseLeft])
    expect(A).toBe(poseLeft)
    expect(B).toBe(poseRight)
  })

  it('should handle single pose', () => {
    const pose = createMockPose()
    const { A, B } = assignFightersByPosition([pose])
    expect(A).toBe(pose)
    expect(B).toBeNull()
  })

  it('should handle empty array', () => {
    const { A, B } = assignFightersByPosition([])
    expect(A).toBeNull()
    expect(B).toBeNull()
  })
})

describe('assignFightersWithTracking', () => {
  it('uses motion history to reacquire the correct fighter when only one pose is visible', () => {
    const prevPrevA = createTrackedPose(-0.05, -0.03)
    const prevA = createTrackedPose(0.05, -0.03)
    const prevPrevB = createTrackedPose(0.25, 0.03)
    const prevB = createTrackedPose(0.15, 0.03)

    const poseReacquiredForA = createTrackedPose(0.18, -0.03)

    const { A, B } = assignFightersWithTracking(
      [poseReacquiredForA],
      prevA,
      prevB,
      prevPrevA,
      prevPrevB
    )

    expect(A).toBe(poseReacquiredForA)
    expect(B).toBeNull()
  })
})

describe('smoothLandmarks', () => {
  it('keeps very low-visibility joints on the previous stable location', () => {
    const previous = createMockPose()
    const current = createMockPose()
    current[POSE_LANDMARKS.LEFT_ANKLE] = mockLandmark(0.8, 0.9, 0, 0.05)

    const smoothed = smoothLandmarks(current, previous, 0.82)

    expect(smoothed[POSE_LANDMARKS.LEFT_ANKLE]?.x).toBeCloseTo(previous[POSE_LANDMARKS.LEFT_ANKLE]!.x, 5)
    expect(smoothed[POSE_LANDMARKS.LEFT_ANKLE]?.y).toBeCloseTo(previous[POSE_LANDMARKS.LEFT_ANKLE]!.y, 5)
  })
})

describe('pruneHistory', () => {
  it('should remove old entries', () => {
    const now = Date.now()
    const history: LandmarkHistory[] = [
      { landmarks: createMockPose(), timestampMs: now - 5000 },
      { landmarks: createMockPose(), timestampMs: now - 3000 },
      { landmarks: createMockPose(), timestampMs: now - 1000 },
      { landmarks: createMockPose(), timestampMs: now },
    ]

    const pruned = pruneHistory(history, 2000)
    expect(pruned.length).toBe(2)
  })

  it('should limit max entries', () => {
    const now = Date.now()
    const history: LandmarkHistory[] = Array.from({ length: 100 }, (_, i) => ({
      landmarks: createMockPose(),
      timestampMs: now - i * 10,
    }))

    const pruned = pruneHistory(history, 5000, 30)
    expect(pruned.length).toBe(30)
  })

  it('should keep recent entries', () => {
    const now = Date.now()
    const history: LandmarkHistory[] = [
      { landmarks: createMockPose(), timestampMs: now - 100 },
      { landmarks: createMockPose(), timestampMs: now },
    ]

    const pruned = pruneHistory(history, 2000)
    expect(pruned.length).toBe(2)
  })
})
