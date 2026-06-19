export const FIGHTLANG_DEFAULTS = {
  /** When available, prefer BW units. For stance width, below this is "narrow". */
  stanceWidthMinBw: 0.35,
  /**
   * Fallback narrow stance threshold in normalized coords (used when BW scaling
   * is unavailable due to missing shoulders).
   */
  stanceWidthMinNormalized: 0.08,

  /** Stance heuristic thresholds (degrees) based on yaw proxy. MVP only. */
  bladedness: {
    squareMaxDeg: 20,
    bladedMinDeg: 50,
  },
} as const

