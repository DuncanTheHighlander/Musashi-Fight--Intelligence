/**
 * Fighter selection — opt-in "which people do we track" helpers.
 *
 * Pure functions only (no side effects, no imports from the render/identity
 * core) so this file is safe to land on its own: until it's wired into the
 * dense-pass seeding it changes nothing. Two jobs:
 *
 *   1. suggestFighters(candidates) — AI-assist. Rank every detected person and
 *      pick the 2 most fighter-like (largest on screen + most central + most
 *      motion), so background bystanders / gym crowd are ignored. This is the
 *      fix for clip3's "10-11 active detections" problem.
 *
 *   2. pickByClick(candidates, point) — map a user tap to the nearest person,
 *      for manual override when the auto-pick is wrong or there are many people.
 *
 * A "candidate" is the minimal info available per detected pose: its normalized
 * visible-landmark bounding box, its torso center, and optional recent motion.
 * The dense-pass seeding (see wiring notes in the setup doc) uses the chosen
 * indices to lock A/B onto those people instead of auto-selecting.
 */

export type SelectBox = { left: number; top: number; right: number; bottom: number }

export type Candidate = {
  box: SelectBox
  /** torso/hip center, normalized 0-1 */
  center: { x: number; y: number }
  /** optional recent motion magnitude (normalized units/frame); higher = more active */
  motion?: number
}

export type FighterScore = {
  index: number
  score: number
  area: number
  centrality: number
  motion: number
}

export function boxArea(b: SelectBox): number {
  return Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top)
}

/**
 * Score every candidate: bigger + more central + more motion = more
 * fighter-like. Size is weighted highest because the two fighters are almost
 * always the largest bodies in frame; centrality and motion break ties and
 * demote stationary background people near the edges.
 */
export function scoreFighters(cands: readonly Candidate[]): FighterScore[] {
  const areas = cands.map((c) => boxArea(c.box))
  const maxArea = Math.max(1e-6, ...areas)
  return cands.map((c, i) => {
    const area = areas[i] / maxArea // 0..1 relative to the biggest body
    const dx = c.center.x - 0.5
    const dy = c.center.y - 0.5
    const centrality = 1 - Math.min(1, Math.hypot(dx, dy) / 0.7) // 1 at center, →0 at corners
    const motion = c.motion != null ? Math.min(1, c.motion / 0.04) : 0.5
    const score = area * 0.5 + centrality * 0.3 + motion * 0.2
    return { index: i, score, area, centrality, motion }
  })
}

/** AI-assist: indices of the 2 likeliest fighters (best first). */
export function suggestFighters(cands: readonly Candidate[]): number[] {
  if (cands.length <= 2) return cands.map((_, i) => i)
  return scoreFighters(cands)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((s) => s.index)
}

/**
 * Map a user tap (normalized coords) to the nearest candidate's center.
 * Returns the index, or -1 if no candidate is within ~half a body of the tap
 * (so a stray tap on empty floor selects nobody).
 */
export function pickByClick(
  cands: readonly Candidate[],
  point: { x: number; y: number },
  maxDist = 0.25
): number {
  let best = -1
  let bestD = Infinity
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i].center
    const d = Math.hypot(c.x - point.x, c.y - point.y)
    if (d < bestD && d < maxDist) {
      bestD = d
      best = i
    }
  }
  return best
}
