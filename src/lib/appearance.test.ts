/**
 * Unit tests for the appearance tracker.
 *
 * What we can test in node (no DOM):
 *   - bhattacharyyaDistance math
 *   - score / suggestSwap / commit / isReady / reset logic against
 *     fabricated histograms that simulate the actual crossing scenario
 *
 * What we cannot test here (needs a browser):
 *   - sampleHistogram against a real video element / canvas pixels
 *   - end-to-end pipeline with MediaPipe poses
 *
 * The goal of this file is to prove the *identity-recovery algorithm* is
 * correct given known histograms. If two fighters have visually distinct
 * torsos, the tracker MUST suggest a swap when motion misassigns them.
 */

import { describe, it, expect } from 'vitest'
import {
  bhattacharyyaDistance,
  createAppearanceTracker,
  type Histogram,
} from './appearance'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const HIST_SIZE = 12 * 8 * 4 // must match appearance.ts

/** Build a normalized histogram with mass concentrated in a few bins.
 * `peakBins` is a list of [binIndex, weight] pairs. */
function makeHistogram(peakBins: Array<[number, number]>): Histogram {
  const h = new Float32Array(HIST_SIZE)
  for (const [idx, w] of peakBins) h[idx] = w
  let sum = 0
  for (let i = 0; i < HIST_SIZE; i++) sum += h[i]
  if (sum > 0) for (let i = 0; i < HIST_SIZE; i++) h[i] /= sum
  return h
}

/** A "blue corner" fighter: mass on bins corresponding to blue hues + dark values */
const blueFighterHist = (): Histogram =>
  makeHistogram([
    [180, 10], // hue ~180° (cyan-blue), high sat, mid value
    [181, 8],
    [182, 6],
    [200, 4],
  ])

/** A "red corner" fighter: mass on bins for red hues + dark values */
const redFighterHist = (): Histogram =>
  makeHistogram([
    [10, 10], // hue ~0° (red), high sat, mid value
    [11, 8],
    [12, 6],
    [30, 4],
  ])

/** A slightly different blue (lighting variation) — close but not identical */
const blueFighterHistLighting = (): Histogram =>
  makeHistogram([
    [180, 9],
    [181, 9],
    [182, 5],
    [200, 5],
    [220, 1], // small new bin from lighting shift
  ])

// ─── bhattacharyyaDistance ───────────────────────────────────────────────────

describe('bhattacharyyaDistance', () => {
  it('returns 0 for identical histograms', () => {
    const h = blueFighterHist()
    expect(bhattacharyyaDistance(h, h)).toBeLessThan(1e-6)
  })

  it('returns close to 1 for non-overlapping histograms', () => {
    const blue = blueFighterHist()
    const red = redFighterHist()
    // No bin overlap → BC ≈ 0 → distance ≈ 1
    expect(bhattacharyyaDistance(blue, red)).toBeGreaterThan(0.95)
  })

  it('returns small distance for similar histograms (lighting drift)', () => {
    const a = blueFighterHist()
    const b = blueFighterHistLighting()
    const d = bhattacharyyaDistance(a, b)
    // Same fighter under slight lighting change should be well within HIGH_CONFIDENCE_THRESHOLD (0.35)
    expect(d).toBeGreaterThan(0)
    expect(d).toBeLessThan(0.3)
  })

  it('is symmetric', () => {
    const a = blueFighterHist()
    const b = redFighterHist()
    expect(Math.abs(bhattacharyyaDistance(a, b) - bhattacharyyaDistance(b, a))).toBeLessThan(1e-9)
  })

  it('returns 1 for mismatched lengths', () => {
    const a = new Float32Array(10) as Histogram
    const b = new Float32Array(20) as Histogram
    expect(bhattacharyyaDistance(a, b)).toBe(1)
  })
})

// ─── Tracker lifecycle ───────────────────────────────────────────────────────

describe('AppearanceTracker — lifecycle', () => {
  it('isReady() is false until both slots have a fingerprint', () => {
    const t = createAppearanceTracker()
    expect(t.isReady()).toBe(false)

    // Commit only A — still not ready
    t.commit([blueFighterHist(), redFighterHist()], 0, null, 1000)
    expect(t.isReady()).toBe(false)

    // Now commit B
    t.commit([blueFighterHist(), redFighterHist()], null, 1, 1100)
    expect(t.isReady()).toBe(true)
  })

  it('reset() clears all state', () => {
    const t = createAppearanceTracker()
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)
    expect(t.isReady()).toBe(true)
    t.reset()
    expect(t.isReady()).toBe(false)
    expect(t.debugSnapshot()).toEqual({
      hasA: false,
      hasB: false,
      samplesA: 0,
      samplesB: 0,
      bankA: 0,
      bankB: 0,
    })
  })

  it('debugSnapshot reports sample counts', () => {
    const t = createAppearanceTracker()
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)
    const snap = t.debugSnapshot()
    expect(snap.hasA).toBe(true)
    expect(snap.hasB).toBe(true)
    expect(snap.samplesA).toBeGreaterThanOrEqual(1)
    expect(snap.samplesB).toBeGreaterThanOrEqual(1)
  })

  it('ignores commits entirely when allowLearn is false (crossing protection)', () => {
    const t = createAppearanceTracker()
    // Bootstrap is also blocked — mid-crossing histograms are mixed pixels.
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000, { allowLearn: false })
    expect(t.isReady()).toBe(false)

    // Bootstrap normally, then verify a no-learn commit changes nothing.
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 2000)
    const before = t.debugSnapshot()
    t.commit([blueFighterHistLighting(), redFighterHist()], 0, 1, 3000, { allowLearn: false })
    expect(t.debugSnapshot()).toEqual(before)
  })

  it('refuses to update fingerprint when observation is too far (drift protection)', () => {
    const t = createAppearanceTracker()
    // Bootstrap with blue/red
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)
    const sampleCountBefore = t.debugSnapshot().samplesA

    // Now try to commit a "red" histogram into slot A (motion was wrong this frame)
    // Tracker should reject — distance > HIGH_CONFIDENCE_THRESHOLD (0.35)
    t.commit([redFighterHist(), blueFighterHist()], 0, 1, 1100)

    const sampleCountAfter = t.debugSnapshot().samplesA
    // sampleCount should NOT have incremented because the observation was rejected
    expect(sampleCountAfter).toBe(sampleCountBefore)
  })
})

// ─── Snapshot bank ───────────────────────────────────────────────────────────

describe('AppearanceTracker — snapshot bank', () => {
  it('captures spaced snapshots into the bank (700ms minimum gap)', () => {
    const t = createAppearanceTracker()
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)
    expect(t.debugSnapshot().bankA).toBe(1)

    // 100ms later — too soon, no new snapshot
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1100)
    expect(t.debugSnapshot().bankA).toBe(1)

    // 800ms after the first — second snapshot lands
    t.commit([blueFighterHistLighting(), redFighterHist()], 0, 1, 1800)
    expect(t.debugSnapshot().bankA).toBe(2)
  })

  it('score matches against the bank, not just the drifting EMA', () => {
    const t = createAppearanceTracker()
    // Bootstrap with the original blue look, then bank a lighting variant.
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)
    t.commit([blueFighterHistLighting(), redFighterHist()], 0, 1, 1800)

    // The EMA is still ~the original blue (alpha 0.05), but the bank holds an
    // exact copy of the lighting variant → distance must be ~0, well below
    // what the EMA alone would report (~0.14 for these histograms).
    const scores = t.score([blueFighterHistLighting()])
    expect(scores.candidateToA[0]).not.toBeNull()
    expect(scores.candidateToA[0]!).toBeLessThan(0.05)

    // And a totally different appearance still scores high.
    const red = t.score([redFighterHist()])
    expect(red.candidateToA[0]!).toBeGreaterThan(0.9)
  })
})

// ─── score() ─────────────────────────────────────────────────────────────────

describe('AppearanceTracker — score', () => {
  it('returns null scores before any fingerprint is captured', () => {
    const t = createAppearanceTracker()
    const scores = t.score([blueFighterHist(), redFighterHist()])
    expect(scores.candidateToA[0]).toBeNull()
    expect(scores.candidateToB[0]).toBeNull()
  })

  it('returns low distance for same-fighter candidates after bootstrap', () => {
    const t = createAppearanceTracker()
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)

    const scores = t.score([blueFighterHist(), redFighterHist()])
    // candidate 0 (blue) should match A (blue) with low distance
    expect(scores.candidateToA[0]).toBeLessThan(0.1)
    // candidate 1 (red) should match B (red) with low distance
    expect(scores.candidateToB[1]).toBeLessThan(0.1)
    // candidate 0 (blue) vs B (red) should be high distance
    expect(scores.candidateToB[0]).toBeGreaterThan(0.9)
  })

  it('returns null entries for null candidate histograms', () => {
    const t = createAppearanceTracker()
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)
    const scores = t.score([null, redFighterHist()])
    expect(scores.candidateToA[0]).toBeNull()
    expect(scores.candidateToB[0]).toBeNull()
    expect(scores.candidateToB[1]).toBeLessThan(0.1)
  })
})

// ─── suggestSwap — the crossing scenario (the whole reason this exists) ─────

describe('AppearanceTracker — suggestSwap (crossing scenario)', () => {
  it('returns null before bootstrap (cannot override motion without fingerprints)', () => {
    const t = createAppearanceTracker()
    const scores = t.score([blueFighterHist(), redFighterHist()])
    expect(t.suggestSwap(scores, 0, 1)).toBeNull()
  })

  it('does NOT suggest swap when motion is correct', () => {
    const t = createAppearanceTracker()
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)

    // Frame N+1: same fighters, correctly assigned by motion
    const candidates = [blueFighterHist(), redFighterHist()]
    const scores = t.score(candidates)
    // motion: A=candidate 0 (blue), B=candidate 1 (red) — CORRECT
    const swap = t.suggestSwap(scores, 0, 1)
    expect(swap).toBeNull()
  })

  it('SUGGESTS SWAP when motion misassigns fighters after a cross', () => {
    const t = createAppearanceTracker()
    // Bootstrap: A=blue, B=red
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)

    // Frame N+1: fighters crossed, MediaPipe still returns two poses but in
    // reverse order. Motion-based assignment (which trusts position) maps:
    //   A → candidate 0 (which is actually the RED fighter now)
    //   B → candidate 1 (which is actually the BLUE fighter now)
    // This is the bug we're fixing.
    const candidates = [redFighterHist(), blueFighterHist()] // swapped order
    const scores = t.score(candidates)

    // Motion thinks: A=0, B=1
    const swap = t.suggestSwap(scores, 0, 1)
    expect(swap).not.toBeNull()
    // Appearance corrects: A should be candidate 1 (blue), B should be candidate 0 (red)
    expect(swap!.aIndex).toBe(1)
    expect(swap!.bIndex).toBe(0)
  })

  it('does NOT suggest swap when appearance is ambiguous (both fighters look similar)', () => {
    const t = createAppearanceTracker()
    // Bootstrap with two very similar histograms (e.g. matching uniforms)
    const sim1 = makeHistogram([[180, 10], [181, 8], [182, 6]])
    const sim2 = makeHistogram([[180, 9], [181, 9], [182, 7]]) // ~identical
    t.commit([sim1, sim2], 0, 1, 1000)

    // Now motion misassigns — but appearance can't tell them apart
    const candidates = [sim2, sim1]
    const scores = t.score(candidates)
    const swap = t.suggestSwap(scores, 0, 1)
    // Should abstain — distances are too close to override motion confidently
    expect(swap).toBeNull()
  })

  it('does NOT suggest swap when one candidate failed to sample (null hist)', () => {
    const t = createAppearanceTracker()
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)

    const scores = t.score([null, redFighterHist()])
    // candidate 0 is null → can't compute swap distances → abstain
    const swap = t.suggestSwap(scores, 0, 1)
    expect(swap).toBeNull()
  })

  it('suggests swap from one strong sampled candidate when the other torso is occluded', () => {
    const t = createAppearanceTracker()
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)

    const scores = t.score([redFighterHist(), null])
    const swap = t.suggestSwap(scores, 0, 1)

    expect(swap).not.toBeNull()
    expect(swap!.aIndex).toBe(1)
    expect(swap!.bIndex).toBe(0)
  })

  it('suggests swap when only the second sampled candidate clearly belongs to A', () => {
    const t = createAppearanceTracker()
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)

    const scores = t.score([null, blueFighterHist()])
    const swap = t.suggestSwap(scores, 0, 1)

    expect(swap).not.toBeNull()
    expect(swap!.aIndex).toBe(1)
    expect(swap!.bIndex).toBe(0)
  })

  it('handles full crossing dynamics across 5 frames', () => {
    const t = createAppearanceTracker()

    // Frame 0: bootstrap — both fighters cleanly visible, motion correct
    t.commit([blueFighterHist(), redFighterHist()], 0, 1, 1000)
    expect(t.isReady()).toBe(true)

    // Frame 1: separated, motion correct — no swap needed
    {
      const cands = [blueFighterHist(), redFighterHist()]
      const scores = t.score(cands)
      expect(t.suggestSwap(scores, 0, 1)).toBeNull()
      t.commit(cands, 0, 1, 1100)
    }

    // Frame 2: approaching crossing, motion still correct
    {
      const cands = [blueFighterHistLighting(), redFighterHist()]
      const scores = t.score(cands)
      expect(t.suggestSwap(scores, 0, 1)).toBeNull()
      t.commit(cands, 0, 1, 1200)
    }

    // Frame 3: CROSSED — motion incorrectly swaps assignment
    // (the bug: motion sees pose at "left" position, assigns it to A,
    //  but actually it's the red fighter now)
    {
      const cands = [redFighterHist(), blueFighterHist()] // swapped order
      const scores = t.score(cands)
      const swap = t.suggestSwap(scores, 0, 1)
      expect(swap).not.toBeNull()
      expect(swap!.aIndex).toBe(1) // blue is now at index 1
      expect(swap!.bIndex).toBe(0) // red is now at index 0

      // Apply correction → commit final assignment
      t.commit(cands, swap!.aIndex, swap!.bIndex, 1300)
    }

    // Frame 4: still crossed, but now motion *might* catch up via velocity.
    // Whether it does or not, appearance should still be self-consistent.
    {
      const cands = [redFighterHist(), blueFighterHist()]
      const scores = t.score(cands)
      // candidate 0 (red) should have low distance to B (red), high to A (blue)
      expect(scores.candidateToB[0]!).toBeLessThan(0.2)
      expect(scores.candidateToA[0]!).toBeGreaterThan(0.8)
    }
  })
})
