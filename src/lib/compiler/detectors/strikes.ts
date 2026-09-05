import { POSE_LANDMARKS } from '@/lib/kinematics'
import { makeEvidenceRef, makeId, makeTimeRangeMs } from '@/lib/fightlang/fightlang.ids'
import type {
  ActorId,
  EvidenceRef,
  FightEvent,
  FightEventKind,
  PoseLandmark,
  StanceSide,
  TimeRangeMs,
  Vec2,
} from '@/lib/fightlang/fightlang.types'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Hip midpoint Z displacement in shoulder-width units (requires 3D-lifted landmarks). */
export function hipZDisplacementBw(
  current: ReadonlyArray<PoseLandmark>,
  prev: ReadonlyArray<PoseLandmark>
): number | null {
  const lh = current[POSE_LANDMARKS.LEFT_HIP]
  const rh = current[POSE_LANDMARKS.RIGHT_HIP]
  const plh = prev[POSE_LANDMARKS.LEFT_HIP]
  const prh = prev[POSE_LANDMARKS.RIGHT_HIP]
  if (!lh || !rh || !plh || !prh) return null
  if (typeof lh.z !== 'number' || typeof rh.z !== 'number') return null
  if (typeof plh.z !== 'number' || typeof prh.z !== 'number') return null
  const sw = shoulderWidth(current)
  if (!sw || sw <= 1e-6) return null
  const midZ = (lh.z + rh.z) / 2
  const prevMidZ = (plh.z + prh.z) / 2
  return Math.abs(midZ - prevMidZ) / sw
}

function lm2(landmarks: ReadonlyArray<PoseLandmark> | undefined, idx: number): Vec2 | null {
  const lm = landmarks?.[idx]
  if (!lm) return null
  return { x: lm.x, y: lm.y }
}

function dist2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function shoulderWidth(landmarks: ReadonlyArray<PoseLandmark> | undefined): number | null {
  const ls = lm2(landmarks, POSE_LANDMARKS.LEFT_SHOULDER)
  const rs = lm2(landmarks, POSE_LANDMARKS.RIGHT_SHOULDER)
  if (!ls || !rs) return null
  const w = dist2(ls, rs)
  return w > 1e-6 ? w : null
}

// ---------------------------------------------------------------------------
// Strike type — used internally; mapped to FightEventKind downstream.
// ---------------------------------------------------------------------------

export type StrikeLabel =
  | 'jab'
  | 'cross'
  | 'lead_hook'
  | 'rear_hook'
  | 'lead_uppercut'
  | 'rear_uppercut'
  | 'teep'
  | 'lead_kick'
  | 'rear_kick'
  | 'strike_placeholder'

type StrikeClassification = {
  label: StrikeLabel
  limb: 'lead_hand' | 'rear_hand' | 'lead_leg' | 'rear_leg' | 'unknown'
  confidence: number
}

// ---------------------------------------------------------------------------
// Classifiers
// ---------------------------------------------------------------------------

/**
 * Classify a hand-burst event into jab/cross/hook/uppercut.
 *
 * Strategy:
 *   1. Determine which hand moved (lead vs rear from stance).
 *   2. Measure wrist direction relative to shoulder-line midpoint.
 *      - Straight (small lateral deviation): jab / cross
 *      - Lateral arc (large deviation in x, wrist roughly at shoulder height): hook
 *      - Upward (wrist moving upward, elbow tight): uppercut
 *   3. Resolve lead vs rear from stance side.
 */
function classifyHandStrike(input: {
  actorId: ActorId
  landmarks: ReadonlyArray<PoseLandmark> | undefined
  prevLandmarks: ReadonlyArray<PoseLandmark> | undefined
  stanceSide: StanceSide
}): StrikeClassification {
  const { landmarks, prevLandmarks, stanceSide } = input
  if (!landmarks || !prevLandmarks) {
    return { label: 'strike_placeholder', limb: 'unknown', confidence: 0.3 }
  }

  const sw = shoulderWidth(landmarks)
  if (!sw) return { label: 'strike_placeholder', limb: 'unknown', confidence: 0.3 }

  // Wrist positions (current + previous)
  const lw = lm2(landmarks, POSE_LANDMARKS.LEFT_WRIST)
  const rw = lm2(landmarks, POSE_LANDMARKS.RIGHT_WRIST)
  const plw = lm2(prevLandmarks, POSE_LANDMARKS.LEFT_WRIST)
  const prw = lm2(prevLandmarks, POSE_LANDMARKS.RIGHT_WRIST)

  // Shoulder and elbow positions
  const ls = lm2(landmarks, POSE_LANDMARKS.LEFT_SHOULDER)
  const rs = lm2(landmarks, POSE_LANDMARKS.RIGHT_SHOULDER)
  const le = lm2(landmarks, POSE_LANDMARKS.LEFT_ELBOW)
  const re = lm2(landmarks, POSE_LANDMARKS.RIGHT_ELBOW)

  if (!lw || !rw || !plw || !prw || !ls || !rs) {
    return { label: 'strike_placeholder', limb: 'unknown', confidence: 0.3 }
  }

  // Which hand moved more?
  const leftDisp = dist2(lw, plw)
  const rightDisp = dist2(rw, prw)
  const isLeftHand = leftDisp > rightDisp

  const wrist = isLeftHand ? lw : rw
  const prevWrist = isLeftHand ? plw : prw
  const shoulder = isLeftHand ? ls : rs
  const elbow = isLeftHand ? le : re

  // Delta vector of wrist movement
  const dx = wrist.x - prevWrist.x
  const dy = wrist.y - prevWrist.y
  const dispBw = Math.max(leftDisp, rightDisp) / sw

  // Shoulder midpoint (proxy for center line)
  const midX = (ls.x + rs.x) / 2

  // Lead vs rear (in MediaPipe image coords, left in image = camera-left)
  // Orthodox: left hand is lead. Southpaw: right hand is lead.
  const isLeadHand =
    stanceSide === 'orthodox' ? isLeftHand
    : stanceSide === 'southpaw' ? !isLeftHand
    : leftDisp <= rightDisp // unknown stance — closer wrist to center is probably lead

  // --- Direction analysis ---

  // Wrist height relative to shoulder
  const wristAboveShoulder = wrist.y < shoulder.y // y is inverted in image coords
  const wristBelowNose = wrist.y > (lm2(landmarks, 0)?.y ?? shoulder.y)

  // Lateral deviation: how far wrist departs from the shoulder→opponent line
  const lateralDev = Math.abs(wrist.x - midX) / sw

  // Vertical motion component
  const verticalRatio = Math.abs(dy) / (Math.abs(dx) + Math.abs(dy) + 1e-9)

  // Elbow angle proxy: tight elbow = uppercut, extended = straight, wide = hook
  let elbowAngleProxy = 0.5 // default mid
  if (elbow) {
    const wristToElbow = dist2(wrist, elbow)
    const shoulderToElbow = dist2(shoulder, elbow)
    const wristToShoulder = dist2(wrist, shoulder)
    // Full extension ratio: wrist-shoulder / (elbow-shoulder + wrist-elbow)
    const armChain = shoulderToElbow + wristToElbow
    elbowAngleProxy = armChain > 1e-6 ? wristToShoulder / armChain : 0.5
  }

  // --- Classification ---

  // Uppercut: strong upward movement, tight elbow, wrist below shoulder level moving up
  if (dy < 0 && verticalRatio > 0.6 && elbowAngleProxy < 0.78 && !wristAboveShoulder) {
    return {
      label: isLeadHand ? 'lead_uppercut' : 'rear_uppercut',
      limb: isLeadHand ? 'lead_hand' : 'rear_hand',
      confidence: 0.55,
    }
  }

  // Hook: large lateral deviation, arm not fully extended, wrist roughly at shoulder height
  if (lateralDev > 0.6 && elbowAngleProxy < 0.85 && verticalRatio < 0.5) {
    return {
      label: isLeadHand ? 'lead_hook' : 'rear_hook',
      limb: isLeadHand ? 'lead_hand' : 'rear_hand',
      confidence: 0.55,
    }
  }

  // Straight (jab or cross): arm extends forward, smaller lateral deviation
  if (elbowAngleProxy > 0.7 || dispBw > 0.8) {
    return {
      label: isLeadHand ? 'jab' : 'cross',
      limb: isLeadHand ? 'lead_hand' : 'rear_hand',
      confidence: isLeadHand ? 0.6 : 0.58,
    }
  }

  // Fallback: classify by lead/rear
  return {
    label: isLeadHand ? 'jab' : 'cross',
    limb: isLeadHand ? 'lead_hand' : 'rear_hand',
    confidence: 0.42,
  }
}

/**
 * Classify a leg-burst event into teep / kick.
 *
 * Strategy:
 *   1. Determine which foot moved (lead vs rear from stance).
 *   2. Teep: foot moves forward (dominant dx) + hip stays square.
 *   3. Kick: foot arcs laterally + hip rotates.
 */
function classifyLegStrike(input: {
  actorId: ActorId
  landmarks: ReadonlyArray<PoseLandmark> | undefined
  prevLandmarks: ReadonlyArray<PoseLandmark> | undefined
  stanceSide: StanceSide
}): StrikeClassification | null {
  const { landmarks, prevLandmarks, stanceSide } = input
  if (!landmarks || !prevLandmarks) return null

  const sw = shoulderWidth(landmarks)
  if (!sw) return null

  const la = lm2(landmarks, POSE_LANDMARKS.LEFT_ANKLE)
  const ra = lm2(landmarks, POSE_LANDMARKS.RIGHT_ANKLE)
  const pla = lm2(prevLandmarks, POSE_LANDMARKS.LEFT_ANKLE)
  const pra = lm2(prevLandmarks, POSE_LANDMARKS.RIGHT_ANKLE)

  if (!la || !ra || !pla || !pra) return null

  const leftDisp = dist2(la, pla)
  const rightDisp = dist2(ra, pra)
  const maxDisp = Math.max(leftDisp, rightDisp)
  const dispBw = maxDisp / sw

  // Need meaningful foot movement (≥0.5 shoulder-widths)
  if (dispBw < 0.5) return null

  const isLeftFoot = leftDisp > rightDisp
  const foot = isLeftFoot ? la : ra
  const prevFoot = isLeftFoot ? pla : pra

  const dx = foot.x - prevFoot.x
  const dy = foot.y - prevFoot.y

  const isLeadLeg =
    stanceSide === 'orthodox' ? isLeftFoot
    : stanceSide === 'southpaw' ? !isLeftFoot
    : true

  // Vertical motion: foot rises (y decreases in image coords)
  const footRises = dy < 0

  // Teep: more forward (vertical in image = y decrease), less lateral
  const lateralRatio = Math.abs(dx) / (Math.abs(dx) + Math.abs(dy) + 1e-9)

  if (footRises && lateralRatio < 0.45) {
    return {
      label: 'teep',
      limb: isLeadLeg ? 'lead_leg' : 'rear_leg',
      confidence: 0.52,
    }
  }

  // Kick: lateral arc
  if (dispBw > 0.7) {
    return {
      label: isLeadLeg ? 'lead_kick' : 'rear_kick',
      limb: isLeadLeg ? 'lead_leg' : 'rear_leg',
      confidence: 0.5,
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Human-friendly labels
// ---------------------------------------------------------------------------

const STRIKE_LABELS: Record<StrikeLabel, string> = {
  jab: 'Jab',
  cross: 'Cross',
  lead_hook: 'Lead Hook',
  rear_hook: 'Rear Hook',
  lead_uppercut: 'Lead Uppercut',
  rear_uppercut: 'Rear Uppercut',
  teep: 'Teep',
  lead_kick: 'Lead Kick',
  rear_kick: 'Rear Kick',
  strike_placeholder: 'Strike',
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type StrikeDetectionInput = {
  tMs: number
  actorId: ActorId
  handBurstBwps?: number | null
  footBurstBwps?: number | null
  thresholdBwps: number
  /** Current-frame landmarks for this actor. */
  landmarks?: ReadonlyArray<PoseLandmark>
  /** Previous-frame landmarks for this actor (needed for direction analysis). */
  prevLandmarks?: ReadonlyArray<PoseLandmark>
  stanceSide?: StanceSide
  /** Optional 3D hip Z displacement (shoulder-widths). Large values suggest weight shift, not arm extension. */
  hipZDeltaBw?: number | null
}

/**
 * Detect and classify strikes from burst speed + pose direction.
 * Falls back to 'strike_placeholder' when pose data is insufficient.
 */
export function detectStrikes(input: StrikeDetectionInput): FightEvent[] {
  const { tMs, actorId, handBurstBwps, footBurstBwps, thresholdBwps } = input

  const handBurst = typeof handBurstBwps === 'number' && Number.isFinite(handBurstBwps) ? handBurstBwps : null
  const footBurst = typeof footBurstBwps === 'number' && Number.isFinite(footBurstBwps) ? footBurstBwps : null

  const events: FightEvent[] = []

  // Hand strikes
  if (handBurst != null && handBurst >= thresholdBwps) {
    const suppressHandFromHipZ =
      typeof input.hipZDeltaBw === 'number' && input.hipZDeltaBw > 0.35

    if (!suppressHandFromHipZ) {
      const classification = classifyHandStrike({
        actorId,
        landmarks: input.landmarks,
        prevLandmarks: input.prevLandmarks,
        stanceSide: input.stanceSide ?? 'unknown',
      })

      const t: TimeRangeMs = makeTimeRangeMs(tMs)
      const evidence: EvidenceRef[] = [
        makeEvidenceRef({
          id: makeId(`ev_strike_${classification.label}_${actorId}`),
          source: 'kinematics',
          actorId,
          t,
          note: `${STRIKE_LABELS[classification.label]} detected: handBurstBwps=${handBurst.toFixed(2)} >= ${thresholdBwps.toFixed(2)}, limb=${classification.limb}.`,
        }),
      ]

      events.push({
        id: makeId(`evt_${classification.label}`),
        kind: (classification.label === 'strike_placeholder' ? 'strike_placeholder' : classification.label) as FightEventKind,
        actorId,
        t,
        label: classification.label,
        confidence: { score: classification.confidence, basis: 'heuristic' },
        evidence,
        data: {
          handBurstBwps: handBurst,
          thresholdBwps,
          strikeType: classification.label,
          limb: classification.limb,
          displayLabel: STRIKE_LABELS[classification.label],
        },
      })
    }
  }

  // Leg strikes (kicks / teeps)
  if (footBurst != null && footBurst >= thresholdBwps * 0.8) {
    const classification = classifyLegStrike({
      actorId,
      landmarks: input.landmarks,
      prevLandmarks: input.prevLandmarks,
      stanceSide: input.stanceSide ?? 'unknown',
    })

    if (classification) {
      const t: TimeRangeMs = makeTimeRangeMs(tMs)
      const evidence: EvidenceRef[] = [
        makeEvidenceRef({
          id: makeId(`ev_strike_${classification.label}_${actorId}`),
          source: 'kinematics',
          actorId,
          t,
          note: `${STRIKE_LABELS[classification.label]} detected: footBurstBwps=${footBurst.toFixed(2)}, limb=${classification.limb}.`,
        }),
      ]

      events.push({
        id: makeId(`evt_${classification.label}`),
        kind: 'strike_placeholder' as FightEventKind,
        actorId,
        t,
        label: classification.label,
        confidence: { score: classification.confidence, basis: 'heuristic' },
        evidence,
        data: {
          footBurstBwps: footBurst,
          thresholdBwps,
          strikeType: classification.label,
          limb: classification.limb,
          displayLabel: STRIKE_LABELS[classification.label],
        },
      })
    }
  }

  return events
}

/**
 * @deprecated Use `detectStrikes` instead. Kept for backward compat.
 */
export function detectStrikePlaceholders(input: {
  tMs: number
  actorId: ActorId
  handBurstBwps?: number | null
  thresholdBwps: number
}): FightEvent[] {
  return detectStrikes({
    tMs: input.tMs,
    actorId: input.actorId,
    handBurstBwps: input.handBurstBwps,
    thresholdBwps: input.thresholdBwps,
  })
}
