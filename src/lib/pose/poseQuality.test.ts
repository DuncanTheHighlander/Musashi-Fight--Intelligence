import { describe, expect, it } from 'vitest'
import { assessDenseTrackQuality, cloudTrackUsable, filterFramesByVisibility } from './poseQuality'

type Lm = { x: number; y: number; visibility?: number }

function pose(visibility: number): Lm[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility }))
}

function samples(opts: { count: number; both?: boolean; visibility?: number }) {
  const vis = opts.visibility ?? 0.9
  return Array.from({ length: opts.count }, (_, i) => ({
    tMs: i * 100,
    A: pose(vis),
    B: opts.both === false ? null : pose(vis),
  }))
}

describe('assessDenseTrackQuality', () => {
  it('grades a full clean two-fighter track as high / safe_to_analyze', () => {
    const q = assessDenseTrackQuality(samples({ count: 100 }), 100)
    expect(q.overall).toBe('high')
    expect(q.recommendation).toBe('safe_to_analyze')
    expect(q.coverage).toBe(1)
    expect(q.bothFighters).toBe(1)
    expect(cloudTrackUsable(q)).toBe(true)
  })

  it('grades a half-missing track as medium / analyze_with_caution', () => {
    const q = assessDenseTrackQuality(samples({ count: 60 }), 100)
    expect(q.overall).toBe('medium')
    expect(q.recommendation).toBe('analyze_with_caution')
    expect(cloudTrackUsable(q)).toBe(true)
  })

  it('rejects a track that dropped most of the clip', () => {
    const q = assessDenseTrackQuality(samples({ count: 20 }), 100)
    expect(q.overall).toBe('low')
    expect(q.recommendation).toBe('request_better_clip')
    expect(cloudTrackUsable(q)).toBe(false)
  })

  it('downgrades to caution when feet are unreliable even with full coverage', () => {
    // Feet visibility low -> footConfidence < 0.5 blocks the "high" grade.
    const q = assessDenseTrackQuality(samples({ count: 100, visibility: 0.3 }), 100)
    expect(q.overall).toBe('medium')
    expect(q.recommendation).toBe('analyze_with_caution')
    expect(q.footConfidence).toBeLessThan(0.5)
  })

  it('reports low bothFighters when one fighter is missing throughout', () => {
    const q = assessDenseTrackQuality(samples({ count: 100, both: false }), 100)
    expect(q.bothFighters).toBe(0)
    expect(q.overall).toBe('medium')
  })

  it('handles an empty track without dividing by zero', () => {
    const q = assessDenseTrackQuality([], 100)
    expect(q.overall).toBe('low')
    expect(q.coverage).toBe(0)
    expect(q.footConfidence).toBe(0)
  })
})

describe('filterFramesByVisibility', () => {
  it('keeps striking frames with visible wrists and drops low-visibility frames', () => {
    const good = {
      tMs: 0,
      actors: {
        A: Array.from({ length: 33 }, (_, i) => ({
          x: 0.5,
          y: 0.5,
          visibility: [15, 16].includes(i) ? 0.9 : 0.5,
        })),
      },
    }
    const bad = {
      tMs: 100,
      actors: {
        A: Array.from({ length: 33 }, (_, i) => ({
          x: 0.5,
          y: 0.5,
          visibility: [15, 16].includes(i) ? 0.1 : 0.5,
        })),
      },
    }
    const out = filterFramesByVisibility([good, bad], {
      discipline: 'boxing',
      focusTarget: 'A',
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.tMs).toBe(0)
  })

  it('uses trunk joints for grappling clips', () => {
    const good = {
      tMs: 0,
      actors: {
        A: Array.from({ length: 33 }, (_, i) => ({
          x: 0.5,
          y: 0.5,
          visibility: [11, 12, 23, 24].includes(i) ? 0.8 : 0.1,
        })),
      },
    }
    const bad = {
      tMs: 100,
      actors: {
        A: Array.from({ length: 33 }, (_, i) => ({
          x: 0.5,
          y: 0.5,
          visibility: [11, 12, 23, 24].includes(i) ? 0.1 : 0.9,
        })),
      },
    }
    const out = filterFramesByVisibility([good, bad], {
      discipline: 'bjj',
      focusTarget: 'both',
    })
    expect(out).toHaveLength(1)
    expect(out[0]?.tMs).toBe(0)
  })
})
