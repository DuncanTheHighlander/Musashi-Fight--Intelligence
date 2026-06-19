/**
 * Motion Score & Event Detection Service
 *
 * Detects significant fight events from pose velocity data:
 * - Strikes (high hand velocity, classified as jab/cross/hook/uppercut)
 * - Level changes (vertical hip movement)
 * - Stance switches (foot position changes)
 * - Big recoils (defensive movements)
 *
 * Velocities are body-width-normalised (matches the rest of the kinematics
 * pipeline) so the same fighter throwing the same punch fires the same
 * threshold regardless of distance from the camera. Per-fighter event
 * timers — the previous singleton shared timers across A and B, so a
 * Fighter A strike suppressed Fighter B for 200ms.
 */

import {
  POSE_LANDMARKS,
  calculateBurstSpeed,
  calculateLandmarkSpeed,
  calculateTorsoScale,
  landmarkDistance,
  type LandmarkHistory,
} from '@/lib/kinematics'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'

// Event types
export type FightEventKind = 'strike' | 'level_change' | 'stance_switch' | 'recoil' | 'other'
export type StrikeLabel =
  | 'jab' | 'cross'
  | 'lead_hook' | 'rear_hook'
  | 'lead_uppercut' | 'rear_uppercut'
  | 'unknown'

export interface FightEvent {
  id: string
  kind: FightEventKind
  tMs: number
  score: number
  fighterId: 'A' | 'B'
  details?: {
    joint?: string
    velocity?: number
    direction?: 'left' | 'right' | 'up' | 'down'
    strikeLabel?: StrikeLabel       // Only set for kind === 'strike'
    displayLabel?: string           // Human-readable, e.g. "Lead Hook"
    confidence?: number             // 0..1 for classification confidence
  }
}

// Body-widths-per-second thresholds — consistent with kinematics.ts.
export const MOTION_THRESHOLDS = {
  STRIKE_BWPS: 5.0,           // Wrist burst above this = strike attempt
  LEVEL_CHANGE_BWPS: 1.8,     // Hip vertical speed for level change
  STANCE_SWITCH_BWPS: 1.4,    // Foot speed for stance switch
  RECOIL_BWPS: 2.4,           // Head/nose speed for recoil
  MIN_GAP_MS: 200,            // Minimum gap between events of same type, per fighter
  BURST_WINDOW_MS: 250,       // Sliding window used for peak velocity
} as const

const STRIKE_DISPLAY: Record<StrikeLabel, string> = {
  jab: 'Jab',
  cross: 'Cross',
  lead_hook: 'Lead Hook',
  rear_hook: 'Rear Hook',
  lead_uppercut: 'Lead Uppercut',
  rear_uppercut: 'Rear Uppercut',
  unknown: 'Strike',
}

/**
 * Compute the centre of two landmarks (e.g. hip centre).
 */
function getLandmarkCenter(a: NormalizedLandmark, b: NormalizedLandmark): NormalizedLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  }
}

/**
 * Classify a hand strike from arm geometry. Mirrors the offline classifier in
 * lib/compiler/detectors/strikes.ts but operates on a single MediaPipe sample
 * so it can run on the live event-detection path.
 */
function classifyHandStrike(
  landmarks: NormalizedLandmark[],
  prevLandmarks: NormalizedLandmark[],
  isLeftHand: boolean,
  stance: 'orthodox' | 'southpaw' | 'unknown' = 'unknown'
): { label: StrikeLabel; confidence: number } {
  const wristIdx = isLeftHand ? POSE_LANDMARKS.LEFT_WRIST : POSE_LANDMARKS.RIGHT_WRIST
  const elbowIdx = isLeftHand ? POSE_LANDMARKS.LEFT_ELBOW : POSE_LANDMARKS.RIGHT_ELBOW
  const shoulderIdx = isLeftHand ? POSE_LANDMARKS.LEFT_SHOULDER : POSE_LANDMARKS.RIGHT_SHOULDER

  const wrist = landmarks[wristIdx]
  const prevWrist = prevLandmarks[wristIdx]
  const elbow = landmarks[elbowIdx]
  const shoulder = landmarks[shoulderIdx]
  const ls = landmarks[POSE_LANDMARKS.LEFT_SHOULDER]
  const rs = landmarks[POSE_LANDMARKS.RIGHT_SHOULDER]

  if (!wrist || !prevWrist || !elbow || !shoulder || !ls || !rs) {
    return { label: 'unknown', confidence: 0.3 }
  }

  const isLeadHand =
    stance === 'orthodox' ? isLeftHand
    : stance === 'southpaw' ? !isLeftHand
    : isLeftHand // unknown stance — default orthodox

  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y) || 1e-6
  const dx = wrist.x - prevWrist.x
  const dy = wrist.y - prevWrist.y
  const midX = (ls.x + rs.x) / 2
  const lateralDev = Math.abs(wrist.x - midX) / sw
  const verticalRatio = Math.abs(dy) / (Math.abs(dx) + Math.abs(dy) + 1e-9)
  const wristAboveShoulder = wrist.y < shoulder.y // image-y inverted

  // Elbow extension proxy: wrist→shoulder distance / total arm chain.
  const wristToShoulder = landmarkDistance(wrist, shoulder)
  const wristToElbow = landmarkDistance(wrist, elbow)
  const shoulderToElbow = landmarkDistance(shoulder, elbow)
  const armChain = wristToElbow + shoulderToElbow
  const extension = armChain > 1e-6 ? wristToShoulder / armChain : 0.5

  // Uppercut: rising wrist with tight elbow, starting at/below shoulder height.
  if (dy < 0 && verticalRatio > 0.6 && extension < 0.78 && !wristAboveShoulder) {
    return {
      label: isLeadHand ? 'lead_uppercut' : 'rear_uppercut',
      confidence: 0.55,
    }
  }
  // Hook: large lateral arc, arm bent, wrist roughly at shoulder height.
  if (lateralDev > 0.6 && extension < 0.85 && verticalRatio < 0.5) {
    return {
      label: isLeadHand ? 'lead_hook' : 'rear_hook',
      confidence: 0.55,
    }
  }
  // Straight: arm extends forward.
  if (extension > 0.7) {
    return {
      label: isLeadHand ? 'jab' : 'cross',
      confidence: isLeadHand ? 0.6 : 0.58,
    }
  }
  return { label: isLeadHand ? 'jab' : 'cross', confidence: 0.42 }
}

/**
 * Motion Score Calculator — per-fighter event timers, sliding-window peak
 * burst velocity (matches calculateBurstSpeed semantics from kinematics.ts).
 */
export class MotionScoreCalculator {
  // Per-fighter, per-event last-emitted timestamps. The previous singleton
  // shared one map, so a strike from A blocked a strike from B for 200ms.
  private lastEventTime: Record<'A' | 'B', Record<FightEventKind, number>> = {
    A: { strike: 0, level_change: 0, stance_switch: 0, recoil: 0, other: 0 },
    B: { strike: 0, level_change: 0, stance_switch: 0, recoil: 0, other: 0 },
  }

  private eventCounter = 0

  private canEmitEvent(fighterId: 'A' | 'B', kind: FightEventKind, tMs: number): boolean {
    return tMs - this.lastEventTime[fighterId][kind] >= MOTION_THRESHOLDS.MIN_GAP_MS
  }

  private generateEventId(): string {
    this.eventCounter++
    return `evt_${Date.now()}_${this.eventCounter}`
  }

  /**
   * Compute body-widths-per-second speed of a single landmark between the
   * two most recent samples, returning 0 when either sample is missing or
   * has poor visibility. Uses the current frame's torso scale.
   */
  private instantaneousSpeed(
    history: LandmarkHistory[],
    jointIndex: number
  ): number {
    if (history.length < 2) return 0
    const curr = history[history.length - 1]
    const prev = history[history.length - 2]
    const deltaMs = curr.timestampMs - prev.timestampMs
    if (deltaMs <= 0) return 0

    const a = curr.landmarks[jointIndex]
    const b = prev.landmarks[jointIndex]
    if (!a || !b) return 0
    if ((a.visibility ?? 1) < 0.5 || (b.visibility ?? 1) < 0.5) return 0

    const torsoScalePx = calculateTorsoScale(curr.landmarks, 1)
    if (torsoScalePx <= 0) return 0

    return calculateLandmarkSpeed(a, b, deltaMs, torsoScalePx)
  }

  /**
   * Detect events from pose history for a single fighter.
   */
  detectEvents(
    history: LandmarkHistory[],
    fighterId: 'A' | 'B',
    stance: 'orthodox' | 'southpaw' | 'unknown' = 'unknown'
  ): FightEvent[] {
    if (history.length < 2) return []

    const events: FightEvent[] = []
    const curr = history[history.length - 1]
    const prev = history[history.length - 2]
    const deltaMs = curr.timestampMs - prev.timestampMs
    if (deltaMs <= 0) return []

    const tMs = curr.timestampMs

    // ---- Strikes (sliding-window peak wrist burst, classified) ----
    const leftWristBurst = calculateBurstSpeed(
      history, POSE_LANDMARKS.LEFT_WRIST, MOTION_THRESHOLDS.BURST_WINDOW_MS
    )
    const rightWristBurst = calculateBurstSpeed(
      history, POSE_LANDMARKS.RIGHT_WRIST, MOTION_THRESHOLDS.BURST_WINDOW_MS
    )

    const tryEmitStrike = (isLeft: boolean, burst: number) => {
      if (burst < MOTION_THRESHOLDS.STRIKE_BWPS) return
      if (!this.canEmitEvent(fighterId, 'strike', tMs)) return

      const classification = classifyHandStrike(curr.landmarks, prev.landmarks, isLeft, stance)
      events.push({
        id: this.generateEventId(),
        kind: 'strike',
        tMs,
        score: burst,
        fighterId,
        details: {
          joint: isLeft ? 'left_wrist' : 'right_wrist',
          velocity: burst,
          direction: isLeft ? 'left' : 'right',
          strikeLabel: classification.label,
          displayLabel: STRIKE_DISPLAY[classification.label],
          confidence: classification.confidence,
        }
      })
      this.lastEventTime[fighterId].strike = tMs
    }

    // Emit the dominant hand first so the per-fighter cooldown doesn't
    // arbitrarily favour the left side.
    if (rightWristBurst >= leftWristBurst) {
      tryEmitStrike(false, rightWristBurst)
      tryEmitStrike(true, leftWristBurst)
    } else {
      tryEmitStrike(true, leftWristBurst)
      tryEmitStrike(false, rightWristBurst)
    }

    // ---- Level change (hip-centre vertical speed in body-widths/sec) ----
    const leftHip = curr.landmarks[POSE_LANDMARKS.LEFT_HIP]
    const rightHip = curr.landmarks[POSE_LANDMARKS.RIGHT_HIP]
    const prevLeftHip = prev.landmarks[POSE_LANDMARKS.LEFT_HIP]
    const prevRightHip = prev.landmarks[POSE_LANDMARKS.RIGHT_HIP]

    if (leftHip && rightHip && prevLeftHip && prevRightHip) {
      const torsoScalePx = calculateTorsoScale(curr.landmarks, 1)
      if (torsoScalePx > 0) {
        const hipCenter = getLandmarkCenter(leftHip, rightHip)
        const prevHipCenter = getLandmarkCenter(prevLeftHip, prevRightHip)
        const verticalDistBw = Math.abs(hipCenter.y - prevHipCenter.y) / torsoScalePx
        const hipVertBwps = verticalDistBw / (deltaMs / 1000)

        if (hipVertBwps > MOTION_THRESHOLDS.LEVEL_CHANGE_BWPS &&
            this.canEmitEvent(fighterId, 'level_change', tMs)) {
          const direction = hipCenter.y > prevHipCenter.y ? 'down' : 'up'
          events.push({
            id: this.generateEventId(),
            kind: 'level_change',
            tMs,
            score: hipVertBwps,
            fighterId,
            details: { joint: 'hip_center', velocity: hipVertBwps, direction }
          })
          this.lastEventTime[fighterId].level_change = tMs
        }
      }
    }

    // ---- Stance switch (foot speed in body-widths/sec) ----
    const leftAnkleSpeed = this.instantaneousSpeed(history, POSE_LANDMARKS.LEFT_ANKLE)
    const rightAnkleSpeed = this.instantaneousSpeed(history, POSE_LANDMARKS.RIGHT_ANKLE)
    const maxAnkleSpeed = Math.max(leftAnkleSpeed, rightAnkleSpeed)

    if (maxAnkleSpeed > MOTION_THRESHOLDS.STANCE_SWITCH_BWPS &&
        this.canEmitEvent(fighterId, 'stance_switch', tMs)) {
      events.push({
        id: this.generateEventId(),
        kind: 'stance_switch',
        tMs,
        score: maxAnkleSpeed,
        fighterId,
        details: {
          joint: leftAnkleSpeed > rightAnkleSpeed ? 'left_ankle' : 'right_ankle',
          velocity: maxAnkleSpeed
        }
      })
      this.lastEventTime[fighterId].stance_switch = tMs
    }

    // ---- Recoil (nose speed in body-widths/sec) ----
    const noseSpeed = this.instantaneousSpeed(history, POSE_LANDMARKS.NOSE)
    if (noseSpeed > MOTION_THRESHOLDS.RECOIL_BWPS &&
        this.canEmitEvent(fighterId, 'recoil', tMs)) {
      events.push({
        id: this.generateEventId(),
        kind: 'recoil',
        tMs,
        score: noseSpeed,
        fighterId,
        details: { joint: 'nose', velocity: noseSpeed }
      })
      this.lastEventTime[fighterId].recoil = tMs
    }

    return events
  }

  /**
   * Lightweight current-frame motion summary in body-widths/sec.
   */
  getMotionSummary(history: LandmarkHistory[]): {
    handVelocity: number
    hipVelocity: number
    footVelocity: number
    overallScore: number
  } {
    if (history.length < 2) {
      return { handVelocity: 0, hipVelocity: 0, footVelocity: 0, overallScore: 0 }
    }

    const handVelocity = Math.max(
      this.instantaneousSpeed(history, POSE_LANDMARKS.LEFT_WRIST),
      this.instantaneousSpeed(history, POSE_LANDMARKS.RIGHT_WRIST)
    )
    const footVelocity = Math.max(
      this.instantaneousSpeed(history, POSE_LANDMARKS.LEFT_ANKLE),
      this.instantaneousSpeed(history, POSE_LANDMARKS.RIGHT_ANKLE)
    )

    // Hip centre speed.
    const curr = history[history.length - 1]
    const prev = history[history.length - 2]
    const deltaMs = curr.timestampMs - prev.timestampMs
    let hipVelocity = 0
    const lh = curr.landmarks[POSE_LANDMARKS.LEFT_HIP]
    const rh = curr.landmarks[POSE_LANDMARKS.RIGHT_HIP]
    const plh = prev.landmarks[POSE_LANDMARKS.LEFT_HIP]
    const prh = prev.landmarks[POSE_LANDMARKS.RIGHT_HIP]
    if (deltaMs > 0 && lh && rh && plh && prh) {
      const torsoScalePx = calculateTorsoScale(curr.landmarks, 1)
      if (torsoScalePx > 0) {
        const c = getLandmarkCenter(lh, rh)
        const p = getLandmarkCenter(plh, prh)
        hipVelocity = calculateLandmarkSpeed(c, p, deltaMs, torsoScalePx)
      }
    }

    const overallScore = (handVelocity * 0.5) + (hipVelocity * 0.3) + (footVelocity * 0.2)
    return { handVelocity, hipVelocity, footVelocity, overallScore }
  }

  /**
   * Reset event timers (call when switching videos).
   */
  reset(): void {
    this.lastEventTime = {
      A: { strike: 0, level_change: 0, stance_switch: 0, recoil: 0, other: 0 },
      B: { strike: 0, level_change: 0, stance_switch: 0, recoil: 0, other: 0 },
    }
    this.eventCounter = 0
  }
}

// Singleton instance for easy use
export const motionScoreCalculator = new MotionScoreCalculator()
