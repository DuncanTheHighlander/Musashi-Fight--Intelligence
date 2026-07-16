/**
 * Gemini Files API video parts with optional analysis window.
 * Prefer server-side startOffset/endOffset over client canvas re-encoding.
 */

/** Match marketplace analysis_clip / job video cap — phone 1080p/4K clips routinely exceed 100MB. */
export const MAX_ORIGINAL_UPLOAD_BYTES = 500 * 1024 * 1024
export const MAX_ORIGINAL_UPLOAD_LABEL = '500 MB'

export type VideoClipWindow = {
  startSec?: number | null
  endSec?: number | null
}

export function normalizeClipWindow(
  startSec?: number | null,
  endSec?: number | null,
): { startSec: number; endSec: number } | null {
  const s = Number(startSec)
  const e = Number(endSec)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return null
  return { startSec: Math.max(0, s), endSec: e }
}

/** Selected window length for quota / prompts; falls back to full-file duration. */
export function clipWindowDurationSec(
  startSec?: number | null,
  endSec?: number | null,
  fallbackSec?: number,
): number {
  const w = normalizeClipWindow(startSec, endSec)
  if (w) return Math.max(0, w.endSec - w.startSec)
  const fb = Number(fallbackSec)
  return Number.isFinite(fb) && fb > 0 ? fb : 0
}

/**
 * Quota / credit checks must use the selected analysis window when offsets are
 * present — never the full source-file length after Gemini startOffset/endOffset.
 */
export function resolveQuotaDurationSec(opts: {
  clipDurationSec?: number | null
  startSec?: number | null
  endSec?: number | null
}): number {
  const fromWindow = clipWindowDurationSec(opts.startSec, opts.endSec, 0)
  if (fromWindow > 0) return fromWindow
  const d = Number(opts.clipDurationSec)
  return Number.isFinite(d) && d > 0 ? d : 0
}

export function buildGeminiVideoFileData(
  fileUri: string,
  mimeType = 'video/mp4',
): {
  fileUri: string
  mimeType: string
} {
  return { fileUri, mimeType: mimeType || 'video/mp4' }
}

export function buildGeminiVideoFilePart(
  fileUri: string,
  mimeType = 'video/mp4',
  window?: VideoClipWindow | null,
) {
  const w = normalizeClipWindow(window?.startSec, window?.endSec)
  // Gemini's REST schema puts videoMetadata on the Part, alongside fileData.
  // Nesting it inside fileData produces a 400 "Unknown name videoMetadata"
  // response, which previously broke native-video chat and BJJ Coach Cards.
  return {
    fileData: buildGeminiVideoFileData(fileUri, mimeType),
    ...(w
      ? {
          videoMetadata: {
            startOffset: `${w.startSec}s`,
            endOffset: `${w.endSec}s`,
          },
        }
      : {}),
  }
}
