/**
 * Gemini Model Configuration — Single Source of Truth
 *
 * All Gemini model references across the codebase should pull from here
 * (or from env vars that override these defaults).
 *
 * Verified model names as of March 2026:
 *   Deep analysis / reasoning : gemini-3.1-pro-preview
 *   Fast / flash               : gemini-2.5-flash
 *   Embedding (text + video)   : gemini-embedding-2-preview
 *
 * Override any of these via .env.local:
 *   GEMINI_MODEL=<your-pro-model>
 *   GEMINI_FLASH_MODEL=<your-flash-model>
 *   GEMINI_EMBED_MODEL=<your-embed-model>
 *   GEMINI_BURST_MODEL=<model for burst biomechanics>
 *   GEMINI_STRATEGY_MODEL=<model for strategy analysis>
 *   GEMINI_REFLEX_MODEL=<model for real-time reflex loop>
 *   GEMINI_TRACK_MODEL=<model for pose tracking assist>
 */

// ---------------------------------------------------------------------------
// Stable fallbacks — used when the matching env var is not set
// ---------------------------------------------------------------------------

/** Full deep-analysis model (coaching, strategy, ledger grounding). */
export const GEMINI_MODEL_DEFAULT = 'gemini-3.1-pro-preview'

/** Flash model — fast path, real-time loops, scan passes. */
export const GEMINI_FLASH_MODEL_DEFAULT = 'gemini-2.5-flash'

/** Embedding model — text + video unified embedding. */
export const GEMINI_EMBED_MODEL_DEFAULT = 'gemini-embedding-2-preview'

// ---------------------------------------------------------------------------
// Resolved model IDs (env-override → fallback)
// ---------------------------------------------------------------------------

export const resolvedModels = {
  /** Primary deep analysis / coaching model */
  pro: (): string =>
    process.env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT,

  /** Flash / fast path model */
  flash: (): string =>
    process.env.GEMINI_FLASH_MODEL || GEMINI_FLASH_MODEL_DEFAULT,

  /** Burst biomechanics model */
  burst: (): string =>
    process.env.GEMINI_BURST_MODEL || process.env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT,

  /** Strategy / long-form analysis model */
  strategy: (): string =>
    process.env.GEMINI_STRATEGY_MODEL || process.env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT,

  /** Real-time reflex loop model */
  reflex: (): string =>
    process.env.GEMINI_REFLEX_MODEL || process.env.GEMINI_FLASH_MODEL || GEMINI_FLASH_MODEL_DEFAULT,

  /** Pose tracking assist model */
  track: (): string =>
    process.env.GEMINI_TRACK_MODEL || process.env.GEMINI_FLASH_MODEL || GEMINI_FLASH_MODEL_DEFAULT,

  /** Embedding model */
  embed: (): string =>
    process.env.GEMINI_EMBED_MODEL || GEMINI_EMBED_MODEL_DEFAULT,
} as const
