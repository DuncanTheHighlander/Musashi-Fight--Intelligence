/**
 * Rotating content for the clip-preparation boot overlay (see
 * docs/LOADING_SCREEN_SPEC.md). Public-domain Five Rings backbone, a few
 * short attributed accents, and fully-owned "get a better read" tips.
 *
 * pickWisdom() is pure: sport-aware ordering, guarantees at least one tip,
 * stable for a given seed. The component owns timing/animation.
 */
import { resolveSportKey, type SportKey } from '@/lib/coachBrain/coachBrain'

export type WisdomLine = {
  text: string
  author?: string
  source?: string
  kind: 'quote' | 'tip'
  /** Preferred sports for this line. Omit for general/any-sport lines. */
  sports?: SportKey[]
}

export const WISDOM: WisdomLine[] = [
  // --- Five Rings backbone (public domain) ---
  { text: 'Today is victory over yourself of yesterday.', author: 'Miyamoto Musashi', source: 'The Book of Five Rings', kind: 'quote' },
  { text: 'Perceive that which cannot be seen with the eye.', author: 'Miyamoto Musashi', source: 'The Book of Five Rings', kind: 'quote' },
  { text: 'You must understand that there is more than one path to the top of the mountain.', author: 'Miyamoto Musashi', source: 'The Book of Five Rings', kind: 'quote' },
  { text: 'Do nothing that is of no use.', author: 'Miyamoto Musashi', source: 'The Book of Five Rings', kind: 'quote' },
  { text: 'The way is in training.', author: 'Miyamoto Musashi', source: 'The Book of Five Rings', kind: 'quote' },
  { text: 'In strategy it is important to see distant things as if they were close and to take a distanced view of close things.', author: 'Miyamoto Musashi', source: 'The Book of Five Rings', kind: 'quote' },
  { text: 'Timing is important in dancing and music, for rhythms are well in accord when the timing is good.', author: 'Miyamoto Musashi', source: 'The Book of Five Rings', kind: 'quote' },

  // --- Attributed accents ---
  { text: 'Absorb what is useful, discard what is not, add what is uniquely your own.', author: 'Bruce Lee', kind: 'quote' },
  { text: 'It’s not the daily increase but daily decrease. Hack away at the unessential.', author: 'Bruce Lee', kind: 'quote' },
  { text: 'The successful man will never be lax, always aware of the danger of getting too comfortable.', author: 'Cus D’Amato', kind: 'quote' },
  { text: 'Fear is the greatest obstacle to learning, but properly understood, it can be an asset.', author: 'Cus D’Amato', kind: 'quote' },

  // --- Sport-specific accents ---
  { text: 'Position before submission.', kind: 'quote', sports: ['bjj_grappling'] },
  { text: 'Control the hips, control the fight.', kind: 'quote', sports: ['bjj_grappling', 'wrestling'] },
  { text: 'The jab is a question. The cross is the answer.', kind: 'quote', sports: ['boxing'] },
  { text: 'Range is the first fight, before any strike lands.', kind: 'quote', sports: ['kickboxing_muay_thai', 'boxing', 'karate'] },

  // --- Fully-owned tips (double as light user education) ---
  { text: 'One clear pair of fighters per clip gets the sharpest read.', kind: 'tip' },
  { text: 'Good light and a steady camera beat 4K resolution every time.', kind: 'tip' },
  { text: 'Trim to the exchange that matters — Musashi reads intent, not runtime.', kind: 'tip' },
  { text: 'A wide, stable angle that keeps both fighters in frame tracks best.', kind: 'tip' },
  { text: 'Picking the right sport at upload routes you to the right coaching brain.', kind: 'tip' },
]

/**
 * Build a rotation playlist for the given sport: sport-matched lines first (in
 * source order), then general lines, guaranteed to include at least one tip,
 * rotated to start at `seed % length` so repeat mounts don't always open on
 * the same line.
 */
export function pickWisdom(sport?: string | null, seed = 0): WisdomLine[] {
  const key: SportKey | null = sport ? resolveSportKey(sport) : null
  const matched = key ? WISDOM.filter((w) => w.sports?.includes(key)) : []
  const general = WISDOM.filter((w) => !w.sports?.length)
  const playlist = [...matched, ...general]

  if (playlist.length === 0) return WISDOM.slice(0, 1)

  if (!playlist.some((w) => w.kind === 'tip')) {
    const anyTip = WISDOM.find((w) => w.kind === 'tip')
    if (anyTip) playlist.push(anyTip)
  }

  const offset = ((seed % playlist.length) + playlist.length) % playlist.length
  return [...playlist.slice(offset), ...playlist.slice(0, offset)]
}
