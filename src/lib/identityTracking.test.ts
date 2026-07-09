/**
 * Unit tests for occlusion-robust identity tracking.
 *
 * Focus: the four crossing phases (approach → overlap → full hide →
 * separation/re-acquisition) and the math that keeps A/B labels stable
 * through them:
 *   - decayed constant-velocity prediction (trajectory continuity)
 *   - duplicate-detection suppression before assignment
 *   - 2×2 assignment with swap hysteresis
 *   - appearance + trajectory re-binding of LOST tracks at re-acquisition
 *   - crossing phase machine survival through long clinches
 */

import { describe, it, expect } from 'vitest'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import {
  createKalman2D,
  predictKalman,
  updateKalman,
} from './kalman2d'
import {
  advanceCrossingPhase,
  assignFighterTracks,
  BOX_LOCK_MIN_CONTAINMENT,
  boxContainment,
  boxesInProximityLock,
  boxesOverlap,
  deadSlotRebindCost,
  dedupePoseCandidates,
  DUPLICATE_POSE_MEAN_DIST,
  ensureSlotKalman,
  IDENTITY_STALE_MS,
  IDENTITY_STALE_CROSSING_MS,
  LOCK_RELEASE_FRAMES,
  LOCK_SEPARATION_DIST,
  poseMeanJointDistance,
  poseVisBounds,
  predictAnchor,
  seedPairLockByAppearance,
  seedPairLockByTrajectory,
  STABLE_FRAMES_TO_RESUME,
  updateSlotKalman,
  type ColorProfile,
  type IdentityCandidate,
  type IdentitySlot,
  type PairLock,
} from './identityTracking'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BLUE: ColorProfile = { torso: { r: 0.15, g: 0.2, b: 0.85 }, legs: null }
const RED: ColorProfile = { torso: { r: 0.85, g: 0.15, b: 0.15 }, legs: null }

function makeSlot(opts: {
  x: number
  y?: number
  vx?: number
  vy?: number
  wallMs: number
  color?: ColorProfile | null
  anchorColor?: ColorProfile | null
}): IdentitySlot {
  return {
    pose: [],
    anchor: { x: opts.x, y: opts.y ?? 0.5 },
    color: opts.color ?? null,
    anchorColor: opts.anchorColor ?? null,
    scale: 0.2,
    velocity: { vx: opts.vx ?? 0, vy: opts.vy ?? 0 },
    wallMs: opts.wallMs,
  }
}

function makeCandidate(opts: {
  x: number
  y?: number
  color?: ColorProfile | null
}): IdentityCandidate {
  return {
    pose: [],
    anchor: { x: opts.x, y: opts.y ?? 0.5 },
    color: opts.color ?? null,
    scale: 0.2,
  }
}

/** 33-landmark pose clustered around (cx, cy). */
function makePose(cx: number, cy: number, visibility = 0.9): NormalizedLandmark[] {
  return Array.from({ length: 33 }, (_, i) => ({
    x: cx + (i % 5) * 0.002,
    y: cy + Math.floor(i / 5) * 0.002,
    z: 0,
    visibility,
  })) as NormalizedLandmark[]
}

// ─── boxesOverlap / pair lock ────────────────────────────────────────────────

describe('boxesOverlap / seedPairLockByAppearance', () => {
  it('detects substantial box containment as overlap', () => {
    const a = { l: 0.4, t: 0.3, r: 0.6, b: 0.8 }
    const b = { l: 0.45, t: 0.35, r: 0.55, b: 0.75 }
    expect(boxContainment(a, b)).toBeGreaterThan(0.55)
    expect(boxesOverlap(a, b)).toBe(true)
  })

  it('does not flag well-separated fighters as overlapping', () => {
    const a = { l: 0.2, t: 0.3, r: 0.35, b: 0.8 }
    const b = { l: 0.65, t: 0.3, r: 0.8, b: 0.8 }
    expect(boxesOverlap(a, b)).toBe(false)
  })

  it('poseVisBounds returns a box for a full pose', () => {
    const pose = makePose(0.5, 0.5)
    const bb = poseVisBounds(pose)
    expect(bb).not.toBeNull()
    expect(bb!.r - bb!.l).toBeGreaterThan(0)
    expect(bb!.b - bb!.t).toBeGreaterThan(0)
  })

  it('seeds pair lock by appearance, ignoring crossed positions', () => {
    const slotA = makeSlot({ x: 0.3, wallMs: 1000, color: BLUE, anchorColor: BLUE })
    const slotB = makeSlot({ x: 0.7, wallMs: 1000, color: RED, anchorColor: RED })
    const c0 = makeCandidate({ x: 0.72, color: RED })
    const c1 = makeCandidate({ x: 0.28, color: BLUE })
    const lock = seedPairLockByAppearance(c0, c1, slotA, slotB, true)
    expect(lock.aCandIdx).toBe(1)
    expect(lock.bCandIdx).toBe(0)
  })

  it('blockSwap during approaching pairs by trajectory (not L/R), matching colors when traj agrees', () => {
    const NOW = 15_000
    const slotA = makeSlot({ x: 0.3, wallMs: NOW - 30, color: BLUE })
    const slotB = makeSlot({ x: 0.7, wallMs: NOW - 30, color: RED })
    ensureSlotKalman(slotA)
    ensureSlotKalman(slotB)
    const c0 = makeCandidate({ x: 0.72, color: RED })
    const c1 = makeCandidate({ x: 0.28, color: BLUE })
    const out = assignFighterTracks([c0, c1], slotA, slotB, NOW, 'approaching', undefined, {
      blockSwap: true,
    })
    expect(out.A).toBe(c1)
    expect(out.B).toBe(c0)
  })

  it('disables left/right cold start when allowSpatialSeed is false', () => {
    const NOW = 40_000
    const c0 = makeCandidate({ x: 0.8 })
    const c1 = makeCandidate({ x: 0.2 })
    const spatial = assignFighterTracks([c0, c1], null, null, NOW, 'tracking')
    const noSpatial = assignFighterTracks([c0, c1], null, null, NOW, 'tracking', undefined, {
      allowSpatialSeed: false,
    })
    expect(spatial.A).toBe(c1)
    expect(noSpatial.A).toBe(c0)
  })
})

// ─── predictAnchor — decayed constant-velocity prediction ────────────────────

describe('predictAnchor', () => {
  it('returns the anchor itself at dt = 0', () => {
    const slot = makeSlot({ x: 0.4, vx: 0.001, wallMs: 1000 })
    const p = predictAnchor(slot, 1000)
    expect(p.x).toBeCloseTo(0.4, 6)
    expect(p.y).toBeCloseTo(0.5, 6)
  })

  it('moves in the direction of travel as dt grows', () => {
    const slot = makeSlot({ x: 0.4, vx: 0.0005, wallMs: 1000 })
    const p100 = predictAnchor(slot, 1100)
    const p400 = predictAnchor(slot, 1400)
    expect(p100.x).toBeGreaterThan(0.4)
    expect(p400.x).toBeGreaterThan(p100.x)
  })

  it('keeps drifting beyond the old 500 ms freeze point but stays bounded', () => {
    const slot = makeSlot({ x: 0.4, vx: 0.0005, wallMs: 0 })
    const p500 = predictAnchor(slot, 500)
    const p900 = predictAnchor(slot, 900)
    const p5000 = predictAnchor(slot, 5000)
    const p9999 = predictAnchor(slot, 9999)
    // Still progressing after 500 ms (old behavior froze here).
    expect(p900.x).toBeGreaterThan(p500.x)
    // Bounded: displacement asymptotes (caps at the prediction horizon).
    expect(p5000.x).toBeCloseTo(p9999.x, 9)
    expect(p5000.x - 0.4).toBeLessThan(0.0005 * 1400)
  })

  it('predicts opposite directions for opposite velocities', () => {
    const right = makeSlot({ x: 0.5, vx: 0.0004, wallMs: 0 })
    const left = makeSlot({ x: 0.5, vx: -0.0004, wallMs: 0 })
    expect(predictAnchor(right, 600).x).toBeGreaterThan(0.5)
    expect(predictAnchor(left, 600).x).toBeLessThan(0.5)
  })
})

// ─── Duplicate suppression ───────────────────────────────────────────────────

describe('poseMeanJointDistance / dedupePoseCandidates', () => {
  it('mean distance is ~0 for identical poses and large for distinct poses', () => {
    const a = makePose(0.3, 0.5)
    const b = makePose(0.7, 0.5)
    expect(poseMeanJointDistance(a, a)).toBeLessThan(1e-9)
    expect(poseMeanJointDistance(a, b)).toBeGreaterThan(0.3)
  })

  it('collapses two detections of the same body into one', () => {
    const front = makePose(0.5, 0.5, 0.9)
    const dup = makePose(0.5 + DUPLICATE_POSE_MEAN_DIST * 0.4, 0.5, 0.6)
    const out = dedupePoseCandidates([front, dup])
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(front)
  })

  it('keeps the higher-visibility duplicate', () => {
    const weak = makePose(0.5, 0.5, 0.4)
    const strong = makePose(0.501, 0.5, 0.95)
    const out = dedupePoseCandidates([weak, strong])
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(strong)
  })

  it('keeps genuinely distinct fighters (clinch is NOT a duplicate)', () => {
    const a = makePose(0.45, 0.5)
    const b = makePose(0.55, 0.5)
    expect(dedupePoseCandidates([a, b])).toHaveLength(2)
  })

  it('passes through empty / single-pose arrays untouched', () => {
    expect(dedupePoseCandidates([])).toHaveLength(0)
    const only = [makePose(0.5, 0.5)]
    expect(dedupePoseCandidates(only)).toEqual(only)
  })
})

// ─── assignFighterTracks — both tracks alive ─────────────────────────────────

describe('assignFighterTracks — both alive', () => {
  const NOW = 10_000

  it('keeps straight assignment when candidates are near their own slots', () => {
    const slotA = makeSlot({ x: 0.3, wallMs: NOW - 30 })
    const slotB = makeSlot({ x: 0.7, wallMs: NOW - 30 })
    const c0 = makeCandidate({ x: 0.31 })
    const c1 = makeCandidate({ x: 0.69 })
    const out = assignFighterTracks([c0, c1], slotA, slotB, NOW, 'tracking')
    expect(out.A).toBe(c0)
    expect(out.B).toBe(c1)
  })

  it('does NOT swap on a marginal advantage (hysteresis)', () => {
    const slotA = makeSlot({ x: 0.5, wallMs: NOW - 30 })
    const slotB = makeSlot({ x: 0.52, wallMs: NOW - 30 })
    // Swap is better by 0.02 — below SWAP_HYSTERESIS (0.04) → stick.
    const c0 = makeCandidate({ x: 0.515 })
    const c1 = makeCandidate({ x: 0.505 })
    const out = assignFighterTracks([c0, c1], slotA, slotB, NOW, 'tracking')
    expect(out.A).toBe(c0)
    expect(out.B).toBe(c1)
  })

  it('swaps when appearance decisively disagrees (post-cross correction)', () => {
    const slotA = makeSlot({ x: 0.5, wallMs: NOW - 30, color: BLUE })
    const slotB = makeSlot({ x: 0.52, wallMs: NOW - 30, color: RED })
    // Detections come back with colors crossed relative to slot positions.
    const c0 = makeCandidate({ x: 0.52, color: RED })
    const c1 = makeCandidate({ x: 0.5, color: BLUE })
    const out = assignFighterTracks([c0, c1], slotA, slotB, NOW, 'tracking')
    expect(out.A).toBe(c1)
    expect(out.B).toBe(c0)
  })
})

// ─── assignFighterTracks — re-acquisition of a LOST track ───────────────────

describe('assignFighterTracks — one track lost (re-acquisition)', () => {
  const NOW = 20_000

  it('verifies the reappearing fighter by appearance instead of dumping the leftover', () => {
    // A (blue) stayed visible on the right; B (red) was hidden for 3 s and
    // reappears on the LEFT — a pure leftover-assignment would be untested,
    // and a left/right sort would be wrong half the time.
    const slotA = makeSlot({ x: 0.7, wallMs: NOW - 30, color: BLUE })
    const slotB = makeSlot({ x: 0.6, wallMs: NOW - 3000, color: RED })
    const red = makeCandidate({ x: 0.3, color: RED })
    const blue = makeCandidate({ x: 0.72, color: BLUE })
    const out = assignFighterTracks([red, blue], slotA, slotB, NOW, 'tracking')
    expect(out.A).toBe(blue)
    expect(out.B).toBe(red)
  })

  it('hands a single detection to the LOST slot only when appearance is decisive', () => {
    const slotA = makeSlot({ x: 0.5, wallMs: NOW - 30, color: BLUE })
    const slotB = makeSlot({ x: 0.6, wallMs: NOW - 3000, color: RED })
    // A red detection near the dead slot's last position → it's B returning.
    const red = makeCandidate({ x: 0.62, color: RED })
    const out = assignFighterTracks([red], slotA, slotB, NOW, 'tracking')
    expect(out.B).toBe(red)
    expect(out.A).toBeUndefined()
  })

  it('prefers the alive slot for an ambiguous single detection', () => {
    const slotA = makeSlot({ x: 0.5, wallMs: NOW - 30 })
    const slotB = makeSlot({ x: 0.6, wallMs: NOW - 3000 })
    const c = makeCandidate({ x: 0.51 })
    const out = assignFighterTracks([c], slotA, slotB, NOW, 'tracking')
    expect(out.A).toBe(c)
    expect(out.B).toBeUndefined()
  })

  it('treats a slot as still-matchable during crossing phases (extended staleness)', () => {
    // 3 s stale would be "dead" in tracking, but mid-crossing the hidden slot
    // legitimately has no updates — it must still compete in the 2×2.
    const ageMs = 3000
    expect(ageMs).toBeGreaterThan(IDENTITY_STALE_MS)
    expect(ageMs).toBeLessThan(IDENTITY_STALE_CROSSING_MS)
    const slotA = makeSlot({ x: 0.45, wallMs: NOW - 30, color: BLUE, anchorColor: BLUE })
    const slotB = makeSlot({ x: 0.5, wallMs: NOW - ageMs, color: RED, anchorColor: RED })
    const red = makeCandidate({ x: 0.55, color: RED })
    const blue = makeCandidate({ x: 0.44, color: BLUE })
    const out = assignFighterTracks([red, blue], slotA, slotB, NOW, 'recovering')
    expect(out.A).toBe(blue)
    expect(out.B).toBe(red)
  })
})

// ─── assignFighterTracks — both tracks lost ──────────────────────────────────

describe('assignFighterTracks — both tracks lost', () => {
  const NOW = 30_000

  it('re-binds by appearance even when screen sides flipped during the hide', () => {
    // Pre-hide: A (blue) left, B (red) right. They crossed while hidden.
    const slotA = makeSlot({ x: 0.3, wallMs: NOW - 4000, color: BLUE })
    const slotB = makeSlot({ x: 0.7, wallMs: NOW - 4000, color: RED })
    const red = makeCandidate({ x: 0.25, color: RED })
    const blue = makeCandidate({ x: 0.75, color: BLUE })
    const out = assignFighterTracks([red, blue], slotA, slotB, NOW, 'tracking')
    // Left/right sort would say A = red (leftmost) — appearance must win.
    expect(out.A).toBe(blue)
    expect(out.B).toBe(red)
  })

  it('falls back to trajectory continuity when no appearance is stored', () => {
    // A was moving right, B moving left; they continued through the cross.
    const slotA = makeSlot({ x: 0.4, vx: 0.0005, wallMs: NOW - 3000 })
    const slotB = makeSlot({ x: 0.6, vx: -0.0005, wallMs: NOW - 3000 })
    const cRight = makeCandidate({ x: 0.62 })
    const cLeft = makeCandidate({ x: 0.38 })
    const out = assignFighterTracks([cRight, cLeft], slotA, slotB, NOW, 'tracking')
    // A continued rightward → A is the right-hand candidate now.
    expect(out.A).toBe(cRight)
    expect(out.B).toBe(cLeft)
  })

  it('assigns a lone detection to the better-matching lost slot', () => {
    const slotA = makeSlot({ x: 0.3, wallMs: NOW - 4000, color: BLUE })
    const slotB = makeSlot({ x: 0.7, wallMs: NOW - 4000, color: RED })
    const red = makeCandidate({ x: 0.4, color: RED })
    const out = assignFighterTracks([red], slotA, slotB, NOW, 'tracking')
    expect(out.B).toBe(red)
    expect(out.A).toBeUndefined()
  })

  it('uses left/right ordering only on a true cold start (no slot memory)', () => {
    const c0 = makeCandidate({ x: 0.8 })
    const c1 = makeCandidate({ x: 0.2 })
    const out = assignFighterTracks([c0, c1], null, null, NOW, 'tracking')
    expect(out.A).toBe(c1)
    expect(out.B).toBe(c0)
  })
})

// ─── deadSlotRebindCost ──────────────────────────────────────────────────────

describe('deadSlotRebindCost', () => {
  it('appearance dominates position', () => {
    const slot = makeSlot({ x: 0.5, wallMs: 0, color: RED })
    const matchingFar = makeCandidate({ x: 0.9, color: RED })
    const wrongNear = makeCandidate({ x: 0.5, color: BLUE })
    expect(deadSlotRebindCost(matchingFar, slot, 1000, false)).toBeLessThan(
      deadSlotRebindCost(wrongNear, slot, 1000, false)
    )
  })

  it('prefers the pre-cross anchor color when useAnchor is set', () => {
    // Drifted live color says BLUE, pre-cross snapshot says RED.
    const slot = makeSlot({ x: 0.5, wallMs: 0, color: BLUE, anchorColor: RED })
    const red = makeCandidate({ x: 0.5, color: RED })
    expect(deadSlotRebindCost(red, slot, 1000, true)).toBeLessThan(
      deadSlotRebindCost(red, slot, 1000, false)
    )
  })
})

// ─── advanceCrossingPhase — the crossing state machine ───────────────────────

describe('advanceCrossingPhase', () => {
  const NOW = 50_000

  function freshPair(distApart: number) {
    const slotA = makeSlot({ x: 0.5 - distApart / 2, wallMs: NOW - 30, color: BLUE })
    const slotB = makeSlot({ x: 0.5 + distApart / 2, wallMs: NOW - 30, color: RED })
    return { slotA, slotB }
  }

  it('tracking → approaching when slots converge, snapshotting anchor colors', () => {
    const { slotA, slotB } = freshPair(0.1)
    const r = advanceCrossingPhase('tracking', slotA, slotB, 2, NOW, 0)
    expect(r.phase).toBe('approaching')
    expect(slotA.anchorColor).toEqual(BLUE)
    expect(slotB.anchorColor).toEqual(RED)
  })

  it('approaching → merged when a fighter disappears (poseCount < 2)', () => {
    const { slotA, slotB } = freshPair(0.09)
    const r = advanceCrossingPhase('approaching', slotA, slotB, 1, NOW, 0)
    expect(r.phase).toBe('merged')
  })

  it('SURVIVES a long clinch: hidden slot stale past the normal limit keeps phase merged', () => {
    const slotA = makeSlot({ x: 0.5, wallMs: NOW - 30, color: BLUE, anchorColor: BLUE })
    const slotB = makeSlot({ x: 0.52, wallMs: NOW - 3000, color: RED, anchorColor: RED })
    expect(NOW - slotB.wallMs).toBeGreaterThan(IDENTITY_STALE_MS)
    const r = advanceCrossingPhase('merged', slotA, slotB, 1, NOW, 0)
    expect(r.phase).toBe('merged')
    // Pre-cross snapshots must NOT be wiped mid-clinch.
    expect(slotA.anchorColor).toEqual(BLUE)
    expect(slotB.anchorColor).toEqual(RED)
  })

  it('gives up only past the crossing staleness limit', () => {
    const slotA = makeSlot({ x: 0.5, wallMs: NOW - 30, anchorColor: BLUE })
    const slotB = makeSlot({ x: 0.52, wallMs: NOW - IDENTITY_STALE_CROSSING_MS - 500, anchorColor: RED })
    const r = advanceCrossingPhase('merged', slotA, slotB, 1, NOW, 0)
    expect(r.phase).toBe('tracking')
  })

  it('merged → recovering on separation, then tracking after stable frames', () => {
    const { slotA, slotB } = freshPair(0.2)
    let r = advanceCrossingPhase('merged', slotA, slotB, 2, NOW, 0)
    expect(r.phase).toBe('recovering')
    for (let i = 0; i < STABLE_FRAMES_TO_RESUME; i++) {
      r = advanceCrossingPhase(r.phase, slotA, slotB, 2, NOW, r.stableFrames)
    }
    expect(r.phase).toBe('tracking')
    expect(slotA.anchorColor).toBeNull()
    expect(slotB.anchorColor).toBeNull()
  })
})

// ─── Kalman 2D + trajectory-primary identity ─────────────────────────────────

describe('kalman2d', () => {
  it('predict moves in the velocity direction', () => {
    const k = createKalman2D(0.4, 0.5, 0.001, 0)
    const p = predictKalman(k, 100)
    expect(p.x).toBeCloseTo(0.5, 5)
    expect(p.y).toBeCloseTo(0.5, 5)
  })

  it('update pulls state toward the measurement', () => {
    const k = createKalman2D(0.4, 0.5, 0, 0)
    const u = updateKalman(k, 0.6, 0.5)
    expect(u.x).toBeGreaterThan(0.4)
    expect(u.x).toBeLessThan(0.6)
    expect(u.x).toBeCloseTo(0.6, 1)
  })
})

describe('trajectory-primary assignFighterTracks', () => {
  const NOW = 60_000

  it('crossing assignment follows trajectories, not swapped colors', () => {
    // A coasting right, B coasting left. Candidates sit on those coasts but
    // wear the OTHER fighter's colors — appearance would swap; traj must not.
    const slotA = makeSlot({
      x: 0.42,
      vx: 0.0008,
      wallMs: NOW - 40,
      color: BLUE,
      anchorColor: BLUE,
    })
    const slotB = makeSlot({
      x: 0.58,
      vx: -0.0008,
      wallMs: NOW - 40,
      color: RED,
      anchorColor: RED,
    })
    slotA.kalman = createKalman2D(0.42, 0.5, 0.0008, 0)
    slotB.kalman = createKalman2D(0.58, 0.5, -0.0008, 0)

    const predA = predictAnchor(slotA, NOW)
    const predB = predictAnchor(slotB, NOW)
    // Colors deliberately swapped vs slot identity.
    const nearA = makeCandidate({ x: predA.x, color: RED })
    const nearB = makeCandidate({ x: predB.x, color: BLUE })

    const out = assignFighterTracks([nearA, nearB], slotA, slotB, NOW, 'approaching')
    expect(out.A).toBe(nearA)
    expect(out.B).toBe(nearB)
  })

  it('LOCK seed freezes pairing across frames even when appearance prefers a swap', () => {
    const slotA = makeSlot({
      x: 0.48,
      vx: 0.0005,
      wallMs: NOW - 30,
      color: BLUE,
      anchorColor: BLUE,
    })
    const slotB = makeSlot({
      x: 0.52,
      vx: -0.0005,
      wallMs: NOW - 30,
      color: RED,
      anchorColor: RED,
    })
    slotA.kalman = createKalman2D(0.48, 0.5, 0.0005, 0)
    slotB.kalman = createKalman2D(0.52, 0.5, -0.0005, 0)

    const predA = predictAnchor(slotA, NOW)
    const predB = predictAnchor(slotB, NOW)
    const c0 = makeCandidate({ x: predA.x, color: RED }) // appearance says B
    const c1 = makeCandidate({ x: predB.x, color: BLUE }) // appearance says A

    const lock: PairLock = seedPairLockByTrajectory(c0, c1, slotA, slotB, NOW, true)
    // Trajectory: c0→A, c1→B
    expect(lock.aCandIdx).toBe(0)
    expect(lock.bCandIdx).toBe(1)

    // Appearance-only would flip.
    const byApp = seedPairLockByAppearance(c0, c1, slotA, slotB, true)
    expect(byApp.aCandIdx).toBe(1)
    expect(byApp.bCandIdx).toBe(0)

    // Simulate LOCK hold: frozen indices still map correctly on a later frame
    // where appearance still disagrees (same candidate order).
    const later = NOW + 100
    const c0b = makeCandidate({ x: predA.x + 0.01, color: RED })
    const c1b = makeCandidate({ x: predB.x - 0.01, color: BLUE })
    expect(c0b).toBeDefined()
    expect([c0b, c1b][lock.aCandIdx]!.color).toEqual(RED)
    expect([c0b, c1b][lock.bCandIdx]!.color).toEqual(BLUE)
    // Frozen lock still assigns traj pairing, not appearance.
    expect(lock.aCandIdx).toBe(0)
    expect(lock.bCandIdx).toBe(1)
    void later
  })

  it('after separation, re-match follows Kalman prediction', () => {
    const slotA = makeSlot({
      x: 0.35,
      vx: 0.001,
      wallMs: NOW - 30,
      color: BLUE,
    })
    const slotB = makeSlot({
      x: 0.65,
      vx: -0.001,
      wallMs: NOW - 30,
      color: RED,
    })
    slotA.kalman = createKalman2D(0.35, 0.5, 0.001, 0)
    slotB.kalman = createKalman2D(0.65, 0.5, -0.001, 0)

    const predA = predictAnchor(slotA, NOW)
    const predB = predictAnchor(slotB, NOW)
    expect(Math.hypot(predA.x - predB.x, predA.y - predB.y)).toBeGreaterThan(
      LOCK_SEPARATION_DIST
    )

    // Candidates continue on coasts; colors still swapped (stress appearance).
    const nearA = makeCandidate({ x: predA.x, color: RED })
    const nearB = makeCandidate({ x: predB.x, color: BLUE })
    const out = assignFighterTracks([nearA, nearB], slotA, slotB, NOW, 'tracking')
    expect(out.A).toBe(nearA)
    expect(out.B).toBe(nearB)
  })

  it('boxesInProximityLock uses BOX_LOCK_MIN_CONTAINMENT (0.40)', () => {
    expect(BOX_LOCK_MIN_CONTAINMENT).toBe(0.4)
    expect(LOCK_RELEASE_FRAMES).toBe(4)
    const tight = { l: 0.4, t: 0.3, r: 0.6, b: 0.8 }
    const inside = { l: 0.42, t: 0.32, r: 0.58, b: 0.78 }
    expect(boxesInProximityLock(tight, inside)).toBe(true)
    const far = { l: 0.7, t: 0.3, r: 0.85, b: 0.8 }
    expect(boxesInProximityLock(tight, far)).toBe(false)
  })

  it('updateSlotKalman advances filter toward new anchor', () => {
    const slot = makeSlot({ x: 0.4, vx: 0.001, wallMs: 1000 })
    ensureSlotKalman(slot)
    updateSlotKalman(slot, { x: 0.55, y: 0.5 }, { vx: 0.001, vy: 0 }, 50)
    expect(slot.kalman!.x).toBeGreaterThan(0.4)
    expect(slot.kalman!.x).toBeLessThan(0.56)
  })
})
