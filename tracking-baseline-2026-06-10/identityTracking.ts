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

export type { ColorProfile, NormalizedRgb }

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
}

export type IdentityCandidate = {
  pose: NormalizedLandmark[]
  anchor: PoseAnchor
  color: ColorProfile | null
  scale: number
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
export const COLOR_WEIGHT = 0.35
export const COLOR_WEIGHT_OCCLUSION = 2.5
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
export const CROSSING_CLAIM_FREE_MS = 600

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

export function predictAnchor(slot: IdentitySlot, nowMs: number): PoseAnchor {
  const dt = Math.min(Math.max(0, nowMs - slot.wallMs), PREDICTION_MAX_MS)
  // Exponential-decay extrapolation: effective dt asymptotes to tau, so the
  // predicted anchor keeps moving along the direction of travel during a long
  // hide without ever drifting unboundedly far from the last observation.
  const effectiveDt = PREDICTION_TAU_MS * (1 - Math.exp(-dt / PREDICTION_TAU_MS))
  return {
    x: slot.anchor.x + slot.velocity.vx * effectiveDt,
    y: slot.anchor.y + slot.velocity.vy * effectiveDt,
  }
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
export function dedupePoseCandidates(
  poses: NormalizedLandmark[][],
  threshold: number = DUPLICATE_POSE_MEAN_DIST
): NormalizedLandmark[][] {
  if (poses.length < 2) return poses
  const kept: NormalizedLandmark[][] = []
  for (const pose of poses) {
    const dupIdx = kept.findIndex((other) => poseMeanJointDistance(pose, other) < threshold)
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
  return (
    posCost +
    colorWeight * colorCost +
    Math.min(0.45, scaleCost) * scaleW +
    shapeCost * poseW
  )
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
  costExtras?: (candidate: IdentityCandidate, slot: IdentitySlot) => MatchCostExtras
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
    const sorted = [...candidates].sort((p, q) => p.anchor.x - q.anchor.x)
    return { A: sorted[0], B: sorted[1] }
  }

  const slotsClose =
    aAlive && bAlive ? predictedSlotDistance(slotA!, slotB!, nowMs) < SLOTS_CLOSE_DIST : false
  const freshnessGap = slotA && slotB ? Math.abs(slotA.wallMs - slotB.wallMs) : 0
  const useOcclusionWeight =
    phase !== 'tracking' || slotsClose || freshnessGap > SLOT_FRESHNESS_GAP_MS
  const w = useOcclusionWeight ? COLOR_WEIGHT_OCCLUSION : COLOR_WEIGHT

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
  const cStraight =
    matchCost(c0, slotA!, nowMs, w, useAnchor, extras(c0, slotA!)) +
    matchCost(c1, slotB!, nowMs, w, useAnchor, extras(c1, slotB!))
  const cSwap =
    matchCost(c0, slotB!, nowMs, w, useAnchor, extras(c0, slotB!)) +
    matchCost(c1, slotA!, nowMs, w, useAnchor, extras(c1, slotA!))
  // Separation-scaled hysteresis: swapping two tracks that are far apart in a
  // single frame is physically implausible — both fighters would have had to
  // teleport past each other. The further apart the tracks, the more evidence
  // a swap needs. During crossings the anchors are close, so this reduces to
  // the original SWAP_HYSTERESIS exactly when swaps are actually plausible.
  const separation = predictedSlotDistance(slotA!, slotB!, nowMs)
  const swapResistance =
    phase === 'tracking' ? Math.max(SWAP_HYSTERESIS, separation * 0.5) : SWAP_HYSTERESIS
  let pairing: { A: IdentityCandidate; B: IdentityCandidate }
  if (cSwap + swapResistance < cStraight) {
    pairing = { A: c1, B: c0 }
  } else {
    pairing = { A: c0, B: c1 }
  }
  // Per-pair teleport validation: keep the assignment for the side that is
  // reachable, drop the side that isn't (phantom forced into the leftover
  // slot by the 2×2). The dropped slot holds its prediction instead of being
  // corrupted, so it can re-acquire its real fighter on a later frame.
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
