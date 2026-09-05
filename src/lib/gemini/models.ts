/**
 * Gemini Model Configuration — Single Source of Truth
 *
 * All Gemini model references across the codebase should pull from here
 * (or from env vars that override these defaults).
 *
 * Verified against https://ai.google.dev/gemini-api/docs/models (2026-07-23):
 *   Production default        : gemini-3.6-flash   (STABLE, GA 2026-07-21)
 *   Embedding (text + video)  : gemini-embedding-2-preview
 *
 * POLICY: production defaults must be STABLE model ids — never a "-preview"
 * suffix and never a "-latest" alias. Preview models may only be selected
 * explicitly via env override for experiments.
 *
 * Override any of these via .env.local / Worker vars:
 *   GEMINI_MODEL=<primary vision + coaching model>
 *   GEMINI_FLASH_MODEL=<fast-path model>
 *   GEMINI_EMBED_MODEL=<embedding model>
 *   GEMINI_BURST_MODEL / GEMINI_STRATEGY_MODEL / GEMINI_REFLEX_MODEL / GEMINI_TRACK_MODEL
 */

// ---------------------------------------------------------------------------
// Stable fallbacks — used when the matching env var is not set
// ---------------------------------------------------------------------------

/** Primary model: vision evidence pass + coaching pass (stable, GA). */
export const GEMINI_MODEL_DEFAULT = 'gemini-3.6-flash'

/** Flash model — fast path, real-time loops, scan passes (same stable model). */
export const GEMINI_FLASH_MODEL_DEFAULT = 'gemini-3.6-flash'

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

  /** Vision evidence pass (Pass 1 — the single full-video call). */
  vision: (): string =>
    process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT,

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

/**
 * Gemini 3.x generation-parameter policy (official guidance, verified
 * 2026-07-23 at https://ai.google.dev/gemini-api/docs/gemini-3):
 * "For all Gemini 3 models, we strongly recommend keeping the temperature
 * parameter at its default value of 1.0." topK/topP are likewise left at
 * server defaults. Callers must NOT set temperature/topP/topK on 3.x models.
 */
export function isGemini3Model(model: string): boolean {
  return /gemini-3/i.test(model)
}
