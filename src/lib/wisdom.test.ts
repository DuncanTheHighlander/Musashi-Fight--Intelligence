import { describe, expect, test } from 'vitest'
import { pickWisdom, WISDOM } from './wisdom'

describe('pickWisdom', () => {
  test('always includes at least one tip', () => {
    for (const sport of [null, 'boxing', 'bjj', 'wrestling', 'fencing']) {
      const playlist = pickWisdom(sport, 0)
      expect(playlist.some((w) => w.kind === 'tip')).toBe(true)
    }
  })

  test('prefers sport-matched lines first for a known sport', () => {
    const playlist = pickWisdom('bjj', 0)
    const firstSportSpecific = playlist.find((w) => w.sports?.length)
    expect(firstSportSpecific).toBeDefined()
    // The first sport-tagged line encountered should be near the front,
    // ahead of at least some general (untagged) lines.
    const idx = playlist.indexOf(firstSportSpecific!)
    const generalCount = playlist.filter((w) => !w.sports?.length).length
    expect(idx).toBeLessThan(playlist.length - generalCount + 1)
  })

  test('an unknown/unset sport still returns a full general playlist', () => {
    const playlist = pickWisdom(null, 0)
    expect(playlist.length).toBeGreaterThan(1)
    expect(playlist.every((w) => !w.sports?.length)).toBe(true)
  })

  test('rotation is stable and wraps for a given seed', () => {
    const a = pickWisdom('boxing', 3)
    const b = pickWisdom('boxing', 3)
    expect(a.map((w) => w.text)).toEqual(b.map((w) => w.text))

    const c = pickWisdom('boxing', 3 + a.length)
    expect(c.map((w) => w.text)).toEqual(a.map((w) => w.text))
  })

  test('does not mutate the source WISDOM array', () => {
    const before = WISDOM.length
    pickWisdom('bjj', 5)
    expect(WISDOM.length).toBe(before)
  })
})
