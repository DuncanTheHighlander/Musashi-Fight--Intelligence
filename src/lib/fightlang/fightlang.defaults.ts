import type { RangeBand } from './fightlang.types'

export const DEFAULT_FIGHTLANG_THRESHOLDS = {
  stance: {
    // Heuristic thresholds; tune with real footage.
    minFootSpreadBw: 0.6,
    maxFootSpreadBw: 1.8,
  },
  range: {
    closeBw: 1.5,
    midBw: 3.0,
  },
  guard: {
    // Wrist above shoulder/chin proxy thresholds in normalized image Y.
    // (Smaller y = higher on screen.)
    handsHighYMargin: 0.02,
    exposureHighScore: 0.6,
  },
  faults: {
    compromisedBaseScoreBw: 0.35,
    overextensionScoreBw: 0.45,
    chinExposedScore: 0.6,
  },
  rhythm: {
    windowMs: 1200,
    minBounces: 2,
    flatCadenceCv: 0.18,
  },
} as const

export function rangeBandFromDistance(distanceBw: number): RangeBand {
  if (!Number.isFinite(distanceBw) || distanceBw <= 0) return 'unknown'
  if (distanceBw < DEFAULT_FIGHTLANG_THRESHOLDS.range.closeBw) return 'close'
  if (distanceBw < DEFAULT_FIGHTLANG_THRESHOLDS.range.midBw) return 'mid'
  return 'long'
}

