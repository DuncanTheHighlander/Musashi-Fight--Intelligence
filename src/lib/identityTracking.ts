/**
 * Dual-fighter identity tracking during occlusion / crossing.
 *
 * Ported from skeleton-test/page.tsx — crossing phase machine, bipartite
 * assignment with swap hysteresis, and adaptive color-weight matching.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import {
  blendColorProfile,
  cloneColorProfile,
  colorProfileDist,
  colorRef,
  type ColorProfile,
  type NormalizedRgb,
} from '@/lib/appearance'
import {
  createKalman2D,
  predictKalman,
  updateKalman,
  type Kalman2D,
} from '@/lib/kalman2d'

export type { ColorProfile, NormalizedRgb, Kalman2D }

export type PoseAnchor = { x: number; y: number }

export type CrossingPhase = 'tracking' | 'approaching' | 'merged' | 'recovering'

export type IdentitySlot = {
  pose: NormalizedLandmark[]
  anchor: PoseAnchor
  color: ColorProfile | null
  anchorColor: ColorProfile | null
  scale: number
  velocity: { vx: number; vy: number }
  wallMs: number
  /** Per-slot 2D Kalman for trajectory-primary identity. */
  kalman?: Kalman2D
}

export type IdentityCandidate = {
  pose: NormalizedLandmark[]
  anchor: PoseAnchor
  color: ColorProfile | null
  scale: number
  /** Optional HSV Bhattacharyya distance to slot A/B (filled by FightAnalyzer). */
  hsvDistToA?: number | null
  hsvDistToB?: number | null
}

export const IDENTITY_STALE_MS = 2200
/**
 * Staleness limit while a crossing is in progress. During merged/recovering the
 * hidden fighter's slot legitimately receives no updates — using the normal
 * 2.2 s limit caused the crossing state machine to self-destruct mid-clinch
 * (phase reset to 'tracking', pre-cross anchor colors wiped) for any overlap
 * longer than ~2 s, which is exactly when that state matters most.
 */
export const IDENTITY_STALE_CROSSING_MS = 5000
export const COLOR_WEIGHT = 0.45
export const COLOR_WEIGHT_OCCLUSION = 3.75
export const COLOR_WEIGHT_RECOVERY = 4.5
export const SLOTS_CLOSE_DIST = 0.08
export const SLOT_FRESHNESS_GAP_MS = 250
export const SWAP_HYSTERESIS = 0.04

/**
 * Teleport gate for candidate→slot claims while normally tracking.
 * A track that was updated dtMs ago may only be claimed by a candidate within
 * maxClaimJump(dtMs) of its predicted anchor. A torso anchor moving >0.08 of
 * the frame in 33 ms (~2.5 frame-widths/sec) is not human motion — it is a
 * phantom detection (bystander, duplicate, half-merged blob) trying to steal
 * the track. This was the root cause of permanent label swaps on test clips:
 * phantom claims dragged a track off its fighter, and on re-detection the
 * displaced track grabbed the OTHER fighter. The allowance grows with dt so
 * legitimate re-acquisition after detection gaps still succeeds, and the
 * stale-slot re-bind path (IDENTITY_STALE_MS) is unaffected.
 */
export const CLAIM_JUMP_BASE = 0.06
export const CLAIM_JUMP_PER_MS = 0.0006
export const CLAIM_JUMP_CAP = 0.22

/**
 * During a crossing the gate is suspended (anchors legitimately collapse and
 * re-separate) — but only briefly. A slot hidden longer than this must pass
 * the teleport gate again even mid-crossing: when a fighter walks out of
 * frame after a close pass, background misdetections (bystanders, watermarks,
 * duplicate blobs) would otherwise claim the empty slot unchecked and keep a
 * ghost skeleton alive indefinitely.
 */
export const CROSSING_CLAIM_FREE_MS = 300

/**
 * Max color-profile distance for the teleport escape hatch in the claim gate:
 * an unreachable candidate may still claim a slot when its appearance matches
 * this closely (scene cuts). Tuned so same-fighter-after-cut passes (~0.05-0.12
 * with lighting change) while background phantoms fail (~0.25+).
 */
export const TELEPORT_COLOR_MAX = 0.16

export function maxClaimJump(dtMs: number): number {
  return Math.min(CLAIM_JUMP_CAP, CLAIM_JUMP_BASE + CLAIM_JUMP_PER_MS * Math.max(0, dtMs))
}

export const APPROACHING_DIST = 0.14
export const MERGED_DIST = 0.06
export const SPLIT_DIST = 0.10
export const STABLE_FRAMES_TO_RESUME = 8

/**
 * During normal tracking a lost detection should freeze briefly and then hide —
 * not coast for over a second. The 1200 ms hold made ghost skeletons drift off
 * the body (and past scene cuts) on velocity extrapolation. Crossings keep the
 * long hold because the hidden fighter genuinely exists behind the opponent.
 */
export const HOLD_MS_NORMAL = 450
export const HOLD_MS_CROSSING = 1800
export const SMOOTH_ALPHA_NORMAL = 0.88
export const SMOOTH_ALPHA_CROSSING = 0.72

/**
 * Motion-prediction horizon. Displacement follows an exponential-decay
 * extrapolation (constant velocity that gracefully bleeds off) instead of
 * "linear for 500 ms then frozen": people moving through a cross keep their
 * direction of travel, so the predicted anchor keeps drifting that way while
 * the fighter is hidden, but asymptotes instead of flying off the frame.
 */
const PREDICTION_TAU_MS = 450
const PREDICTION_MAX_MS = 1400
const VELOCITY_MAX = 0.005

/**
 * Mean per-joint distance (normalized coords) below which two detections are
 * the SAME body found twice. Matches the overlay's display-side gate so the
 * identity layer and the renderer agree on what counts as a duplicate.
 */
export const DUPLICATE_POSE_MEAN_DIST = 0.045

export function isCrossingPhase(phase: CrossingPhase): boolean {
  return phase !== 'tracking'
}

export function crossingHoldMs(phase: CrossingPhase, poseCount: number): number {
  if (poseCount >= 2 && phase === 'tracking') return HOLD_MS_NORMAL
  if (isCrossingPhase(phase) || poseCount < 2) return HOLD_MS_CROSSING
  return HOLD_MS_NORMAL
}

export function crossingSmoothAlpha(phase: CrossingPhase): number {
  return isCrossingPhase(phase) ? SMOOTH_ALPHA_CROSSING : SMOOTH_ALPHA_NORMAL
}

function dist(a: PoseAnchor, b: PoseAnchor): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Ensure a slot has a Kalman filter seeded from its current anchor/velocity. */
export function ensureSlotKalman(slot: IdentitySlot): Kalman2D {
  if (slot.kalman) return slot.kalman
  const k = createKalman2D(slot.anchor.x, slot.anchor.y, slot.velocity.vx, slot.velocity.vy)
  slot.kalman = k
  return k
}

/**
 * Predict slot center at nowMs. Prefers Kalman when present; falls back to
 * exponential-decay constant-velocity (legacy) for slots without a filter.
 */
export function predictAnchor(slot: IdentitySlot, nowMs: number): PoseAnchor {
  const dt = Math.min(Math.max(0, nowMs - slot.wallMs), PREDICTION_MAX_MS)
  if (slot.kalman) {
    const predicted = predictKalman(slot.kalman, dt)
    return { x: predicted.x, y: predicted.y }
  }
  // Legacy exponential-decay extrapolation (pre-Kalman slots / cold start).
  const effectiveDt = PREDICTION_TAU_MS * (1 - Math.exp(-dt / PREDICTION_TAU_MS))
  return {
    x: slot.anchor.x + slot.velocity.vx * effectiveDt,
    y: slot.anchor.y + slot.velocity.vy * effectiveDt,
  }
}

/** Trajectory-only cost: distance from candidate to Kalman-predicted center. */
export function trajectoryCost(
  candidate: IdentityCandidate,
  slot: IdentitySlot,
  nowMs: number
): number {
  return dist(candidate.anchor, predictAnchor(slot, nowMs))
}

/**
 * Apply a measurement to the slot's Kalman after a successful assignment.
 * Predicts forward by dtMs from the filter's last state, then updates with
 * the observed anchor. Mutates slot.kalman. Pass dt = now - previous wallMs.
 */
export function updateSlotKalman(
  slot: IdentitySlot,
  anchor: PoseAnchor,
  velocity: { vx: number; vy: number } | undefined,
  dtMs: number
): void {
  const prev = ensureSlotKalman(slot)
  const predicted = predictKalman(prev, Math.max(1, dtMs))
  slot.kalman = updateKalman(predicted, anchor.x, anchor.y, velocity?.vx, velocity?.vy)
}

/** Mean joint-to-joint distance between two poses (normalized coords). */
export function poseMeanJointDistance(
  a: NormalizedLandmark[],
  b: NormalizedLandmark[]
): number {
  const n = Math.min(a.length, b.length)
  let total = 0
  let count = 0
  for (let i = 0; i < n; i++) {
    const la = a[i]
    const lb = b[i]
    if (!la || !lb) continue
    total += Math.hypot(la.x - lb.x, la.y - lb.y)
    count++
  }
  return count >= 6 ? total / count : Number.POSITIVE_INFINITY
}

function poseMeanVisibility(pose: NormalizedLandmark[]): number {
  if (pose.length === 0) return 0
  let sum = 0
  for (const lm of pose) sum += lm?.visibility ?? 0
  return sum / pose.length
}

/**
 * Suppress duplicate detections of the SAME body before identity assignment.
 *
 * During an overlap, MediaPipe (numPoses: 2) frequently returns the front
 * fighter twice. Without this gate the duplicate forcibly claims the hidden
 * fighter's slot in the 2×2 assignment, dragging that track (anchor, velocity,
 * pose) onto the front fighter — the root of many post-cross identity swaps.
 * Of two near-identical poses we keep the one with higher mean visibility.
 */
export type PoseBBox = { l: number; t: number; r: number; b: number }

export const BOX_OVERLAP_MIN_CONTAINMENT = 0.15
/** Enter proximity LOCK when either box containment exceeds this (IoU-like). */
export const BOX_LOCK_MIN_CONTAINMENT = 0.4
/** Release LOCK when predicted centers are at least this far apart (normalized). */
export const LOCK_SEPARATION_DIST = 0.12
/** Consecutive non-overlap frames required before releasing LOCK. */
export const LOCK_RELEASE_FRAMES = 4
/** Trajectory costs within this margin may consult appearance as a tie-break. */
export const TRAJ_TIE_MARGIN = 0.02
/** Appearance must beat the other pairing by this much to override a traj tie. */
export const APPEARANCE_DECISIVE_MARGIN = 0.055

export function poseVisBounds(pose: NormalizedLandmark[]): PoseBBox | null {
  let l = 1
  let t = 1
  let r = 0
  let b = 0
  let n = 0
  for (const lm of pose) {
    if ((lm?.visibility ?? 1) < 0.3) continue
    if (lm.x < l) l = lm.x
    if (lm.x > r) r = lm.x
    if (lm.y < t) t = lm.y
    if (lm.y > b) b = lm.y
    n++
  }
  return n >= 6 ? { l, t, r, b } : null
}

/** Intersection area over the SMALLER box's area (detect_v2.py's overlap()). */
export function boxContainment(a: PoseBBox, b: PoseBBox): number {
  const ix = Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l))
  const iy = Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t))
  const inter = ix * iy
  if (inter <= 0) return 0
  const areaA = (a.r - a.l) * (a.b - a.t)
  const areaB = (b.r - b.l) * (b.b - b.t)
  return inter / Math.max(1e-6, Math.min(areaA, areaB))
}

export function boxesOverlap(
  a: PoseBBox,
  b: PoseBBox,
  minContainment: number = BOX_OVERLAP_MIN_CONTAINMENT
): boolean {
  return boxContainment(a, b) > minContainment || boxContainment(b, a) > minContainment
}

// Containment dedupe: a DISTORTED re-detection of the same body can have a
// mean joint distance above DUPLICATE_POSE_MEAN_DIST (warped limbs) while its
// box still sits almost entirely inside the original's box. The offline
// detector (detect_v2.py) rejected such seeds with intersection/min-area >
// 0.55; without the equivalent here, the duplicate claims the absent
// fighter's slot once one fighter leaves the frame — limbs "jump around" on
// the remaining fighter. A genuine occluded opponent can also be contained,
// but his joints are genuinely DIFFERENT (mean distance well above 0.12).
export const DUPLICATE_BOX_CONTAINMENT = 0.6
export const DUPLICATE_CONTAINED_MEAN_DIST = 0.12

export function dedupePoseCandidates(
  poses: NormalizedLandmark[][],
  threshold: number = DUPLICATE_POSE_MEAN_DIST
): NormalizedLandmark[][] {
  if (poses.length < 2) return poses
  const kept: NormalizedLandmark[][] = []
  for (const pose of poses) {
    const dupIdx = kept.findIndex((other) => {
      const meanDist = poseMeanJointDistance(pose, other)
      if (meanDist < threshold) return true
      if (meanDist < DUPLICATE_CONTAINED_MEAN_DIST) {
        const ba = poseVisBounds(pose)
        const bb = poseVisBounds(other)
        if (ba && bb && boxContainment(ba, bb) > DUPLICATE_BOX_CONTAINMENT) return true
      }
      return false
    })
    if (dupIdx === -1) {
      kept.push(pose)
    } else if (poseMeanVisibility(pose) > poseMeanVisibility(kept[dupIdx])) {
      kept[dupIdx] = pose
    }
  }
  return kept
}

export function predictedSlotDistance(a: IdentitySlot, b: IdentitySlot, nowMs: number): number {
  return dist(predictAnchor(a, nowMs), predictAnchor(b, nowMs))
}

function rgbDistance255(a: NormalizedRgb | null, b: NormalizedRgb | null): number {
  if (!a || !b) return 0.22
  const ar = a.r * 255
  const ag = a.g * 255
  const ab = a.b * 255
  const br = b.r * 255
  const bg = b.g * 255
  const bb = b.b * 255
  return Math.hypot(ar - br, ag - bg, ab - bb) / 441.7
}

export type MatchCostExtras = {
  scale?: number
  poseShape?: number
  scaleWeight?: number
  poseWeight?: number
  /** Bhattacharyya distance vs the target slot's HSV fingerprint (lower = better). */
  hsvDist?: number | null
}

export function matchCost(
  candidate: IdentityCandidate,
  slot: IdentitySlot,
  nowMs: number,
  colorWeight: number = COLOR_WEIGHT,
  useAnchor: boolean = false,
  extras?: MatchCostExtras
): number {
  const predicted = predictAnchor(slot, nowMs)
  const posCost = dist(candidate.anchor, predicted)
  const ref = colorRef(slot, useAnchor)
  let colorCost = 0
  if (candidate.color && ref) {
    colorCost = colorProfileDist(candidate.color, ref)
  } else if (slot.color && candidate.color) {
    colorCost = colorProfileDist(candidate.color, slot.color)
  }
  const scaleCost =
    extras?.scale != null && slot.scale > 0
      ? Math.abs(Math.log(Math.max(0.05, candidate.scale) / Math.max(0.05, slot.scale)))
      : 0
  const shapeCost = extras?.poseShape ?? 0
  const scaleW = extras?.scaleWeight ?? 0.16
  const poseW = extras?.poseWeight ?? 0.18
  const hsvCost = typeof extras?.hsvDist === 'number' ? extras.hsvDist : colorCost
  const blendedColor = colorCost * 0.4 + hsvCost * 0.6
  return (
    posCost +
    colorWeight * blendedColor +
    Math.min(0.45, scaleCost) * scaleW +
    shapeCost * poseW
  )
}

export function appearanceOnlyCost(
  candidate: IdentityCandidate,
  slot: IdentitySlot,
  useAnchor: boolean,
  slotKey: 'A' | 'B'
): number {
  const ref = colorRef(slot, useAnchor)
  let rgb = 0.35
  if (candidate.color && ref) {
    rgb = colorProfileDist(candidate.color, ref)
  }
  const hsv =
    slotKey === 'A'
      ? (typeof candidate.hsvDistToA === 'number' ? candidate.hsvDistToA : rgb)
      : (typeof candidate.hsvDistToB === 'number' ? candidate.hsvDistToB : rgb)
  return rgb * 0.4 + hsv * 0.6
}

export type PairLock = { aCandIdx: 0 | 1; bCandIdx: 0 | 1 }

/** Appearance-only 2×2 pairing for overlap lock (ignores spatial position). */
export function seedPairLockByAppearance(
  c0: IdentityCandidate,
  c1: IdentityCandidate,
  slotA: IdentitySlot,
  slotB: IdentitySlot,
  useAnchor: boolean
): PairLock {
  const direct =
    appearanceOnlyCost(c0, slotA, useAnchor, 'A') +
    appearanceOnlyCost(c1, slotB, useAnchor, 'B')
  const swap =
    appearanceOnlyCost(c0, slotB, useAnchor, 'B') +
    appearanceOnlyCost(c1, slotA, useAnchor, 'A')
  return direct <= swap ? { aCandIdx: 0, bCandIdx: 1 } : { aCandIdx: 1, bCandIdx: 0 }
}

/**
 * Trajectory-primary PairLock seed. Uses Kalman-predicted centers; falls back
 * to appearance only when trajectory costs are within TRAJ_TIE_MARGIN.
 */
export function seedPairLockByTrajectory(
  c0: IdentityCandidate,
  c1: IdentityCandidate,
  slotA: IdentitySlot,
  slotB: IdentitySlot,
  nowMs: number,
  useAnchor: boolean
): PairLock {
  const direct =
    trajectoryCost(c0, slotA, nowMs) + trajectoryCost(c1, slotB, nowMs)
  const swap =
    trajectoryCost(c0, slotB, nowMs) + trajectoryCost(c1, slotA, nowMs)
  if (Math.abs(direct - swap) >= TRAJ_TIE_MARGIN) {
    return direct <= swap ? { aCandIdx: 0, bCandIdx: 1 } : { aCandIdx: 1, bCandIdx: 0 }
  }
  // Trajectory tied — appearance tie-break (must be decisive).
  const aDirect =
    appearanceOnlyCost(c0, slotA, useAnchor, 'A') +
    appearanceOnlyCost(c1, slotB, useAnchor, 'B')
  const aSwap =
    appearanceOnlyCost(c0, slotB, useAnchor, 'B') +
    appearanceOnlyCost(c1, slotA, useAnchor, 'A')
  if (Math.abs(aDirect - aSwap) > APPEARANCE_DECISIVE_MARGIN) {
    return aDirect <= aSwap ? { aCandIdx: 0, bCandIdx: 1 } : { aCandIdx: 1, bCandIdx: 0 }
  }
  // Still tied — stick with trajectory preference (or identity order).
  return direct <= swap ? { aCandIdx: 0, bCandIdx: 1 } : { aCandIdx: 1, bCandIdx: 0 }
}

/** True when either box containment exceeds the LOCK threshold. */
export function boxesInProximityLock(a: PoseBBox, b: PoseBBox): boolean {
  return (
    boxContainment(a, b) > BOX_LOCK_MIN_CONTAINMENT ||
    boxContainment(b, a) > BOX_LOCK_MIN_CONTAINMENT
  )
}

export type AssignTrackOptions = {
  /** When true, never swap A/B pairing in the 2-candidate bipartite step. */
  blockSwap?: boolean
  /** When false, cold-start left/right sort is disabled after first seed. */
  allowSpatialSeed?: boolean
}

/**
 * Re-binding cost for a candidate against a STALE (lost) slot. Position is
 * unreliable after a long hide, so appearance dominates; the decayed motion
 * prediction acts as a trajectory-continuity tiebreaker (people generally
 * keep their direction of travel through a cross).
 */
export function deadSlotRebindCost(
  candidate: IdentityCandidate,
  slot: IdentitySlot,
  nowMs: number,
  useAnchor: boolean
): number {
  const ref = colorRef(slot, useAnchor)
  const colorCost = candidate.color && ref ? colorProfileDist(candidate.color, ref) : 0.35
  const posCost = dist(candidate.anchor, predictAnchor(slot, nowMs))
  return colorCost * 1.6 + Math.min(0.6, posCost) * 0.4
}

export function assignFighterTracks(
  candidates: IdentityCandidate[],
  slotA: IdentitySlot | null,
  slotB: IdentitySlot | null,
  nowMs: number,
  phase: CrossingPhase,
  costExtras?: (candidate: IdentityCandidate, slot: IdentitySlot) => MatchCostExtras,
  opts?: AssignTrackOptions
): { A?: IdentityCandidate; B?: IdentityCandidate } {
  if (candidates.length === 0) return {}

  // While a crossing is in progress the hidden slot legitimately goes without
  // updates — keep it matchable for longer instead of declaring it dead.
  const staleLimit = isCrossingPhase(phase) ? IDENTITY_STALE_CROSSING_MS : IDENTITY_STALE_MS
  const aAlive = !!slotA && nowMs - slotA.wallMs < staleLimit
  const bAlive = !!slotB && nowMs - slotB.wallMs < staleLimit
  const useAnchor = phase === 'recovering' || phase === 'merged'

  if (!aAlive && !bAlive) {
    // Both tracks lost. Re-bind with appearance + trajectory when we have any
    // slot memory; fall back to left/right ordering only on a cold start.
    if (slotA && slotB && candidates.length >= 2) {
      // Appearance dominates when stored; with no color memory the neutral
      // color term cancels and the decayed trajectory prediction decides —
      // fighters generally keep their direction of travel through a cross.
      const cStraight =
        deadSlotRebindCost(candidates[0], slotA, nowMs, useAnchor) +
        deadSlotRebindCost(candidates[1], slotB, nowMs, useAnchor)
      const cSwap =
        deadSlotRebindCost(candidates[0], slotB, nowMs, useAnchor) +
        deadSlotRebindCost(candidates[1], slotA, nowMs, useAnchor)
      return cStraight <= cSwap
        ? { A: candidates[0], B: candidates[1] }
        : { A: candidates[1], B: candidates[0] }
    }
    if (slotA && slotB && candidates.length === 1) {
      const cA = deadSlotRebindCost(candidates[0], slotA, nowMs, useAnchor)
      const cB = deadSlotRebindCost(candidates[0], slotB, nowMs, useAnchor)
      return cA <= cB ? { A: candidates[0] } : { B: candidates[0] }
    }
    if (opts?.allowSpatialSeed !== false) {
      const sorted = [...candidates].sort((p, q) => p.anchor.x - q.anchor.x)
      return { A: sorted[0], B: sorted[1] }
    }
    return { A: candidates[0], B: candidates[1] }
  }

  const slotsClose =
    aAlive && bAlive ? predictedSlotDistance(slotA!, slotB!, nowMs) < SLOTS_CLOSE_DIST : false
  const freshnessGap = slotA && slotB ? Math.abs(slotA.wallMs - slotB.wallMs) : 0
  const useOcclusionWeight =
    phase !== 'tracking' || slotsClose || freshnessGap > SLOT_FRESHNESS_GAP_MS
  const w =
    phase === 'recovering'
      ? COLOR_WEIGHT_RECOVERY
      : useOcclusionWeight
        ? COLOR_WEIGHT_OCCLUSION
        : COLOR_WEIGHT

  const extras = costExtras ?? (() => ({}))

  // One alive track, one lost track.
  const oneAliveAssign = (
    aliveKey: 'A' | 'B',
    aliveSlot: IdentitySlot,
    deadSlot: IdentitySlot | null
  ): { A?: IdentityCandidate; B?: IdentityCandidate } => {
    const result = (
      aliveCand: IdentityCandidate | undefined,
      deadCand: IdentityCandidate | undefined
    ): { A?: IdentityCandidate; B?: IdentityCandidate } =>
      aliveKey === 'A' ? { A: aliveCand, B: deadCand } : { A: deadCand, B: aliveCand }
    if (candidates.length >= 2 && deadSlot) {
      // Full 2×2: alive slot scored with the regular predicted-position cost,
      // the lost slot with the appearance-dominant re-bind cost. This verifies
      // the reappearing fighter instead of dumping the leftover candidate
      // into the lost slot unchecked.
      const cStraight =
        matchCost(candidates[0], aliveSlot, nowMs, w, useAnchor, extras(candidates[0], aliveSlot)) +
        deadSlotRebindCost(candidates[1], deadSlot, nowMs, useAnchor)
      const cSwap =
        matchCost(candidates[1], aliveSlot, nowMs, w, useAnchor, extras(candidates[1], aliveSlot)) +
        deadSlotRebindCost(candidates[0], deadSlot, nowMs, useAnchor)
      return cStraight <= cSwap
        ? result(candidates[0], candidates[1])
        : result(candidates[1], candidates[0])
    }
    if (candidates.length === 1 && deadSlot) {
      // Single detection: prefer the alive track, but hand it to the lost one
      // when appearance decisively says it's the reappearing fighter.
      const cAlive = matchCost(
        candidates[0], aliveSlot, nowMs, w, useAnchor, extras(candidates[0], aliveSlot)
      )
      const cDead = deadSlotRebindCost(candidates[0], deadSlot, nowMs, useAnchor)
      if (cDead + 0.08 < cAlive) return result(undefined, candidates[0])
      return result(candidates[0], undefined)
    }
    const sorted = [...candidates].sort(
      (p, q) =>
        matchCost(p, aliveSlot, nowMs, w, useAnchor, extras(p, aliveSlot)) -
        matchCost(q, aliveSlot, nowMs, w, useAnchor, extras(q, aliveSlot))
    )
    return result(sorted[0], sorted[1])
  }

  if (aAlive && !bAlive) return oneAliveAssign('A', slotA!, slotB)
  if (!aAlive && bAlive) return oneAliveAssign('B', slotB!, slotA)

  // Teleport gate (normal tracking only): candidate must be physically
  // reachable from the slot's predicted anchor given how long ago the slot
  // was last updated. During a crossing, anchors legitimately collapse and
  // re-separate, so the gate is disabled there.
  const claimOk = (candidate: IdentityCandidate, slot: IdentitySlot): boolean => {
    const dt = Math.max(0, nowMs - slot.wallMs)
    if (phase !== 'tracking' && dt < CROSSING_CLAIM_FREE_MS) return true
    if (dist(candidate.anchor, predictAnchor(slot, nowMs)) <= maxClaimJump(dt)) return true
    // Teleport escape hatch: a candidate that is unreachable by motion may
    // still claim the slot if its appearance decisively matches — this is how
    // tracks survive scene cuts (fighters legitimately "teleport" to new
    // positions). Background phantoms (bystanders, watermark blobs) fail the
    // color match and stay rejected.
    const ref = colorRef(slot, useAnchor)
    return !!(candidate.color && ref) && colorProfileDist(candidate.color, ref) < TELEPORT_COLOR_MAX
  }

  if (candidates.length === 1) {
    const cA = matchCost(candidates[0], slotA!, nowMs, w, useAnchor, extras(candidates[0], slotA!))
    const cB = matchCost(candidates[0], slotB!, nowMs, w, useAnchor, extras(candidates[0], slotB!))
    const okA = claimOk(candidates[0], slotA!)
    const okB = claimOk(candidates[0], slotB!)
    // Phantom rejection: a lone candidate that is unreachable from BOTH live
    // tracks is junk (bystander / reflection) — claiming a track with it is
    // how identities get dragged off their fighters. Hold both tracks instead.
    if (!okA && !okB) return {}
    if (okA && !okB) return { A: candidates[0] }
    if (okB && !okA) return { B: candidates[0] }
    // Freshness hysteresis: the slot that has been tracking this body keeps
    // it unless the other slot is clearly a better match. Without this, a
    // lone body ping-pongs between slots on cost noise — each ping refreshes
    // the losing slot's wallMs, so a long-dead track (e.g. after a scene cut)
    // is kept "alive" and its ghost skeleton never expires.
    const freshness = slotA!.wallMs - slotB!.wallMs
    if (freshness > 0) return cA <= cB + SWAP_HYSTERESIS ? { A: candidates[0] } : { B: candidates[0] }
    if (freshness < 0) return cB <= cA + SWAP_HYSTERESIS ? { B: candidates[0] } : { A: candidates[0] }
    return cA <= cB ? { A: candidates[0] } : { B: candidates[0] }
  }

  const c0 = candidates[0]
  const c1 = candidates[1]

  // Trajectory-primary costs (Kalman-predicted centers).
  const tStraight =
    trajectoryCost(c0, slotA!, nowMs) + trajectoryCost(c1, slotB!, nowMs)
  const tSwap =
    trajectoryCost(c0, slotB!, nowMs) + trajectoryCost(c1, slotA!, nowMs)

  // Full matchCost still used for teleport validation / non-crossing path.
  const cStraight =
    matchCost(c0, slotA!, nowMs, w, useAnchor, extras(c0, slotA!)) +
    matchCost(c1, slotB!, nowMs, w, useAnchor, extras(c1, slotB!))
  const cSwap =
    matchCost(c0, slotB!, nowMs, w, useAnchor, extras(c0, slotB!)) +
    matchCost(c1, slotA!, nowMs, w, useAnchor, extras(c1, slotA!))

  const separation = predictedSlotDistance(slotA!, slotB!, nowMs)
  const swapResistance =
    phase === 'tracking' ? Math.max(SWAP_HYSTERESIS, separation * 0.5) : SWAP_HYSTERESIS

  let pairing: { A: IdentityCandidate; B: IdentityCandidate }

  if (opts?.blockSwap) {
    // LOCK / blockSwap: freeze pairing by trajectory (appearance only on tie).
    const lock = seedPairLockByTrajectory(c0, c1, slotA!, slotB!, nowMs, useAnchor)
    pairing = { A: candidates[lock.aCandIdx], B: candidates[lock.bCandIdx] }
  } else if (isCrossingPhase(phase) && phase !== 'recovering') {
    // Crossing (not recovering): trajectory primary; appearance only on tie.
    if (Math.abs(tStraight - tSwap) >= TRAJ_TIE_MARGIN) {
      pairing = tStraight <= tSwap ? { A: c0, B: c1 } : { A: c1, B: c0 }
    } else {
      const aDirect =
        appearanceOnlyCost(c0, slotA!, useAnchor, 'A') +
        appearanceOnlyCost(c1, slotB!, useAnchor, 'B')
      const aSwap =
        appearanceOnlyCost(c0, slotB!, useAnchor, 'B') +
        appearanceOnlyCost(c1, slotA!, useAnchor, 'A')
      if (Math.abs(aDirect - aSwap) > APPEARANCE_DECISIVE_MARGIN) {
        pairing = aDirect <= aSwap ? { A: c0, B: c1 } : { A: c1, B: c0 }
      } else {
        pairing = tStraight <= tSwap ? { A: c0, B: c1 } : { A: c1, B: c0 }
      }
    }
  } else if (cSwap + swapResistance < cStraight) {
    // Normal tracking: full matchCost with separation-scaled hysteresis.
    // If trajectory strongly disagrees with a marginal appearance swap, prefer traj.
    if (Math.abs(tStraight - tSwap) >= TRAJ_TIE_MARGIN && tStraight < tSwap) {
      pairing = { A: c0, B: c1 }
    } else {
      pairing = { A: c1, B: c0 }
    }
  } else {
    pairing = { A: c0, B: c1 }
  }

  return {
    A: claimOk(pairing.A, slotA!) ? pairing.A : undefined,
    B: claimOk(pairing.B, slotB!) ? pairing.B : undefined,
  }
}

export function advanceCrossingPhase(
  current: CrossingPhase,
  slotA: IdentitySlot | null,
  slotB: IdentitySlot | null,
  poseCount: number,
  nowMs: number,
  stableFrames: number
): { phase: CrossingPhase; stableFrames: number } {
  if (!slotA || !slotB) {
    if (slotA) slotA.anchorColor = null
    if (slotB) slotB.anchorColor = null
    return { phase: 'tracking', stableFrames: 0 }
  }

  // During merged/recovering the hidden slot receives no updates by design —
  // judge staleness against the crossing limit so the phase machine (and the
  // pre-cross anchor colors it guards) survives a clinch longer than 2 s.
  const staleLimit = isCrossingPhase(current) ? IDENTITY_STALE_CROSSING_MS : IDENTITY_STALE_MS
  const aAlive = nowMs - slotA.wallMs < staleLimit
  const bAlive = nowMs - slotB.wallMs < staleLimit
  if (!aAlive || !bAlive) {
    slotA.anchorColor = null
    slotB.anchorColor = null
    return { phase: 'tracking', stableFrames: 0 }
  }

  const slotDist = predictedSlotDistance(slotA, slotB, nowMs)

  switch (current) {
    case 'tracking':
      if (slotDist < APPROACHING_DIST) {
        slotA.anchorColor = slotA.color ? cloneColorProfile(slotA.color) : null
        slotB.anchorColor = slotB.color ? cloneColorProfile(slotB.color) : null
        return { phase: 'approaching', stableFrames: 0 }
      }
      return { phase: 'tracking', stableFrames: 0 }

    case 'approaching':
      if (poseCount < 2 || slotDist < MERGED_DIST) {
        return { phase: 'merged', stableFrames: 0 }
      }
      if (slotDist > APPROACHING_DIST + 0.02) {
        slotA.anchorColor = null
        slotB.anchorColor = null
        return { phase: 'tracking', stableFrames: 0 }
      }
      return { phase: 'approaching', stableFrames: 0 }

    case 'merged':
      if (poseCount === 2 && slotDist > SPLIT_DIST) {
        return { phase: 'recovering', stableFrames: 1 }
      }
      return { phase: 'merged', stableFrames: 0 }

    case 'recovering': {
      const stable = poseCount === 2 && slotDist > SPLIT_DIST
      const next = stable ? stableFrames + 1 : 0
      if (next >= STABLE_FRAMES_TO_RESUME) {
        slotA.anchorColor = null
        slotB.anchorColor = null
        return { phase: 'tracking', stableFrames: 0 }
      }
      return { phase: 'recovering', stableFrames: next }
    }
  }
}

export function updateIdentitySlotColor(
  prev: IdentitySlot | null,
  candidate: IdentityCandidate,
  phase: CrossingPhase,
  colorSmoothing: number = 0.15
): ColorProfile | null {
  if (phase === 'tracking') {
    return blendColorProfile(prev?.color ?? null, candidate.color, colorSmoothing)
  }
  return prev?.color ?? candidate.color
}

export function clampVelocity(vx: number, vy: number): { vx: number; vy: number } {
  return {
    vx: Math.max(-VELOCITY_MAX, Math.min(VELOCITY_MAX, vx)),
    vy: Math.max(-VELOCITY_MAX, Math.min(VELOCITY_MAX, vy)),
  }
}

/** Legacy single-torso RGB distance for profile mixing (0–255 space). */
export function legacyRgbDistance(a: NormalizedRgb | null, b: NormalizedRgb | null): number {
  return rgbDistance255(a, b)
}
