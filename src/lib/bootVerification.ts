/**
 * Boot pipeline verification — pure helpers + summary strings for UI / logging.
 */

export type MediaPreloadOutcome = 'buffered' | 'timeout' | 'cancelled'

export function mediaBufferedEnough(video: HTMLVideoElement): boolean {
  const dur = video.duration
  if (!Number.isFinite(dur) || dur <= 0) return false
  const br = video.buffered
  if (br.length === 0) return false
  const end = br.end(br.length - 1)
  return end >= dur - 0.4 || end / dur >= 0.96
}

/**
 * Wait until enough media is buffered, or timeout / cancel.
 * Browser-only (uses HTMLMediaElement events).
 */
export async function waitForMediaPreloaded(
  video: HTMLVideoElement,
  isCancelled: () => boolean
): Promise<MediaPreloadOutcome> {
  if (isCancelled()) return 'cancelled'
  if (mediaBufferedEnough(video)) return 'buffered'

  return new Promise((resolve) => {
    let settled = false
    const finish = (outcome: MediaPreloadOutcome) => {
      if (settled) return
      settled = true
      cleanup()
      resolve(outcome)
    }
    const cleanup = () => {
      window.clearTimeout(tid)
      video.removeEventListener('canplaythrough', onThrough)
      video.removeEventListener('progress', onProgress)
      video.removeEventListener('loadeddata', onProgress)
    }
    const onThrough = () => finish('buffered')
    const onProgress = () => {
      if (isCancelled()) {
        finish('cancelled')
        return
      }
      if (mediaBufferedEnough(video)) finish('buffered')
    }
    const tid = window.setTimeout(() => finish('timeout'), 180_000)
    video.addEventListener('canplaythrough', onThrough, { once: true })
    video.addEventListener('progress', onProgress)
    video.addEventListener('loadeddata', onProgress)
    queueMicrotask(onProgress)
    requestAnimationFrame(onProgress)
  })
}

export type BootVerificationInput = {
  media: MediaPreloadOutcome
  lastPassTotalSteps: number
  lastPassFramesCompleted: number
}

export type BootVerificationResult = {
  ok: boolean
  summary: string
  warnings: string[]
}

export function verifyBootReadiness(v: BootVerificationInput): BootVerificationResult {
  const warnings: string[] = []

  if (v.media === 'timeout') {
    warnings.push('Buffer did not fully confirm before timeout (playback may still stutter).')
  }
  if (v.media === 'cancelled') {
    warnings.push('Buffer wait cancelled.')
  }

  let critical = false

  if (v.lastPassTotalSteps > 0 && v.lastPassFramesCompleted < v.lastPassTotalSteps) {
    warnings.push(
      `Keyframe pre-scan incomplete: ${v.lastPassFramesCompleted}/${v.lastPassTotalSteps} frames.`
    )
    critical = true
  }

  const parts: string[] = []
  parts.push(v.media === 'buffered' ? 'Buffer OK' : v.media === 'timeout' ? 'Buffer: timeout' : 'Buffer: cancelled')
  // The sparse ~24-frame keyframe bootstrap count is intentionally NOT shown here
  // — it was misread as the deep-load coverage. The real per-frame deep-track
  // count ("Deep track N frames") is appended by the caller. An incomplete
  // bootstrap still surfaces via the warning above.

  return { ok: !critical, summary: parts.join(' · '), warnings }
}
