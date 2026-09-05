/**
 * Chat grounding readiness — when VisionEvidence / normalized asset / Files URI
 * already exists, follow-up chat must not force another tape upload.
 */

export type ChatGroundingSources = {
  geminiFileUri?: string | null
  normalizedAssetId?: string | null
  visionEvidence?: unknown | null
  visionFirstEnabled?: boolean
}

/** True when follow-up chat can ground without calling upload_video. */
export function isChatGroundingReady(sources: ChatGroundingSources): boolean {
  if (sources.geminiFileUri && String(sources.geminiFileUri).trim()) return true
  if (sources.normalizedAssetId && String(sources.normalizedAssetId).trim()) return true
  if (sources.visionFirstEnabled && sources.visionEvidence != null) return true
  return false
}

/**
 * Only attempt an inline tape upload when a clip is loaded, grounding is
 * missing, a source file exists, and no upload is already in flight.
 */
export function shouldAttemptTapeUploadForChat(opts: {
  videoLoaded: boolean
  groundingReady: boolean
  hasVideoFile: boolean
  uploading: boolean
}): boolean {
  return Boolean(opts.videoLoaded) && !opts.groundingReady && opts.hasVideoFile && !opts.uploading
}

/**
 * After an inline upload attempt, treat the clip as ready when ANY grounding
 * handle exists — do not require geminiFileUri alone.
 */
export function isPostUploadChatReady(opts: {
  tapeUri?: string | null
  geminiFileUri?: string | null
  normalizedAssetId?: string | null
  visionEvidence?: unknown | null
}): boolean {
  if (opts.tapeUri && String(opts.tapeUri).trim()) return true
  if (opts.geminiFileUri && String(opts.geminiFileUri).trim()) return true
  if (opts.normalizedAssetId && String(opts.normalizedAssetId).trim()) return true
  if (opts.visionEvidence != null) return true
  return false
}

export type ClipFollowUpUsage = {
  used: number
  limit: number
  remaining: number
}

/** Composer label for the per-clip follow-up allowance. */
export function formatClipFollowUpLabel(usage: ClipFollowUpUsage): string {
  const limit = Math.max(0, Number(usage.limit) || 0)
  const used = Math.max(0, Number(usage.used) || 0)
  if (limit <= 0) return ''
  if (used >= limit) return `${limit} of ${limit} follow-ups used`
  return `Follow-up ${used + 1} of ${limit}`
}

export function clipFollowUpsExhausted(usage: ClipFollowUpUsage | null | undefined): boolean {
  if (!usage) return false
  return usage.remaining <= 0 || usage.used >= usage.limit
}
