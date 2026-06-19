import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { POSE_LANDMARKS, landmarkDistance } from '@/lib/kinematics'

export type Point2 = { x: number; y: number }
export type Line2 = { a: Point2; b: Point2 }

/**
 * Initial heuristic for stance-quality (“compromised base”).
 * This constant is expressed in **shoulder-width-normalized** units and should
 * be tuned empirically from real clips.
 */
export const COMPROMISED_BASE_THRESHOLD = 0.35

function lmPoint(lm: NormalizedLandmark | undefined | null): Point2 | null {
  if (!lm) return null
  return { x: lm.x, y: lm.y }
}

export function computeShoulderWidth(landmarks: NormalizedLandmark[]): number | null {
  const ls = landmarks[POSE_LANDMARKS.LEFT_SHOULDER]
  const rs = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER]
  if (!ls || !rs) return null
  const w = landmarkDistance(ls, rs)
  return w > 0 ? w : null
}

export function computeHipCenter(landmarks: NormalizedLandmark[]): Point2 | null {
  const lh = landmarks[POSE_LANDMARKS.LEFT_HIP]
  const rh = landmarks[POSE_LANDMARKS.RIGHT_HIP]
  if (!lh || !rh) return null
  return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
}

export function computeShoulderCenter(landmarks: NormalizedLandmark[]): Point2 | null {
  const ls = landmarks[POSE_LANDMARKS.LEFT_SHOULDER]
  const rs = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER]
  if (!ls || !rs) return null
  return { x: (ls.x + rs.x) / 2, y: (ls.y + rs.y) / 2 }
}

export function computeTorsoLine(landmarks: NormalizedLandmark[]): Line2 | null {
  const hip = computeHipCenter(landmarks)
  const sh = computeShoulderCenter(landmarks)
  if (!hip || !sh) return null
  return { a: hip, b: sh }
}

/**
 * Torso angle in degrees relative to vertical axis.
 * 0° = perfectly upright (shoulders directly above hips), 90° = horizontal.
 */
export function computeTorsoAngle(landmarks: NormalizedLandmark[]): number | null {
  const line = computeTorsoLine(landmarks)
  if (!line) return null
  const dx = line.b.x - line.a.x
  const dy = line.b.y - line.a.y
  const len = Math.hypot(dx, dy)
  if (len <= 0) return null
  // Angle from vertical: vertical unit is (0, -1) in image coords.
  const cos = Math.abs(dy) / len
  const rad = Math.acos(Math.max(-1, Math.min(1, cos)))
  return (rad * 180) / Math.PI
}

function pickFootPoint(landmarks: NormalizedLandmark[], side: 'left' | 'right'): Point2 | null {
  const idx =
    side === 'left'
      ? POSE_LANDMARKS.LEFT_FOOT_INDEX
      : POSE_LANDMARKS.RIGHT_FOOT_INDEX
  const ankleIdx =
    side === 'left'
      ? POSE_LANDMARKS.LEFT_ANKLE
      : POSE_LANDMARKS.RIGHT_ANKLE

  return (
    lmPoint(landmarks[idx]) ??
    lmPoint(landmarks[ankleIdx]) ??
    null
  )
}

export function computeStanceWidthLine(landmarks: NormalizedLandmark[]): Line2 | null {
  const left = pickFootPoint(landmarks, 'left')
  const right = pickFootPoint(landmarks, 'right')
  if (!left || !right) return null
  return { a: left, b: right }
}

/**
 * Stance width in shoulder-width-normalized units.
 * Example: 1.2 means feet are ~1.2 shoulder widths apart.
 */
export function computeStanceWidth(landmarks: NormalizedLandmark[]): number | null {
  const stance = computeStanceWidthLine(landmarks)
  const sw = computeShoulderWidth(landmarks)
  if (!stance || !sw) return null
  const w = Math.hypot(stance.b.x - stance.a.x, stance.b.y - stance.a.y)
  return sw > 0 ? w / sw : null
}

/**
 * Shoulder-width-normalized lateral deviation of hip-center from foot-midpoint.
 * Higher values indicate the hips are drifting away from the base.
 */
export function computeCompromisedBaseScore(landmarks: NormalizedLandmark[]): number | null {
  const sw = computeShoulderWidth(landmarks)
  const hip = computeHipCenter(landmarks)
  const stance = computeStanceWidthLine(landmarks)
  if (!sw || !hip || !stance) return null
  const footMid = { x: (stance.a.x + stance.b.x) / 2, y: (stance.a.y + stance.b.y) / 2 }
  const lateral = Math.abs(hip.x - footMid.x)
  return lateral / sw
}

export function isCompromisedBase(landmarks: NormalizedLandmark[]): boolean | null {
  const score = computeCompromisedBaseScore(landmarks)
  if (score == null) return null
  return score >= COMPROMISED_BASE_THRESHOLD
}

