import { describe, it, expect } from 'vitest'
import { suggestFighters, pickByClick, scoreFighters, boxArea, type Candidate } from './fighterSelection'

const mk = (cx: number, cy: number, w: number, h: number, motion?: number): Candidate => ({
  box: { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 },
  center: { x: cx, y: cy },
  motion,
})

describe('fighterSelection', () => {
  it('picks the 2 big central movers over tiny background bystanders (clip3 case)', () => {
    const cands = [
      mk(0.4, 0.5, 0.25, 0.5, 0.03), // big central fighter
      mk(0.6, 0.5, 0.25, 0.5, 0.03), // big central fighter
      mk(0.05, 0.1, 0.05, 0.1, 0.0), // tiny corner bystander
      mk(0.95, 0.12, 0.04, 0.08, 0.0), // tiny corner bystander
      mk(0.5, 0.05, 0.06, 0.12, 0.0), // small background person
    ]
    expect(suggestFighters(cands).sort((a, b) => a - b)).toEqual([0, 1])
  })

  it('returns all candidates when there are 2 or fewer', () => {
    expect(suggestFighters([mk(0.5, 0.5, 0.2, 0.4)]).length).toBe(1)
    expect(suggestFighters([mk(0.3, 0.5, 0.2, 0.4), mk(0.7, 0.5, 0.2, 0.4)]).length).toBe(2)
  })

  it('prefers the more central of two equal-size bodies', () => {
    const cands = [
      mk(0.5, 0.5, 0.2, 0.4), // dead center
      mk(0.5, 0.5, 0.2, 0.4), // dead center (same)
      mk(0.9, 0.5, 0.2, 0.4), // edge
    ]
    const picks = suggestFighters(cands)
    expect(picks).not.toContain(2)
  })

  it('pickByClick maps a tap to the nearest person and rejects empty-floor taps', () => {
    const cands = [mk(0.3, 0.5, 0.2, 0.4), mk(0.7, 0.5, 0.2, 0.4)]
    expect(pickByClick(cands, { x: 0.72, y: 0.5 })).toBe(1)
    expect(pickByClick(cands, { x: 0.28, y: 0.5 })).toBe(0)
    expect(pickByClick(cands, { x: 0.1, y: 0.1 })).toBe(-1) // too far from anyone
  })

  it('scoreFighters ranks larger bodies higher, all scores finite', () => {
    const cands = [mk(0.5, 0.5, 0.3, 0.6), mk(0.5, 0.5, 0.1, 0.2)]
    const scored = scoreFighters(cands)
    expect(scored[0].score).toBeGreaterThan(scored[1].score)
    expect(scored.every((s) => Number.isFinite(s.score))).toBe(true)
  })

  it('boxArea is zero for a degenerate box', () => {
    expect(boxArea({ left: 0.5, top: 0.5, right: 0.5, bottom: 0.5 })).toBe(0)
  })
})
