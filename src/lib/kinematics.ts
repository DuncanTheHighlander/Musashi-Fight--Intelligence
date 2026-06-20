/**
 * Kinematics utility module for MediaPipe PoseLandmarker integration.
 * Handles landmark processing, metric calculations, and skeleton drawing.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// MediaPipe pose landmark indices
export const POSE_LANDMARKS = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const

// Skeleton connections for drawing
/**
 * Per-joint visibility thresholds for skeleton rendering during crossings.
 * Leaf joints (wrists, feet) use higher thresholds to suppress ghost limbs;
 * topology joints (hips, shoulders) stay visible at low confidence.
 */
export const JOINT_VISIBILITY: Record<'leaf' | 'torso' | 'core', number> = {
  leaf: 0.04,
  torso: 0.02,
  core: 0.02,
}

export function jointVisibilityThreshold(idx: number): number {
  if (idx >= 27) return JOINT_VISIBILITY.leaf
  if (idx >= 23) return JOINT_VISIBILITY.torso
  if (idx >= 17) return JOINT_VISIBILITY.leaf
  return JOINT_VISIBILITY.core
}

/**
 * DISPLAY-ONLY visibility thresholds for skeleton BONE drawing.
 *
 * Kept SEPARATE from JOINT_VISIBILITY (which is used for identity tracking,
 * box framing, and quality scoring and must stay permissive so the skeleton
 * survives occlusion). The leaf threshold is raised to 0.2 so low-confidence
 * hand/foot landmarks don't render as flickering "ghost" limbs detached from
 * the fighter. Torso/core stay permissive so the body stays drawn through
 * crossings.
 */
export const DISPLAY_JOINT_VISIBILITY: Record<'leaf' | 'torso' | 'core', number> = {
  leaf: 0.2,
  torso: 0.02,
  core: 0.02,
}

export function displayJointVisibilityThreshold(idx: number): number {
  if (idx >= 27) return DISPLAY_JOINT_VISIBILITY.leaf
  if (idx >= 23) return DISPLAY_JOINT_VISIBILITY.torso
  if (idx >= 17) return DISPLAY_JOINT_VISIBILITY.leaf
  return DISPLAY_JOINT_VISIBILITY.core
}

export const POSE_CONNECTIONS: [number, number][] = [
  // Torso
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.RIGHT_SHOULDER],
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.LEFT_HIP],
  [POSE_LANDMARKS.RIGHT_SHOULDER, POSE_LANDMARKS.RIGHT_HIP],
  [POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.RIGHT_HIP],
  // Left arm
  [POSE_LANDMARKS.LEFT_SHOULDER, POSE_LANDMARKS.LEFT_ELBOW],
  [POSE_LANDMARKS.LEFT_ELBOW, POSE_LANDMARKS.LEFT_WRIST],
  // Right arm
  [POSE_LANDMARKS.RIGHT_SHOULDER, POSE_LANDMARKS.RIGHT_ELBOW],
  [POSE_LANDMARKS.RIGHT_ELBOW, POSE_LANDMARKS.RIGHT_WRIST],
  // Left leg
  [POSE_LANDMARKS.LEFT_HIP, POSE_LANDMARKS.LEFT_KNEE],
  [POSE_LANDMARKS.LEFT_KNEE, POSE_LANDMARKS.LEFT_ANKLE],
  [POSE_LANDMARKS.LEFT_ANKLE, POSE_LANDMARKS.LEFT_HEEL],
  [POSE_LANDMARKS.LEFT_HEEL, POSE_LANDMARKS.LEFT_FOOT_INDEX],
  [POSE_LANDMARKS.LEFT_ANKLE, POSE_LANDMARKS.LEFT_FOOT_INDEX],
  // Right leg
  [POSE_LANDMARKS.RIGHT_HIP, POSE_LANDMARKS.RIGHT_KNEE],
  [POSE_LANDMARKS.RIGHT_KNEE, POSE_LANDMARKS.RIGHT_ANKLE],
  [POSE_LANDMARKS.RIGHT_ANKLE, POSE_LANDMARKS.RIGHT_HEEL],
  [POSE_LANDMARKS.RIGHT_HEEL, POSE_LANDMARKS.RIGHT_FOOT_INDEX],
  [POSE_LANDMARKS.RIGHT_ANKLE, POSE_LANDMARKS.RIGHT_FOOT_INDEX],
  // Face
  [POSE_LANDMARKS.NOSE, POSE_LANDMARKS.LEFT_EYE],
  [POSE_LANDMARKS.NOSE, POSE_LANDMARKS.RIGHT_EYE],
  [POSE_LANDMARKS.LEFT_EYE, POSE_LANDMARKS.LEFT_EAR],
  [POSE_LANDMARKS.RIGHT_EYE, POSE_LANDMARKS.RIGHT_EAR],
]

export type FighterKinematics = {
  torsoScalePx: number
  handSpeedBwps: number
  handBurstBwps: number
  footSpeedBwps: number
  hipSpeedBwps: number
  powerIndex: number
}

export type KinematicsSnapshot = {
  capturedAtMs: number
  videoTimeSec: number | null
  posesDetected: number
  fighters: Partial<Record<'A' | 'B', FighterKinematics>>
  range?: {
    distanceBw: number
    closingBwps: number
    band: 'close' | 'mid' | 'long'
  }
}

export type LandmarkHistory = {
  landmarks: NormalizedLandmark[]
  timestampMs: number
}

export type PoseHistory = {
  A: LandmarkHistory[]
  B: LandmarkHistory[]
}

// Colors for skeleton drawing (cyberpunk samurai aesthetic)
export const SKELETON_COLORS = {
  A: { line: '#84a98c', joint: '#52796f', glow: 'rgba(132, 169, 140, 0.4)' },
  B: { line: '#e63946', joint: '#9d0208', glow: 'rgba(230, 57, 70, 0.4)' },
} as const

// Corner-aware skeleton colors
// Blue corner = #3b82f6 (blue-500), Red corner = #ef4444 (red-500)
const CORNER_COLORS = {
  blue: { line: '#3b82f6', joint: '#1d4ed8', glow: 'rgba(59, 130, 246, 0.4)' },
  red:  { line: '#ef4444', joint: '#b91c1c', glow: 'rgba(239, 68, 68, 0.4)' },
} as const

/**
 * Get skeleton colors for Fighter A and Fighter B based on corner assignment.
 * Fighter A = left side of frame, Fighter B = right side.
 * myCorner determines which color YOUR fighter gets.
 * - myCorner='blue' (default): A=blue, B=red  (you're on the left / blue corner)
 * - myCorner='red': A=red, B=blue  (you're on the left / red corner)
 */
export function getCornerColors(myCorner: 'blue' | 'red' = 'blue'): {
  A: { line: string; joint: string; glow: string }
  B: { line: string; joint: string; glow: string }
} {
  if (myCorner === 'red') {
    return { A: CORNER_COLORS.red, B: CORNER_COLORS.blue }
  }
  return { A: CORNER_COLORS.blue, B: CORNER_COLORS.red }
}

/**
 * Calculate Euclidean distance between two landmarks in normalized coords
 */
export function landmarkDistance(a: NormalizedLandmark, b: NormalizedLandmark): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = (a.z ?? 0) - (b.z ?? 0)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

/**
 * Calculate torso scale (shoulder-hip distance) as body-width reference
 */
export function calculateTorsoScale(landmarks: NormalizedLandmark[], canvasWidth: number): number {
  const leftShoulder = landmarks[POSE_LANDMARKS.LEFT_SHOULDER]
  const rightShoulder = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER]
  const leftHip = landmarks[POSE_LANDMARKS.LEFT_HIP]
  const rightHip = landmarks[POSE_LANDMARKS.RIGHT_HIP]

  if (!leftShoulder || !rightShoulder || !leftHip || !rightHip) return 0

  // Average of shoulder width and hip width, then average with torso height
  const shoulderWidth = landmarkDistance(leftShoulder, rightShoulder)
  const hipWidth = landmarkDistance(leftHip, rightHip)
  const leftTorso = landmarkDistance(leftShoulder, leftHip)
  const rightTorso = landmarkDistance(rightShoulder, rightHip)

  const avgWidth = (shoulderWidth + hipWidth) / 2
  const avgHeight = (leftTorso + rightTorso) / 2

  // Use the larger dimension as body-width reference
  const bodyWidthNorm = Math.max(avgWidth, avgHeight * 0.6)
  return bodyWidthNorm * canvasWidth
}

/**
 * Calculate speed of a landmark between two frames (in body-widths per second)
 */
export function calculateLandmarkSpeed(
  current: NormalizedLandmark,
  previous: NormalizedLandmark,
  deltaMs: number,
  torsoScaleNorm: number
): number {
  if (deltaMs <= 0 || torsoScaleNorm <= 0) return 0

  const dist = landmarkDistance(current, previous)
  const distBw = dist / torsoScaleNorm // Convert to body-widths
  const speedBwps = distBw / (deltaMs / 1000) // Body-widths per second

  return speedBwps
}

/**
 * Calculate average hand speed (wrists) between two frames
 */
export function calculateHandSpeed(
  current: NormalizedLandmark[],
  previous: NormalizedLandmark[],
  deltaMs: number,
  torsoScaleNorm: number
): number {
  const leftWristCurr = current[POSE_LANDMARKS.LEFT_WRIST]
  const rightWristCurr = current[POSE_LANDMARKS.RIGHT_WRIST]
  const leftWristPrev = previous[POSE_LANDMARKS.LEFT_WRIST]
  const rightWristPrev = previous[POSE_LANDMARKS.RIGHT_WRIST]

  if (!leftWristCurr || !rightWristCurr || !leftWristPrev || !rightWristPrev) return 0

  const leftSpeed = calculateLandmarkSpeed(leftWristCurr, leftWristPrev, deltaMs, torsoScaleNorm)
  const rightSpeed = calculateLandmarkSpeed(rightWristCurr, rightWristPrev, deltaMs, torsoScaleNorm)

  return (leftSpeed + rightSpeed) / 2
}

/**
 * Calculate foot speed (ankles) between two frames
 */
export function calculateFootSpeed(
  current: NormalizedLandmark[],
  previous: NormalizedLandmark[],
  deltaMs: number,
  torsoScaleNorm: number
): number {
  const leftAnkleCurr = current[POSE_LANDMARKS.LEFT_ANKLE]
  const rightAnkleCurr = current[POSE_LANDMARKS.RIGHT_ANKLE]
  const leftAnklePrev = previous[POSE_LANDMARKS.LEFT_ANKLE]
  const rightAnklePrev = previous[POSE_LANDMARKS.RIGHT_ANKLE]

  if (!leftAnkleCurr || !rightAnkleCurr || !leftAnklePrev || !rightAnklePrev) return 0

  const leftSpeed = calculateLandmarkSpeed(leftAnkleCurr, leftAnklePrev, deltaMs, torsoScaleNorm)
  const rightSpeed = calculateLandmarkSpeed(rightAnkleCurr, rightAnklePrev, deltaMs, torsoScaleNorm)

  return (leftSpeed + rightSpeed) / 2
}

/**
 * Calculate hip speed (center of hips) between two frames
 */
export function calculateHipSpeed(
  current: NormalizedLandmark[],
  previous: NormalizedLandmark[],
  deltaMs: number,
  torsoScaleNorm: number
): number {
  const leftHipCurr = current[POSE_LANDMARKS.LEFT_HIP]
  const rightHipCurr = current[POSE_LANDMARKS.RIGHT_HIP]
  const leftHipPrev = previous[POSE_LANDMARKS.LEFT_HIP]
  const rightHipPrev = previous[POSE_LANDMARKS.RIGHT_HIP]

  if (!leftHipCurr || !rightHipCurr || !leftHipPrev || !rightHipPrev) return 0

  // Calculate center of hips
  const hipCenterCurr: NormalizedLandmark = {
    x: (leftHipCurr.x + rightHipCurr.x) / 2,
    y: (leftHipCurr.y + rightHipCurr.y) / 2,
    z: ((leftHipCurr.z ?? 0) + (rightHipCurr.z ?? 0)) / 2,
    visibility: Math.min(leftHipCurr.visibility ?? 1, rightHipCurr.visibility ?? 1),
  }
  const hipCenterPrev: NormalizedLandmark = {
    x: (leftHipPrev.x + rightHipPrev.x) / 2,
    y: (leftHipPrev.y + rightHipPrev.y) / 2,
    z: ((leftHipPrev.z ?? 0) + (rightHipPrev.z ?? 0)) / 2,
    visibility: Math.min(leftHipPrev.visibility ?? 1, rightHipPrev.visibility ?? 1),
  }

  return calculateLandmarkSpeed(hipCenterCurr, hipCenterPrev, deltaMs, torsoScaleNorm)
}

/**
 * Calculate burst speed (max speed over recent history window)
 */
export function calculateBurstSpeed(history: LandmarkHistory[], landmarkIndex: number, windowMs: number = 500): number {
  if (history.length < 2) return 0

  const now = history[history.length - 1].timestampMs
  const windowStart = now - windowMs

  let maxSpeed = 0
  for (let i = history.length - 1; i > 0; i--) {
    const curr = history[i]
    const prev = history[i - 1]

    if (curr.timestampMs < windowStart) break

    const deltaMs = curr.timestampMs - prev.timestampMs
    if (deltaMs <= 0) continue

    const currLm = curr.landmarks[landmarkIndex]
    const prevLm = prev.landmarks[landmarkIndex]
    if (!currLm || !prevLm) continue

    // Use shoulder width as quick torso scale estimate
    const leftShoulder = curr.landmarks[POSE_LANDMARKS.LEFT_SHOULDER]
    const rightShoulder = curr.landmarks[POSE_LANDMARKS.RIGHT_SHOULDER]
    const torsoScaleNorm = leftShoulder && rightShoulder ? landmarkDistance(leftShoulder, rightShoulder) : 0.2

    const speed = calculateLandmarkSpeed(currLm, prevLm, deltaMs, torsoScaleNorm)
    if (speed > maxSpeed) maxSpeed = speed
  }

  return maxSpeed
}

/**
 * Calculate power index (combination of hand burst and hip engagement)
 */
export function calculatePowerIndex(handBurst: number, hipSpeed: number): number {
  // Power = hand speed with hip engagement multiplier
  // Hip engagement above 0.5 bw/s indicates good weight transfer
  const hipMultiplier = 1 + Math.min(hipSpeed, 2) * 0.3
  return handBurst * hipMultiplier
}

/**
 * Calculate distance between two fighters (hip centers) in body-widths
 */
export function calculateFighterDistance(
  landmarksA: NormalizedLandmark[],
  landmarksB: NormalizedLandmark[],
  avgTorsoScaleNorm: number
): number {
  const leftHipA = landmarksA[POSE_LANDMARKS.LEFT_HIP]
  const rightHipA = landmarksA[POSE_LANDMARKS.RIGHT_HIP]
  const leftHipB = landmarksB[POSE_LANDMARKS.LEFT_HIP]
  const rightHipB = landmarksB[POSE_LANDMARKS.RIGHT_HIP]

  if (!leftHipA || !rightHipA || !leftHipB || !rightHipB) return 0

  const hipCenterA: NormalizedLandmark = {
    x: (leftHipA.x + rightHipA.x) / 2,
    y: (leftHipA.y + rightHipA.y) / 2,
    z: ((leftHipA.z ?? 0) + (rightHipA.z ?? 0)) / 2,
    visibility: 1,
  }
  const hipCenterB: NormalizedLandmark = {
    x: (leftHipB.x + rightHipB.x) / 2,
    y: (leftHipB.y + rightHipB.y) / 2,
    z: ((leftHipB.z ?? 0) + (rightHipB.z ?? 0)) / 2,
    visibility: 1,
  }

  const dist = landmarkDistance(hipCenterA, hipCenterB)
  return avgTorsoScaleNorm > 0 ? dist / avgTorsoScaleNorm : 0
}

/**
 * Determine range band based on distance in body-widths
 */
export function getRangeBand(distanceBw: number): 'close' | 'mid' | 'long' {
  if (distanceBw < 1.5) return 'close'
  if (distanceBw < 3.0) return 'mid'
  return 'long'
}

/**
 * Calculate closing speed between two fighters
 */
export function calculateClosingSpeed(
  historyA: LandmarkHistory[],
  historyB: LandmarkHistory[],
  avgTorsoScaleNorm: number
): number {
  if (historyA.length < 2 || historyB.length < 2) return 0

  const currA = historyA[historyA.length - 1]
  const prevA = historyA[historyA.length - 2]
  const currB = historyB[historyB.length - 1]
  const prevB = historyB[historyB.length - 2]

  const currDist = calculateFighterDistance(currA.landmarks, currB.landmarks, avgTorsoScaleNorm)
  const prevDist = calculateFighterDistance(prevA.landmarks, prevB.landmarks, avgTorsoScaleNorm)

  const deltaMs = currA.timestampMs - prevA.timestampMs
  if (deltaMs <= 0) return 0

  // Negative = closing, positive = separating
  return (prevDist - currDist) / (deltaMs / 1000)
}

/**
 * Compute full kinematics snapshot from pose history
 */
export function computeKinematicsSnapshot(
  poseHistory: PoseHistory,
  videoTimeSec: number | null,
  canvasWidth: number
): KinematicsSnapshot {
  const now = Date.now()
  const historyA = poseHistory.A
  const historyB = poseHistory.B

  const snapshot: KinematicsSnapshot = {
    capturedAtMs: now,
    videoTimeSec,
    posesDetected: (historyA.length > 0 ? 1 : 0) + (historyB.length > 0 ? 1 : 0),
    fighters: {},
  }

  // Calculate kinematics for Fighter A
  if (historyA.length >= 2) {
    const curr = historyA[historyA.length - 1]
    const prev = historyA[historyA.length - 2]
    const deltaMs = curr.timestampMs - prev.timestampMs

    const torsoScalePx = calculateTorsoScale(curr.landmarks, canvasWidth)
    const torsoScaleNorm = torsoScalePx / canvasWidth

    const handSpeed = calculateHandSpeed(curr.landmarks, prev.landmarks, deltaMs, torsoScaleNorm)
    const footSpeed = calculateFootSpeed(curr.landmarks, prev.landmarks, deltaMs, torsoScaleNorm)
    const hipSpeed = calculateHipSpeed(curr.landmarks, prev.landmarks, deltaMs, torsoScaleNorm)
    const handBurst = Math.max(
      calculateBurstSpeed(historyA, POSE_LANDMARKS.LEFT_WRIST),
      calculateBurstSpeed(historyA, POSE_LANDMARKS.RIGHT_WRIST)
    )
    const powerIndex = calculatePowerIndex(handBurst, hipSpeed)

    snapshot.fighters.A = {
      torsoScalePx,
      handSpeedBwps: handSpeed,
      handBurstBwps: handBurst,
      footSpeedBwps: footSpeed,
      hipSpeedBwps: hipSpeed,
      powerIndex,
    }
  }

  // Calculate kinematics for Fighter B
  if (historyB.length >= 2) {
    const curr = historyB[historyB.length - 1]
    const prev = historyB[historyB.length - 2]
    const deltaMs = curr.timestampMs - prev.timestampMs

    const torsoScalePx = calculateTorsoScale(curr.landmarks, canvasWidth)
    const torsoScaleNorm = torsoScalePx / canvasWidth

    const handSpeed = calculateHandSpeed(curr.landmarks, prev.landmarks, deltaMs, torsoScaleNorm)
    const footSpeed = calculateFootSpeed(curr.landmarks, prev.landmarks, deltaMs, torsoScaleNorm)
    const hipSpeed = calculateHipSpeed(curr.landmarks, prev.landmarks, deltaMs, torsoScaleNorm)
    const handBurst = Math.max(
      calculateBurstSpeed(historyB, POSE_LANDMARKS.LEFT_WRIST),
      calculateBurstSpeed(historyB, POSE_LANDMARKS.RIGHT_WRIST)
    )
    const powerIndex = calculatePowerIndex(handBurst, hipSpeed)

    snapshot.fighters.B = {
      torsoScalePx,
      handSpeedBwps: handSpeed,
      handBurstBwps: handBurst,
      footSpeedBwps: footSpeed,
      hipSpeedBwps: hipSpeed,
      powerIndex,
    }
  }

  // Calculate range if both fighters detected
  if (historyA.length > 0 && historyB.length > 0) {
    const currA = historyA[historyA.length - 1]
    const currB = historyB[historyB.length - 1]

    const torsoA = calculateTorsoScale(currA.landmarks, canvasWidth) / canvasWidth
    const torsoB = calculateTorsoScale(currB.landmarks, canvasWidth) / canvasWidth
    const avgTorsoScaleNorm = (torsoA + torsoB) / 2

    const distanceBw = calculateFighterDistance(currA.landmarks, currB.landmarks, avgTorsoScaleNorm)
    const closingBwps = calculateClosingSpeed(historyA, historyB, avgTorsoScaleNorm)
    const band = getRangeBand(distanceBw)

    snapshot.range = { distanceBw, closingBwps, band }
  }

  return snapshot
}

/**
 * Rein in anatomically-impossible LEG extension.
 *
 * In a clinch/overlap MediaPipe sometimes traces one fighter's lower leg onto
 * the OTHER fighter, throwing an ankle/foot far across the frame — a splayed
 * "bone" that cannot physically exist (a thigh/shank is a near-rigid length in
 * image space; perspective foreshortening only ever SHORTENS it, never the
 * reverse). Walking out from the hips (part of the stable torso anchor), any
 * leg joint sitting implausibly far from its parent is pulled back along the
 * bone direction, capped to a multiple of the body's own scale. Real
 * footwork/kicks stay within length and are untouched; only the cross-fighter
 * splay (the source of nonsense stance-width readings) is clamped.
 *
 * Legs only — arms keep their tuned punch responsiveness.
 */
export function clampLegSplay(landmarks: NormalizedLandmark[]): NormalizedLandmark[] {
  if (!landmarks || landmarks.length < 33) return landmarks
  // Body scale that survives a bent-over fighter: torso height OR shoulder span.
  const scx = (landmarks[11].x + landmarks[12].x) / 2
  const scy = (landmarks[11].y + landmarks[12].y) / 2
  const hcx = (landmarks[23].x + landmarks[24].x) / 2
  const hcy = (landmarks[23].y + landmarks[24].y) / 2
  const torsoH = Math.hypot(scx - hcx, scy - hcy)
  const shoulderW = Math.hypot(landmarks[11].x - landmarks[12].x, landmarks[11].y - landmarks[12].y)
  const scale = Math.max(torsoH, shoulderW)
  if (!(scale > 0.02)) return landmarks // scale unreliable — don't risk a false clamp

  const out = landmarks.map((l) => ({ ...l }))
  const pull = (parent: number, child: number, maxLen: number) => {
    const dx = out[child].x - out[parent].x
    const dy = out[child].y - out[parent].y
    const len = Math.hypot(dx, dy)
    if (len > maxLen && len > 1e-6) {
      const k = maxLen / len
      out[child] = { ...out[child], x: out[parent].x + dx * k, y: out[parent].y + dy * k }
    }
  }
  // hip → knee → ankle → heel/foot, per side. Thigh≈shank≈torso, so 1.8× scale
  // is generous for real foreshortened legs yet well under the 2.5×+ splay.
  for (const [hip, knee, ankle, heel, foot] of [
    [23, 25, 27, 29, 31],
    [24, 26, 28, 30, 32],
  ] as const) {
    pull(hip, knee, 1.8 * scale)
    pull(knee, ankle, 1.8 * scale)
    pull(ankle, heel, 0.9 * scale)
    pull(ankle, foot, 0.9 * scale)
  }
  return out
}

/**
 * Apply exponential moving average smoothing to landmarks.
 * Blends current frame with previous frame to reduce jitter.
 * @param current  Current frame landmarks
 * @param previous Previous frame landmarks (or null for first frame)
 * @param alpha    Weight for current frame (0-1). Higher = less smoothing.
 */
export function smoothLandmarks(
  current: NormalizedLandmark[],
  previous: NormalizedLandmark[] | null,
  alpha: number = 0.6
): NormalizedLandmark[] {
  // Clamp cross-fighter leg splay BEFORE the EMA so a thrown ankle is corrected
  // rather than blended into the cached track. Shared chokepoint: live, dense
  // pass, and offline replay all route through here.
  current = clampLegSplay(current)
  if (!previous || previous.length !== current.length) return current

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value))

  // Whole-body (torso-center) displacement this frame. The foot-pop guard below
  // measures leg motion RELATIVE to this so a foot moving WITH a walking/lunging
  // fighter (high absolute motion, low body-relative motion) is not mistaken for
  // a spurious detection pop and damped — which would lag strikes and footwork.
  const tcCur = getTorsoCenter(current)
  const tcPrev = getTorsoCenter(previous)
  const bodyDx = tcCur.x - tcPrev.x
  const bodyDy = tcCur.y - tcPrev.y

  return current.map((lm, i) => {
    const prev = previous[i]
    if (!lm || !prev) return lm
    const visibility = lm.visibility ?? 1
    // Skip smoothing for very-low-visibility landmarks — use previous position.
    // Lowered from 0.12 → 0.06: during occlusion, partially-visible landmarks
    // (e.g. an arm poking out from behind the other fighter) often have
    // visibility 0.08–0.12. The old threshold was discarding these and snapping
    // to the stale previous position, which caused the skeleton to "stick" in
    // place instead of tracking the visible portion of the fighter.
    if (visibility < 0.06) {
      return {
        ...prev,
        visibility,
      } as NormalizedLandmark
    }

    // Adaptive alpha per body region and per-frame motion so strikes and footwork
    // stay attached to the fighter instead of dragging behind the video.
    //
    // Region tuning (single pass):
    //   0-10   head/face   → stable, slight smoothing (alpha - 0.05)
    //   11-14  torso       → base alpha (anchor for identity tracking)
    //   15-22  arms/hands  → responsive (alpha + 0.08) — punches land on same frame
    //   23-32  legs/feet   → moderately smoothed (alpha - 0.10) — footwork stays planted
    //
    // Torso smoothing is slightly tighter than before to keep the identity
    // anchor stable during occlusion recovery. Arms are slightly less aggressive
    // (was +0.1, now +0.08) to reduce jitter on reacquisition.
    let a = alpha
    if (i <= 10) a = alpha - 0.05
    else if (i >= 15 && i <= 22) a = Math.min(alpha + 0.08, 0.95)
    else if (i >= 23) a = Math.max(alpha - 0.10, 0.40)

    const motion = Math.hypot(lm.x - prev.x, lm.y - prev.y)
    // Legs/feet (>=23) get a much smaller motion-boost: a planted foot that
    // "jumps" between frames is almost always a spurious detection pop, not real
    // motion, so the boost must not let it through. Arms/hands keep the
    // responsive boost so punches land on the same frame.
    const isLeg = i >= 23
    const motionBoost = Math.min(isLeg ? 0.06 : 0.18, motion * 3.5)
    // Spurious foot-pop guard, measured RELATIVE to the body (foot motion minus
    // whole-body motion) so only a foot that jumps INDEPENDENTLY of the body is
    // damped — a foot travelling with a fast lunge/step is left responsive:
    //   - an EXTREME body-relative jump (>0.14) is noise even at high reported
    //     confidence (MediaPipe is often over-confident on foot pops),
    //   - a moderate one (>0.08) is noise only when visibility is also weak.
    // The joint is then pulled hard toward its previous position. Real footwork
    // moves the foot continuously over several frames, not in one hop.
    let legJumpPenalty = 0
    if (isLeg) {
      const relMotion = Math.hypot((lm.x - prev.x) - bodyDx, (lm.y - prev.y) - bodyDy)
      legJumpPenalty = relMotion > 0.14 ? 0.45 : relMotion > 0.08 && visibility < 0.7 ? 0.3 : 0
    }
    // Body-relative teleport rejection for arms (15-22) and head (0-10). Unlike
    // legs, these have no pop guard, so a noisy frame can fling the hand/head
    // across the frame and the motionBoost above would pass it through as if it
    // were real motion. A real strike moves the hand only ~0.1-0.15 frame-units
    // body-relative; a noise teleport reads far higher. The head barely moves
    // body-relative ever, so it gets a tighter gate. Thresholds sit ABOVE
    // real-strike range so genuine punches still land on-frame.
    let popPenalty = 0
    if ((i >= 15 && i <= 22) || i <= 10) {
      const relMotion = Math.hypot((lm.x - prev.x) - bodyDx, (lm.y - prev.y) - bodyDy)
      const hardT = i <= 10 ? 0.12 : 0.22
      const softT = i <= 10 ? 0.08 : 0.15
      popPenalty = relMotion > hardT ? 0.5 : relMotion > softT && visibility < 0.6 ? 0.3 : 0
    }
    const visibilityPenalty = visibility < 0.45 ? (0.45 - visibility) * 0.5 : 0
    a = clamp(a + motionBoost - visibilityPenalty - legJumpPenalty - popPenalty, 0.3, 0.96)

    return {
      x: a * lm.x + (1 - a) * prev.x,
      y: a * lm.y + (1 - a) * prev.y,
      z: a * (lm.z ?? 0) + (1 - a) * (prev.z ?? 0),
      visibility: lm.visibility,
    } as NormalizedLandmark
  })
}

/**
 * Linear blend between two poses (same slot, e.g. fighter A at t0 vs t1).
 * Used by the overlay to align the drawn skeleton to `video.currentTime` in milliseconds
 * between the last two MediaPipe samples (sub–pose-sample timing).
 */
export function blendPoses(
  a: NormalizedLandmark[] | null,
  b: NormalizedLandmark[] | null,
  u: number
): NormalizedLandmark[] | null {
  if (!b && !a) return null
  if (!b) return a
  if (!a) return b
  if (a.length !== b.length) return b
  const t = Math.max(0, Math.min(1, u))
  return a.map((lm, i) => {
    const m = b[i]
    if (!lm || !m) return (m ?? lm) as NormalizedLandmark
    return {
      ...lm,
      x: lm.x * (1 - t) + m.x * t,
      y: lm.y * (1 - t) + m.y * t,
      z: (lm.z ?? 0) * (1 - t) + (m.z ?? 0) * t,
      visibility: Math.min(lm.visibility ?? 1, m.visibility ?? 1),
    } as NormalizedLandmark
  })
}

export function blendPosePair(
  p0: { A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null },
  p1: { A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null },
  u: number
): { A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null } {
  return {
    A: blendPoses(p0.A, p1.A, u),
    B: blendPoses(p0.B, p1.B, u),
  }
}

/**
 * Draw skeleton overlay on canvas for a single pose
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  canvasWidth: number,
  canvasHeight: number,
  color: { line: string; joint: string; glow: string },
  lineWidth: number = 3
): void {
  if (!landmarks || landmarks.length < 33) return

  ctx.save()

  // Draw glow effect
  ctx.shadowColor = color.glow
  ctx.shadowBlur = 8

  // Draw connections
  ctx.strokeStyle = color.line
  ctx.lineWidth = lineWidth
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Per-joint visibility threshold: lower for legs/feet to avoid vanishing during occlusion
  const visThreshold = (idx: number) => idx >= 23 ? 0.3 : 0.5

  for (const [startIdx, endIdx] of POSE_CONNECTIONS) {
    const start = landmarks[startIdx]
    const end = landmarks[endIdx]

    if (!start || !end) continue
    if ((start.visibility ?? 1) < visThreshold(startIdx) || (end.visibility ?? 1) < visThreshold(endIdx)) continue

    const x1 = start.x * canvasWidth
    const y1 = start.y * canvasHeight
    const x2 = end.x * canvasWidth
    const y2 = end.y * canvasHeight

    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
  }

  // Draw joints
  ctx.shadowBlur = 4
  ctx.fillStyle = color.joint

  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i]
    if (!lm || (lm.visibility ?? 1) < visThreshold(i)) continue

    const x = lm.x * canvasWidth
    const y = lm.y * canvasHeight
    const radius = i <= 10 ? 4 : 6 // Smaller for face landmarks

    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  ctx.restore()
}

/**
 * Draw label for a fighter near their head
 */
export function drawFighterLabel(
  ctx: CanvasRenderingContext2D,
  landmarks: NormalizedLandmark[],
  canvasWidth: number,
  canvasHeight: number,
  label: string,
  color: string
): void {
  const nose = landmarks[POSE_LANDMARKS.NOSE]
  if (!nose || (nose.visibility ?? 1) < 0.5) return

  const x = nose.x * canvasWidth
  const y = nose.y * canvasHeight - 30

  ctx.save()
  ctx.font = 'bold 16px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'

  // Background
  const metrics = ctx.measureText(label)
  const padding = 6
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)'
  ctx.fillRect(
    x - metrics.width / 2 - padding,
    y - 18,
    metrics.width + padding * 2,
    22
  )

  // Text
  ctx.fillStyle = color
  ctx.fillText(label, x, y)

  ctx.restore()
}

/**
 * Sort detected poses by x-position (left = A, right = B)
 */
export function assignFightersByPosition(
  poses: NormalizedLandmark[][]
): { A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null } {
  if (poses.length === 0) return { A: null, B: null }
  if (poses.length === 1) return { A: poses[0], B: null }

  // Sort by hip center x-position
  const sorted = [...poses].sort((a, b) => {
    const hipCenterA = (a[POSE_LANDMARKS.LEFT_HIP]?.x ?? 0.5) + (a[POSE_LANDMARKS.RIGHT_HIP]?.x ?? 0.5)
    const hipCenterB = (b[POSE_LANDMARKS.LEFT_HIP]?.x ?? 0.5) + (b[POSE_LANDMARKS.RIGHT_HIP]?.x ?? 0.5)
    return hipCenterA - hipCenterB
  })

  return { A: sorted[0], B: sorted[1] || null }
}

/**
 * Get hip center for a pose (average of left and right hip)
 */
function getHipCenter(landmarks: NormalizedLandmark[]): { x: number; y: number } {
  const lh = landmarks[POSE_LANDMARKS.LEFT_HIP]
  const rh = landmarks[POSE_LANDMARKS.RIGHT_HIP]
  return {
    x: ((lh?.x ?? 0.5) + (rh?.x ?? 0.5)) / 2,
    y: ((lh?.y ?? 0.5) + (rh?.y ?? 0.5)) / 2,
  }
}

function getShoulderCenter(landmarks: NormalizedLandmark[]): { x: number; y: number } {
  const ls = landmarks[POSE_LANDMARKS.LEFT_SHOULDER]
  const rs = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER]
  return {
    x: ((ls?.x ?? 0.5) + (rs?.x ?? 0.5)) / 2,
    y: ((ls?.y ?? 0.5) + (rs?.y ?? 0.5)) / 2,
  }
}

export function getTorsoCenter(landmarks: NormalizedLandmark[]): { x: number; y: number } {
  const hips = getHipCenter(landmarks)
  const shoulders = getShoulderCenter(landmarks)
  return {
    x: (hips.x + shoulders.x) / 2,
    y: (hips.y + shoulders.y) / 2,
  }
}

function getTorsoScaleNorm(landmarks: NormalizedLandmark[]): number {
  const ls = landmarks[POSE_LANDMARKS.LEFT_SHOULDER]
  const rs = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER]
  const lh = landmarks[POSE_LANDMARKS.LEFT_HIP]
  const rh = landmarks[POSE_LANDMARKS.RIGHT_HIP]
  if (!ls || !rs || !lh || !rh) return 0

  const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y)
  const hipWidth = Math.hypot(lh.x - rh.x, lh.y - rh.y)
  const torsoHeight =
    (Math.hypot(ls.x - lh.x, ls.y - lh.y) + Math.hypot(rs.x - rh.x, rs.y - rh.y)) / 2
  return Math.max(shoulderWidth, hipWidth, torsoHeight * 0.7)
}

function getHeadOffsetFromTorso(landmarks: NormalizedLandmark[]): { x: number; y: number } {
  const torso = getTorsoCenter(landmarks)
  const nose = landmarks[POSE_LANDMARKS.NOSE]
  return {
    x: (nose?.x ?? torso.x) - torso.x,
    y: (nose?.y ?? torso.y) - torso.y,
  }
}

function projectLandmarksForward(
  previous: NormalizedLandmark[],
  previous2: NormalizedLandmark[] | null
): NormalizedLandmark[] | null {
  if (!previous2 || previous2.length !== previous.length) return null

  const clamp = (value: number) => Math.max(0, Math.min(1, value))
  // Raised from 0.08 → 0.18: fighters in fast exchanges (hooks, level changes,
  // takedown entries) can move 10-15% of frame width between pose samples at
  // 25 Hz. The old 8% cap truncated the velocity vector, making the projection
  // undershoot and the cost function unable to distinguish crossed fighters.
  const maxStep = 0.18
  // Raised from 1.3 → 1.6: the projection must overshoot slightly so the
  // predicted position is *ahead* of where the fighter will be — this makes
  // the cost function strongly prefer the correct assignment even when both
  // fighters are within a body-width of each other.
  const projectionScale = 1.6

  return previous.map((lm, i) => {
    const older = previous2[i]
    if (!lm || !older) return lm
    const dx = Math.max(-maxStep, Math.min(maxStep, lm.x - older.x))
    const dy = Math.max(-maxStep, Math.min(maxStep, lm.y - older.y))
    const dz = Math.max(-maxStep, Math.min(maxStep, (lm.z ?? 0) - (older.z ?? 0)))
    return {
      x: clamp(lm.x + dx * projectionScale),
      y: clamp(lm.y + dy * projectionScale),
      z: (lm.z ?? 0) + dz * projectionScale,
      visibility: Math.min(lm.visibility ?? 1, older.visibility ?? 1),
    } as NormalizedLandmark
  })
}

/**
 * Compute a lightweight "body proportion hash" — the ratio of shoulder width
 * to torso height. This is roughly constant for a given person regardless of
 * position on screen, so it acts as a weak biometric identity signal that
 * helps distinguish Fighter A from Fighter B even when they overlap.
 */
export function bodyProportionSignature(landmarks: NormalizedLandmark[]): number {
  const ls = landmarks[POSE_LANDMARKS.LEFT_SHOULDER]
  const rs = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER]
  const lh = landmarks[POSE_LANDMARKS.LEFT_HIP]
  const rh = landmarks[POSE_LANDMARKS.RIGHT_HIP]
  if (!ls || !rs || !lh || !rh) return 0
  const shoulderWidth = Math.hypot(ls.x - rs.x, ls.y - rs.y)
  const torsoHeight =
    (Math.hypot(ls.x - lh.x, ls.y - lh.y) + Math.hypot(rs.x - rh.x, rs.y - rh.y)) / 2
  return torsoHeight > 0.01 ? shoulderWidth / torsoHeight : 0
}

/**
 * Compute the velocity vector of the torso center between two frames.
 * Returns {vx, vy} in normalized coords per frame.
 */
export function getTorsoVelocity(
  current: NormalizedLandmark[],
  previous: NormalizedLandmark[] | null
): { vx: number; vy: number } {
  if (!previous) return { vx: 0, vy: 0 }
  const tc = getTorsoCenter(current)
  const tp = getTorsoCenter(previous)
  return { vx: tc.x - tp.x, vy: tc.y - tp.y }
}

function baseMatchCost(current: NormalizedLandmark[], reference: NormalizedLandmark[]): number {
  const hipC = getHipCenter(current)
  const hipP = getHipCenter(reference)
  const hipDist = Math.hypot(hipC.x - hipP.x, hipC.y - hipP.y)

  const shC = getShoulderCenter(current)
  const shP = getShoulderCenter(reference)
  const shDist = Math.hypot(shC.x - shP.x, shC.y - shP.y)

  const torsoC = getTorsoCenter(current)
  const torsoP = getTorsoCenter(reference)
  const torsoDist = Math.hypot(torsoC.x - torsoP.x, torsoC.y - torsoP.y)

  const torsoScaleDist = Math.abs(getTorsoScaleNorm(current) - getTorsoScaleNorm(reference))

  const headOffsetC = getHeadOffsetFromTorso(current)
  const headOffsetP = getHeadOffsetFromTorso(reference)
  const headOffsetDist =
    Math.abs(headOffsetC.x - headOffsetP.x) + Math.abs(headOffsetC.y - headOffsetP.y)

  // Body proportion similarity — weak biometric that helps during occlusion.
  // The ratio of shoulder-width to torso-height is roughly constant per person.
  const propCurrent = bodyProportionSignature(current)
  const propRef = bodyProportionSignature(reference)
  const propDist = propCurrent > 0 && propRef > 0 ? Math.abs(propCurrent - propRef) : 0

  return (
    hipDist * 0.24 +           // Reduced: hips drift during occlusion
    shDist * 0.18 +            // Reduced: shoulders obscured during crossing
    torsoDist * 0.15 +         // Reduced: torso center ambiguous
    torsoScaleDist * 0.08 +    // Reduced: scale unreliable under occlusion
    headOffsetDist * 0.12 +    // Increased: head position is most stable
    propDist * 0.23            // INCREASED: body proportion is fighter's "fingerprint"
  )
  // During occlusion, position signals are weak. Body proportions are stable
  // biometrics that survive crossing — a tall/narrow fighter stays tall/narrow.
}

/**
 * Multi-point matching cost with short-horizon motion prediction AND velocity
 * continuity. We compare against both the last seen pose and a one-step
 * projection built from the two most recent frames, which helps preserve
 * identity when fighters cross or exchange positions quickly.
 *
 * NEW: velocity continuity bonus — if the candidate pose is moving in the
 * same direction as the reference fighter was moving, the cost is reduced.
 * This is the single most effective signal during crossings: fighter A was
 * moving left → the next-frame pose that’s also moving left is almost
 * certainly still fighter A, even if fighter B is now closer in position.
 */
function matchCost(
  current: NormalizedLandmark[],
  previous: NormalizedLandmark[],
  previous2: NormalizedLandmark[] | null = null
): number {
  const directCost = baseMatchCost(current, previous)
  const projected = projectLandmarksForward(previous, previous2)
  if (!projected) {
    return directCost
  }
  const projectedCost = baseMatchCost(current, projected)

  // Velocity continuity: compare the direction the reference fighter was
  // moving (previous2 → previous) with the direction the candidate is
  // moving relative to the reference (previous → current). If they agree,
  // reduce cost; if they disagree (reversal), increase cost.
  let velocityCost = 0
  if (previous2) {
    const refVel = getTorsoVelocity(previous, previous2)
    const candVel = getTorsoVelocity(current, previous)
    const refSpeed = Math.hypot(refVel.vx, refVel.vy)
    const candSpeed = Math.hypot(candVel.vx, candVel.vy)
    // Only apply when both have meaningful motion (> 0.5% of frame per tick)
    if (refSpeed > 0.005 && candSpeed > 0.005) {
      // Cosine similarity: +1 = same direction, -1 = opposite
      const dot = refVel.vx * candVel.vx + refVel.vy * candVel.vy
      const cosSim = dot / (refSpeed * candSpeed)
      // CRITICAL: Velocity continuity is the strongest signal during crossing.
      // A fighter moving left at frame N will still be moving left at frame N+1.
      // Increased from 0.06 → 0.22 to make motion trajectory DOMINATE position
      // during occlusion. This prevents the system from swapping A↔B when they cross.
      // Map [-1, +1] → [+penalty, -bonus]: opposite direction adds cost,
      // same direction subtracts cost massively.
      velocityCost = -cosSim * 0.22
    }
  }

  // During occlusion, projected cost (motion prediction) is most reliable.
  // During recovery, direct cost prevents snapping. Velocity helps both.
  // Increased velocity weight from implicit to explicit priority.
  return projectedCost * 0.65 + directCost * 0.10 + velocityCost + 0.25 * Math.min(directCost, projectedCost)
}

/**
 * Assign fighters with temporal persistence — uses closest-match to previous
 * frame's hip + shoulder centers to prevent identity swapping when fighters cross.
 * Falls back to positional sort on first detection or when distance is too large.
 *
 * UPGRADED: When the cost-based assignment is ambiguous (fighters overlapping),
 * instead of falling back to positional sort (which CAUSES identity swaps when
 * fighters cross sides), we now use a velocity-continuity tiebreaker. This
 * keeps identity locked to the fighter's motion trajectory rather than their
 * screen position.
 */
export function assignFightersWithTracking(
  poses: NormalizedLandmark[][],
  prevA: NormalizedLandmark[] | null,
  prevB: NormalizedLandmark[] | null,
  prevPrevA: NormalizedLandmark[] | null = null,
  prevPrevB: NormalizedLandmark[] | null = null
): { A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null } {
  if (poses.length === 0) return { A: null, B: null }

  // Reduced from 0.10 → 0.04: During occlusion, we NEVER want to swap just
  // because position got ambiguous. With the new strong velocity signal (0.22 weight),
  // we require an EXTREMELY clear cost winner (4% margin) to swap. Otherwise,
  // we keep the previous assignment (sticky identity). This prevents A↔B confusion
  // during crossing when position signals are unreliable.
  const SWAP_MARGIN = 0.04

  if (poses.length === 1) {
    if (prevA && prevB) {
      const costA = matchCost(poses[0], prevA, prevPrevA)
      const costB = matchCost(poses[0], prevB, prevPrevB)
      const [lo, hi] = costA <= costB ? [costA, costB] : [costB, costA]
      const clearWinner = hi - lo > lo * SWAP_MARGIN
      if (!clearWinner) {
        // Ambiguous — use velocity-continuity tiebreaker instead of
        // positional sort. If the detected pose is moving in the same
        // direction as prevA was, it’s probably A; likewise for B.
        if (prevPrevA && prevPrevB) {
          const velA = getTorsoVelocity(prevA, prevPrevA)
          const velB = getTorsoVelocity(prevB, prevPrevB)
          const candVelFromA = getTorsoVelocity(poses[0], prevA)
          const candVelFromB = getTorsoVelocity(poses[0], prevB)
          const dotA = velA.vx * candVelFromA.vx + velA.vy * candVelFromA.vy
          const dotB = velB.vx * candVelFromB.vx + velB.vy * candVelFromB.vy
          if (Math.abs(dotA - dotB) > 0.0001) {
            return dotA >= dotB ? { A: poses[0], B: null } : { A: null, B: poses[0] }
          }
        }
        // Final fallback: proximity to previous positions (NOT positional sort)
        const prevAx = (prevA[23]?.x ?? prevA[11]?.x ?? 0.3)
        const prevBx = (prevB[23]?.x ?? prevB[11]?.x ?? 0.7)
        const poseX = (poses[0][23]?.x ?? poses[0][11]?.x ?? 0.5)
        const distA = Math.abs(poseX - prevAx)
        const distB = Math.abs(poseX - prevBx)
        return distA <= distB ? { A: poses[0], B: null } : { A: null, B: poses[0] }
      }
      return costA <= costB ? { A: poses[0], B: null } : { A: null, B: poses[0] }
    }
    return { A: poses[0], B: null }
  }

  if (!prevA || !prevB) {
    return assignFightersByPosition(poses)
  }

  // Two poses detected — find best assignment by minimizing total cost
  const cost1 =
    matchCost(poses[0], prevA, prevPrevA) +
    matchCost(poses[1], prevB, prevPrevB)
  const cost2 =
    matchCost(poses[0], prevB, prevPrevB) +
    matchCost(poses[1], prevA, prevPrevA)

  // CRITICAL: Add a "temporal hysteresis" bonus to keep the same assignment.
  // During occlusion, position signals are weak. We HEAVILY penalize swapping
  // unless the new assignment is EXTREMELY better (0.35+ cost reduction).
  // This prevents jitter and identity confusion when fighters overlap.
  // cost1 = straight-through (A→pose[0], B→pose[1])
  // cost2 = swapped (A→pose[1], B→pose[0])
  // Add +0.15 penalty to cost2 to make swapping much harder.
  const cost2WithSwapPenalty = cost2 + 0.15

  const [lo, hi] = cost1 <= cost2WithSwapPenalty ? [cost1, cost2WithSwapPenalty] : [cost2WithSwapPenalty, cost1]
  const clearWinner = hi - lo > lo * SWAP_MARGIN
  if (!clearWinner) {
    // CRITICAL CHANGE: instead of falling back to positional sort (which
    // swaps identities every time fighters cross the midline), use a
    // velocity-continuity tiebreaker. Each pose is tested against the
    // velocity trajectory of each fighter; the assignment that preserves
    // motion direction wins.
    if (prevPrevA && prevPrevB) {
      const velA = getTorsoVelocity(prevA, prevPrevA)
      const velB = getTorsoVelocity(prevB, prevPrevB)

      // For assignment 1: pose[0]→A, pose[1]→B
      const v0fromA = getTorsoVelocity(poses[0], prevA)
      const v1fromB = getTorsoVelocity(poses[1], prevB)
      const cont1 =
        (velA.vx * v0fromA.vx + velA.vy * v0fromA.vy) +
        (velB.vx * v1fromB.vx + velB.vy * v1fromB.vy)

      // For assignment 2: pose[0]→B, pose[1]→A
      const v0fromB = getTorsoVelocity(poses[0], prevB)
      const v1fromA = getTorsoVelocity(poses[1], prevA)
      const cont2 =
        (velB.vx * v0fromB.vx + velB.vy * v0fromB.vy) +
        (velA.vx * v1fromA.vx + velA.vy * v1fromA.vy)

      if (Math.abs(cont1 - cont2) > 0.0001) {
        // Higher continuity = better match (dot products are positive when
        // directions agree)
        return cont1 >= cont2
          ? { A: poses[0], B: poses[1] }
          : { A: poses[1], B: poses[0] }
      }
    }

    // If velocity tiebreaker is also ambiguous, KEEP the previous assignment
    // (straight-through) rather than falling back to positional sort.
    // This is the "sticky identity" principle: when in doubt, don't swap.
    return cost1 <= cost2WithSwapPenalty ? { A: poses[0], B: poses[1] } : { A: poses[1], B: poses[0] }
  }

  return cost1 <= cost2WithSwapPenalty ? { A: poses[0], B: poses[1] } : { A: poses[1], B: poses[0] }
}


/**
 * Prune old entries from history to keep memory bounded
 */
export function pruneHistory(history: LandmarkHistory[], maxAgeMs: number = 2000, maxEntries: number = 60): LandmarkHistory[] {
  const now = Date.now()
  const cutoff = now - maxAgeMs

  let pruned = history.filter((h) => h.timestampMs >= cutoff)
  if (pruned.length > maxEntries) {
    pruned = pruned.slice(-maxEntries)
  }

  return pruned
}
