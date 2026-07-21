/**
 * Gemini video parts — Files API URI or inline bytes — with sport-aware FPS
 * and optional analysis window (startOffset/endOffset).
 *
 * IMPORTANT: Do NOT put mediaResolution on Part objects for v1beta
 * generateContent. Per-part media_resolution is experimental (v1alpha) and
 * sending a bare enum string 400s with:
 *   Invalid value at 'contents[N].parts[N].media_resolution' … "MEDIA_RESOLUTION_LOW"
 * Use generationConfig.mediaResolution via `GEMINI_MEDIA_RESOLUTION_LOW` instead.
 */

import { isVisionFirstSport } from '@/lib/coachBrain/coachBrain'

/** Match marketplace analysis_clip / job video cap — phone 1080p/4K clips routinely exceed 100MB. */
export const MAX_ORIGINAL_UPLOAD_BYTES = 500 * 1024 * 1024
export const MAX_ORIGINAL_UPLOAD_LABEL = '500 MB'

/**
 * Inline-bytes fast path: skip Gemini Files API ACTIVE polling when the
 * normalized analysis artifact is under this size. Trimmer targets 720p/30fps
 * so a ≤30s window stays well under this ceiling.
 */
export const MAX_INLINE_VIDEO_BYTES = 20 * 1024 * 1024
export const MAX_INLINE_VIDEO_LABEL = '20 MB'

/** Striking sports sample denser; grappling (vision-first) uses fewer frames. */
export const GEMINI_FPS_STRIKING = 10
export const GEMINI_FPS_GRAPPLING = 5

/** Safe for generationConfig.mediaResolution on v1beta (string enum). */
export const GEMINI_MEDIA_RESOLUTION_LOW = 'MEDIA_RESOLUTION_LOW' as const

export type VideoClipWindow = {
  startSec?: number | null
  endSec?: number | null
}

export type GeminiVideoPartOptions = {
  window?: VideoClipWindow | null
  /** User-selected sport — drives fps (striking 10 / grappling 5). */
  sport?: string | null
  /** Explicit fps override; wins over sport default when finite. */
  fps?: number | null
  /**
   * @deprecated Ignored on Part builders — set generationConfig.mediaResolution
   * with GEMINI_MEDIA_RESOLUTION_LOW instead. Kept so call sites compile.
   */
  mediaResolution?: 'low' | 'medium' | 'high' | 'MEDIA_RESOLUTION_LOW' | 'MEDIA_RESOLUTION_MEDIUM' | 'MEDIA_RESOLUTION_HIGH'
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

/** True when bytes may be sent as Gemini inlineData (skip Files ACTIVE wait). */
export function isInlineVideoEligible(sizeBytes: number): boolean {
  return Number.isFinite(sizeBytes) && sizeBytes > 0 && sizeBytes < MAX_INLINE_VIDEO_BYTES
}

/**
 * Dynamic FPS for Gemini videoMetadata:
 * - Grappling / vision-first (BJJ, wrestling, judo): 5
 * - Striking + hybrid (boxing, kickboxing, Muay Thai, karate, TKD, MMA, …): 10
 */
export function geminiVideoFpsForSport(sport?: string | null): number {
  return isVisionFirstSport(sport) ? GEMINI_FPS_GRAPPLING : GEMINI_FPS_STRIKING
}

export function buildGeminiVideoMetadata(
  opts?: GeminiVideoPartOptions | null,
): Record<string, unknown> | undefined {
  const w = normalizeClipWindow(opts?.window?.startSec, opts?.window?.endSec)
  const fpsRaw = opts?.fps
  const fps =
    Number.isFinite(Number(fpsRaw)) && Number(fpsRaw) > 0
      ? Number(fpsRaw)
      : geminiVideoFpsForSport(opts?.sport)
  const meta: Record<string, unknown> = { fps }
  if (w) {
    meta.startOffset = `${w.startSec}s`
    meta.endOffset = `${w.endSec}s`
  }
  return meta
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

/**
 * Gemini Files API part. videoMetadata lives on the Part (alongside fileData).
 * mediaResolution is intentionally omitted — use generationConfig instead.
 */
export function buildGeminiVideoFilePart(
  fileUri: string,
  mimeType = 'video/mp4',
  windowOrOpts?: VideoClipWindow | null | GeminiVideoPartOptions,
) {
  const opts: GeminiVideoPartOptions =
    windowOrOpts && typeof windowOrOpts === 'object' && ('window' in windowOrOpts || 'sport' in windowOrOpts || 'fps' in windowOrOpts || 'mediaResolution' in windowOrOpts)
      ? (windowOrOpts as GeminiVideoPartOptions)
      : { window: windowOrOpts as VideoClipWindow | null | undefined }

  const videoMetadata = buildGeminiVideoMetadata(opts)
  return {
    fileData: buildGeminiVideoFileData(fileUri, mimeType),
    ...(videoMetadata ? { videoMetadata } : {}),
  }
}

/** Inline-bytes part for the first Coach Cards / chat pass when file < 20MB. */
export function buildGeminiVideoInlinePart(
  base64Data: string,
  mimeType = 'video/mp4',
  opts?: GeminiVideoPartOptions | null,
) {
  const videoMetadata = buildGeminiVideoMetadata(opts ?? undefined)
  return {
    inlineData: {
      mimeType: mimeType || 'video/mp4',
      data: base64Data,
    },
    ...(videoMetadata ? { videoMetadata } : {}),
  }
}
