/** Shared video tier constants (safe for client + server). */

export const FREE_MAX_VIDEO_SEC = 10
export const PRO_MAX_VIDEO_SEC = 30
export const FREE_LIFETIME_VIDEOS = 3
/** Pro weekly cap — see musashiUsage.ts for COGS rationale. */
export const PRO_WEEKLY_VIDEOS = 10
export const SHOGUN_MAX_VIDEO_SEC = 600

export type VideoDurationCheck = {
  ok: true
} | {
  ok: false
  code: 'VIDEO_DURATION_EXCEEDED'
  maxSec: number
  message: string
}

/** Client-side preflight before upload / native-video AI calls. */
export const checkClipDurationForTier = (
  durationSec: number,
  isPro: boolean,
): VideoDurationCheck => {
  const maxSec = isPro ? PRO_MAX_VIDEO_SEC : FREE_MAX_VIDEO_SEC
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    return { ok: true }
  }
  if (durationSec > maxSec) {
    return {
      ok: false,
      code: 'VIDEO_DURATION_EXCEEDED',
      maxSec,
      message: isPro
        ? `Clip is ${durationSec.toFixed(1)}s — Pro allows up to ${maxSec}s. Trim your clip.`
        : `Clip is ${durationSec.toFixed(1)}s — Free allows up to ${maxSec}s. Trim or upgrade to Pro (30s).`,
    }
  }
  return { ok: true }
}
