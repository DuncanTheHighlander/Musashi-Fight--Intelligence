import { describe, expect, it } from 'vitest'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import {
  hasTrackIds,
  replayCandidatesToDenseTrack,
  replayTrackedCandidates,
  type ReplayInFrame,
} from './identityReplayCore'

/** 33-landmark pose whose torso sits at (cx, cy). */
function pose(cx: number, cy: number, visibility = 0.9): NormalizedLandmark[] {
  const lm = Array.from({ length: 33 }, () => ({ x: cx, y: cy, z: 0, visibility }))
  // Torso joints define the anchor used for A/B ordering.
  for (const [i, dx, dy] of [
    [11, -0.04, -0.06],
    [12, 0.04, -0.06],
    [23, -0.03, 0.06],
    [24, 0.03, 0.06],
  ] as Array<[number, number, number]>) {
    lm[i] = { x: cx + dx, y: cy + dy, z: 0, visibility }
  }
  return lm
}

function frame(
  f: number,
  candidates: Array<{ trackId?: number; cx: number; cy: number }>
): ReplayInFrame {
  return {
    f,
    tMs: f * 33,
    candidates: candidates.map((c) => ({
      pose: pose(c.cx, c.cy),
      ...(c.trackId !== undefined ? { trackId: c.trackId } : {}),
    })),
  }
}

describe('hasTrackIds', () => {
  it('is true only when every candidate in every frame carries one', () => {
    expect(hasTrackIds([frame(0, [{ trackId: 1, cx: 0.3, cy: 0.5 }])])).toBe(true)
    expect(hasTrackIds([frame(0, [{ cx: 0.3, cy: 0.5 }])])).toBe(false)
  })

  it('rejects a partially-tagged track rather than trusting half of it', () => {
    const frames = [
      frame(0, [{ trackId: 1, cx: 0.3, cy: 0.5 }]),
      frame(1, [{ cx: 0.3, cy: 0.5 }]),
    ]
    expect(hasTrackIds(frames)).toBe(false)
  })

  it('is false when there are no candidates at all', () => {
    expect(hasTrackIds([frame(0, []), frame(1, [])])).toBe(false)
  })
})

describe('replayTrackedCandidates', () => {
  it('assigns A to the left-hand track and B to the right', () => {
    const frames = Array.from({ length: 10 }, (_, i) =>
      frame(i, [
        { trackId: 7, cx: 0.7, cy: 0.5 },
        { trackId: 3, cx: 0.3, cy: 0.5 },
      ])
    )
    const track = replayTrackedCandidates(frames)

    // Track 3 is left, so it is A regardless of id order or candidate order.
    expect(track[9].A![11].x).toBeCloseTo(0.26, 2)
    expect(track[9].B![11].x).toBeCloseTo(0.66, 2)
  })

  it('never swaps A and B when candidate order changes between frames', () => {
    // The heuristic replayer has to infer this from colour and shape; with a
    // tracker id it is simply carried through.
    const frames = Array.from({ length: 12 }, (_, i) => {
      const left = { trackId: 1, cx: 0.3, cy: 0.5 }
      const right = { trackId: 2, cx: 0.7, cy: 0.5 }
      return frame(i, i % 2 === 0 ? [left, right] : [right, left])
    })
    const track = replayTrackedCandidates(frames)

    for (const sample of track) {
      expect(sample.A![11].x).toBeLessThan(0.5)
      expect(sample.B![11].x).toBeGreaterThan(0.5)
    }
  })

  it('holds identity through a crossing instead of following screen position', () => {
    // Track 1 sweeps left->right (mean x 0.40) and track 2 right->left (mean
    // 0.50), so track 1 is unambiguously A. They cross around i=6. Any
    // position-based assignment would hand A over to track 2 after the
    // crossover; identity must stay with track 1 the whole way.
    const frames = Array.from({ length: 11 }, (_, i) =>
      frame(i, [
        { trackId: 1, cx: 0.2 + i * 0.04, cy: 0.5 },
        { trackId: 2, cx: 0.7 - i * 0.04, cy: 0.5 },
      ])
    )
    const track = replayTrackedCandidates(frames)

    // A starts left of B and ends right of it — the tracks genuinely crossed,
    // and A followed its object rather than its side of the screen.
    expect(track[0].A![11].x).toBeLessThan(track[0].B![11].x)
    expect(track[10].A![11].x).toBeGreaterThan(track[10].B![11].x)
  })

  it('emits null for an unseen track rather than holding a ghost skeleton', () => {
    const frames = [
      frame(0, [
        { trackId: 1, cx: 0.3, cy: 0.5 },
        { trackId: 2, cx: 0.7, cy: 0.5 },
      ]),
      // Fighter 1 fully occluded — SAM returns an empty mask, so no candidate.
      frame(1, [{ trackId: 2, cx: 0.7, cy: 0.5 }]),
      frame(2, [
        { trackId: 1, cx: 0.32, cy: 0.5 },
        { trackId: 2, cx: 0.7, cy: 0.5 },
      ]),
    ]
    const track = replayTrackedCandidates(frames)

    expect(track[0].A).not.toBeNull()
    expect(track[1].A).toBeNull()
    expect(track[1].B).not.toBeNull()
    expect(track[2].A).not.toBeNull()
  })

  it('keeps only the two most-present tracks when a bystander is picked up', () => {
    const frames = Array.from({ length: 10 }, (_, i) =>
      frame(
        i,
        i === 0
          ? [
              { trackId: 1, cx: 0.3, cy: 0.5 },
              { trackId: 2, cx: 0.7, cy: 0.5 },
              { trackId: 9, cx: 0.95, cy: 0.2 },
            ]
          : [
              { trackId: 1, cx: 0.3, cy: 0.5 },
              { trackId: 2, cx: 0.7, cy: 0.5 },
            ]
      )
    )
    const track = replayTrackedCandidates(frames)

    // The one-frame track 9 must never claim a slot.
    for (const sample of track) {
      expect(sample.A![11].x).toBeLessThan(0.5)
      expect(sample.B![11].x).toBeGreaterThan(0.5)
    }
  })

  it('preserves tMs and sample count', () => {
    const frames = Array.from({ length: 5 }, (_, i) => frame(i, [{ trackId: 1, cx: 0.5, cy: 0.5 }]))
    const track = replayTrackedCandidates(frames)
    expect(track).toHaveLength(5)
    expect(track.map((s) => s.tMs)).toEqual([0, 33, 66, 99, 132])
  })
})

describe('replayCandidatesToDenseTrack dispatch', () => {
  it('uses the deterministic path when trackIds are present', () => {
    const frames = Array.from({ length: 6 }, (_, i) =>
      frame(i, [
        { trackId: 1, cx: 0.3, cy: 0.5 },
        { trackId: 2, cx: 0.7, cy: 0.5 },
      ])
    )
    expect(replayCandidatesToDenseTrack(frames)).toEqual(replayTrackedCandidates(frames))
  })

  it('still runs the heuristic replayer for untagged candidates', () => {
    const frames = Array.from({ length: 6 }, (_, i) =>
      frame(i, [
        { cx: 0.3, cy: 0.5 },
        { cx: 0.7, cy: 0.5 },
      ])
    )
    const track = replayCandidatesToDenseTrack(frames)
    expect(track).toHaveLength(6)
  })
})
