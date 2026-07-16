/**
 * Client-side video trimming. When a clip is longer than the user's tier limit,
 * we let them pick a window (<= maxSec) and re-encode just that segment in the
 * browser, so the file that reaches the pipeline already fits the limit.
 *
 * The window math (defaultTrimWindow / clampTrimWindow) is pure and unit-tested.
 * trimVideoFile does the DOM/MediaRecorder work and only runs in the browser.
 */

/** Shortest selectable window. */
export const MIN_TRIM_SEC = 1
/** Start every phone upload with a small, reliable review artifact. */
export const DEFAULT_UPLOAD_TRIM_SEC = 10
export const MIN_TRIM_DURATION_TOLERANCE_SEC = 0.75
export const TRIM_DURATION_TOLERANCE_FRACTION = 0.1

export type TrimWindow = { start: number; end: number }

/** Encoder/container timestamps may drift slightly without changing the clip. */
export function trimDurationToleranceSec(expectedDurationSec: number): number {
  const expected = Number.isFinite(expectedDurationSec) && expectedDurationSec > 0
    ? expectedDurationSec
    : 0
  return Math.max(MIN_TRIM_DURATION_TOLERANCE_SEC, expected * TRIM_DURATION_TOLERANCE_FRACTION)
}

/** True only when an encoded artifact is close enough to the selected interval. */
export function isTrimDurationAcceptable(actualDurationSec: number, expectedDurationSec: number): boolean {
  if (!Number.isFinite(actualDurationSec) || actualDurationSec <= 0) return false
  if (!Number.isFinite(expectedDurationSec) || expectedDurationSec <= 0) return false
  return Math.abs(actualDurationSec - expectedDurationSec) <= trimDurationToleranceSec(expectedDurationSec)
}

/** Trimming must capture source time, never a slow-motion or accelerated replay. */
export function forceNormalPlaybackRate(
  media: Pick<HTMLMediaElement, 'defaultPlaybackRate' | 'playbackRate'>,
): void {
  media.defaultPlaybackRate = 1
  media.playbackRate = 1
}

/** Initial selection: from 0, as long as the limit (or the clip) allows. */
export function defaultTrimWindow(durationSec: number, maxSec: number): TrimWindow {
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  const cap = Math.max(MIN_TRIM_SEC, Math.min(maxSec, dur || maxSec))
  return { start: 0, end: cap }
}

/**
 * Paid/admin tiers may expand the handles to their entitlement, but a fresh
 * phone upload starts at ten seconds so it never silently sends a multi-minute
 * original just because the account has a large analysis allowance.
 */
export function defaultUploadTrimWindow(durationSec: number, tierMaxSec: number): TrimWindow {
  return defaultTrimWindow(durationSec, Math.min(tierMaxSec, DEFAULT_UPLOAD_TRIM_SEC))
}

/**
 * Keep a window valid as the user drags handles: inside [0, duration], at least
 * MIN_TRIM_SEC long, and never longer than maxSec. `anchor` says which handle
 * the user moved so the other one yields.
 */
export function clampTrimWindow(
  start: number,
  end: number,
  durationSec: number,
  maxSec: number,
  anchor: 'start' | 'end' = 'end',
): TrimWindow {
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  const cap = Math.max(MIN_TRIM_SEC, Math.min(maxSec, dur || maxSec))

  let s = Math.min(Math.max(0, start), dur)
  let e = Math.min(Math.max(0, end), dur)

  if (e < s) [s, e] = [e, s]
  if (e - s < MIN_TRIM_SEC) {
    if (anchor === 'start') e = Math.min(dur, s + MIN_TRIM_SEC)
    else s = Math.max(0, e - MIN_TRIM_SEC)
  }

  if (e - s > cap) {
    // Window exceeds the limit — pull the handle the user did NOT move.
    if (anchor === 'start') e = s + cap
    else s = e - cap
  }

  // Final safety: keep inside bounds.
  if (s < 0) { s = 0; e = Math.min(dur, cap) }
  if (e > dur && dur > 0) { e = dur; s = Math.max(0, e - cap) }

  return { start: s, end: e }
}

/** Read a video file's duration (seconds) without rendering it. */
export function probeVideoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve(0)
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    const cleanup = () => URL.revokeObjectURL(url)
    video.onloadedmetadata = () => {
      const d = video.duration
      if (d === Infinity) {
        // Recorded WebM (e.g. phone screen/camera capture) reports Infinity
        // until seeked — resolve the real length instead of returning 0,
        // which would silently skip the tier-limit trimmer.
        void resolveVideoDuration(video).then((fixed) => {
          cleanup()
          resolve(fixed)
        })
        return
      }
      cleanup()
      resolve(Number.isFinite(d) && d > 0 ? d : 0)
    }
    video.onerror = () => {
      cleanup()
      resolve(0)
    }
    video.src = url
  })
}

/**
 * Recording formats to attempt, best first: preferred container, then the
 * other family as a retry when the first output fails playability validation
 * (e.g. Chrome producing a WebM the decoder then refuses).
 */
const trimMimeCandidates = (): Array<string | undefined> => {
  if (typeof MediaRecorder === 'undefined') return [undefined]
  const mp4 = ['video/mp4;codecs=avc1', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t))
  const webm = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
    MediaRecorder.isTypeSupported(t),
  )
  const list = [mp4, webm].filter((t): t is string => Boolean(t))
  return list.length > 0 ? list : [undefined]
}

const once = (el: HTMLMediaElement, event: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const ok = () => { cleanup(); resolve() }
    const err = () => { cleanup(); reject(new Error(`video ${event} failed`)) }
    const cleanup = () => {
      el.removeEventListener(event, ok)
      el.removeEventListener('error', err)
    }
    el.addEventListener(event, ok, { once: true })
    el.addEventListener('error', err, { once: true })
  })

/**
 * Seek that survives mobile quirks: some phone browsers never fire 'seeked'
 * on blob sources, or fire 'error' when the hardware decoder is briefly
 * contended. Falls back to polling the position before giving up.
 */
const seekTo = (video: HTMLVideoElement, t: number, timeoutMs = 6000): Promise<void> =>
  new Promise((resolve, reject) => {
    let done = false
    const finish = (err?: Error) => {
      if (done) return
      done = true
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      clearInterval(poll)
      clearTimeout(timer)
      if (err) reject(err)
      else resolve()
    }
    const onSeeked = () => finish()
    const onError = () => {
      const code = video.error?.code
      finish(new Error(`the phone could not decode this clip while seeking (media error ${code ?? 'unknown'}). Close other video apps/tabs and retry, or use MP4 (H.264).`))
    }
    // Fallback: if the element reports it's at the target with decodable data,
    // treat the seek as done even without a 'seeked' event.
    const poll = setInterval(() => {
      if (!video.seeking && video.readyState >= 2 && Math.abs(video.currentTime - t) < 0.5) finish()
    }, 200)
    const timer = setTimeout(() => {
      finish(new Error('seeking this clip timed out — try MP4 (H.264) or a shorter clip.'))
    }, timeoutMs)
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    try {
      video.currentTime = t
    } catch {
      // Setting currentTime threw — let the poll/timeout decide.
    }
  })

/**
 * Resolve an element's duration, working around the Chrome MediaRecorder bug
 * where recorded WebM reports duration=Infinity until seeked far forward.
 * Resolves the real duration (element is seeked back to 0), or 0 on failure.
 */
export function resolveVideoDuration(video: HTMLVideoElement, timeoutMs = 4000): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return Promise.resolve(video.duration)
  if (video.duration !== Infinity) return Promise.resolve(0)
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      video.removeEventListener('durationchange', onChange)
      clearTimeout(timer)
      try { video.currentTime = 0 } catch { void 0 }
      resolve(Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0)
    }
    const onChange = () => {
      if (Number.isFinite(video.duration)) finish()
    }
    const timer = setTimeout(finish, timeoutMs)
    video.addEventListener('durationchange', onChange)
    try {
      video.currentTime = Number.MAX_SAFE_INTEGER
    } catch {
      finish()
    }
  })
}

/** Below this the recorder produced no real frames (empty-chunk output). */
const MIN_TRIM_OUTPUT_BYTES = 8 * 1024

export type TrimValidation = {
  ok: boolean
  width: number
  height: number
  durationSec: number
  reason?: string
}

/**
 * Prove a trimmed File is actually playable before anyone treats it as Ready:
 * metadata loads, picture dimensions are non-zero, and duration resolves.
 */
export async function validateTrimmedVideo(
  file: File,
  expectedDurationSec?: number,
): Promise<TrimValidation> {
  if (typeof document === 'undefined') return { ok: true, width: 0, height: 0, durationSec: 0 }
  if (file.size < MIN_TRIM_OUTPUT_BYTES) {
    return { ok: false, width: 0, height: 0, durationSec: 0, reason: 'the trimmed file came out empty' }
  }
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.preload = 'metadata'
  video.muted = true
  try {
    video.src = url
    await once(video, 'loadedmetadata')
    const durationSec = await resolveVideoDuration(video)
    const width = video.videoWidth
    const height = video.videoHeight
    if (width <= 0 || height <= 0) {
      return { ok: false, width, height, durationSec, reason: 'the trimmed video has no picture' }
    }
    if (durationSec <= 0.5) {
      return { ok: false, width, height, durationSec, reason: 'the trimmed video has no readable duration' }
    }
    if (
      Number(expectedDurationSec) > 0 &&
      !isTrimDurationAcceptable(durationSec, Number(expectedDurationSec))
    ) {
      const tolerance = trimDurationToleranceSec(Number(expectedDurationSec))
      return {
        ok: false,
        width,
        height,
        durationSec,
        reason: `the trimmed duration (${durationSec.toFixed(2)}s) does not match the selected interval (${Number(expectedDurationSec).toFixed(2)}s; allowed drift ${tolerance.toFixed(2)}s)`,
      }
    }
    return { ok: true, width, height, durationSec }
  } catch {
    return { ok: false, width: 0, height: 0, durationSec: 0, reason: 'the browser could not decode the trimmed file' }
  } finally {
    video.removeAttribute('src')
    try { video.load() } catch { void 0 }
    URL.revokeObjectURL(url)
  }
}

/** One MediaRecorder capture pass of [startSec, endSec] in the given format. */
async function recordSegment(
  file: File,
  startSec: number,
  endSec: number,
  mimeType: string | undefined,
  onProgress?: (fraction: number) => void,
): Promise<File> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  forceNormalPlaybackRate(video)

  try {
    await once(video, 'loadedmetadata')

    const capture = (video as HTMLVideoElement & {
      captureStream?: () => MediaStream
      mozCaptureStream?: () => MediaStream
    })
    const stream = capture.captureStream
      ? capture.captureStream()
      : capture.mozCaptureStream
        ? capture.mozCaptureStream()
        : null
    if (!stream) throw new Error('This browser cannot capture video for trimming.')

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: BlobPart[] = []
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })

    await seekTo(video, Math.max(0, startSec))
    forceNormalPlaybackRate(video)

    recorder.start(100)
    forceNormalPlaybackRate(video)
    await video.play()

    await new Promise<void>((resolve) => {
      const tick = () => {
        if (video.currentTime >= endSec || video.ended) return resolve()
        onProgress?.(Math.min(1, (video.currentTime - startSec) / Math.max(0.001, endSec - startSec)))
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })

    video.pause()
    recorder.stop()
    await stopped

    const outType = mimeType || 'video/webm'
    const ext = outType.includes('mp4') ? 'mp4' : 'webm'
    const base = file.name.replace(/\.[^.]+$/, '') || 'clip'
    const blob = new Blob(chunks, { type: outType })
    return new File([blob], `${base}-trim.${ext}`, { type: outType })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Record [startSec, endSec] by playing it on the caller's VISIBLE video
 * element and painting each frame to a canvas that MediaRecorder captures.
 *
 * Why not a hidden element + element captureStream (recordSegment above)?
 * Android Chrome stops decoding video that isn't composited on screen (the
 * recorder then gets ZERO frames → empty file), and phones refuse a second
 * hardware-decoder session on the same source (→ MEDIA_ERR_DECODE). Reusing
 * the on-screen preview keeps the one decoder that already works, and canvas
 * capture doesn't depend on element compositing.
 */
async function recordSegmentFromHost(
  video: HTMLVideoElement,
  file: File,
  startSec: number,
  endSec: number,
  mimeType: string | undefined,
  onProgress?: (fraction: number) => void,
): Promise<File> {
  // Fail fast on an already-dead element: its 'error' event fired in the past,
  // so waiting for 'loadedmetadata' would hang forever.
  if (video.error) {
    throw new Error(`the preview failed to load (media error ${video.error.code}) — reopen the trimmer and retry`)
  }
  if (video.readyState < HTMLMediaElement.HAVE_METADATA) await once(video, 'loadedmetadata')
  forceNormalPlaybackRate(video)
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) throw new Error('the preview has no picture to record')

  // Cap the encode resolution: phone encoders handle 720p-class output far
  // more reliably than 4K, and pose tracking / AI analysis don't need more.
  const MAX_DIM = 1280
  const scale = Math.min(1, MAX_DIM / Math.max(vw, vh))
  const cw = Math.max(2, Math.round((vw * scale) / 2) * 2)
  const ch = Math.max(2, Math.round((vh * scale) / 2) * 2)

  const canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas rendering is unavailable in this browser')

  const stream = canvas.captureStream(30)
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
  const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })

  await seekTo(video, Math.max(0, startSec))
  forceNormalPlaybackRate(video)
  // Paint the first frame before start() so no chunk is ever empty.
  try { ctx.drawImage(video, 0, 0, cw, ch) } catch { void 0 }

  const vfcVideo = video as HTMLVideoElement & {
    requestVideoFrameCallback?: (cb: () => void) => number
    cancelVideoFrameCallback?: (id: number) => void
  }
  const useVfc = typeof vfcVideo.requestVideoFrameCallback === 'function'
  let frameCbId: number | null = null

  recorder.start(100)
  try {
    forceNormalPlaybackRate(video)
    await video.play()
  } catch {
    recorder.stop()
    await stopped
    throw new Error('the browser blocked playback during trimming — tap the video once, then retry')
  }

  try {
    await new Promise<void>((resolve, reject) => {
      // Watchdog: if playback stalls (decode starvation, app backgrounded)
      // fail loudly instead of hanging on a silent recorder forever.
      let lastT = video.currentTime
      let stalledChecks = 0
      const watchdog = setInterval(() => {
        // Also the completion backstop: frame callbacks can starve while the
        // video keeps playing (headless, decoder hiccups) — finish here too.
        if (video.ended || video.currentTime >= endSec) {
          cleanup()
          return resolve()
        }
        if (video.currentTime <= lastT + 0.05) {
          stalledChecks++
          if (stalledChecks >= 5) {
            cleanup()
            reject(new Error('playback stalled while trimming — keep the app in the foreground and retry'))
          }
        } else {
          stalledChecks = 0
        }
        lastT = video.currentTime
      }, 2000)
      const cleanup = () => {
        clearInterval(watchdog)
        if (frameCbId != null && useVfc && vfcVideo.cancelVideoFrameCallback) {
          vfcVideo.cancelVideoFrameCallback(frameCbId)
        }
      }
      const step = () => {
        if (video.currentTime >= endSec || video.ended) {
          cleanup()
          return resolve()
        }
        try { ctx.drawImage(video, 0, 0, cw, ch) } catch { void 0 }
        onProgress?.(Math.min(1, (video.currentTime - startSec) / Math.max(0.001, endSec - startSec)))
        schedule()
      }
      const schedule = () => {
        if (useVfc && vfcVideo.requestVideoFrameCallback) frameCbId = vfcVideo.requestVideoFrameCallback(step)
        else requestAnimationFrame(step)
      }
      schedule()
    })
  } finally {
    try { video.pause() } catch { void 0 }
  }

  recorder.stop()
  await stopped

  const outType = mimeType || 'video/webm'
  const ext = outType.includes('mp4') ? 'mp4' : 'webm'
  const base = file.name.replace(/\.[^.]+$/, '') || 'clip'
  const blob = new Blob(chunks, { type: outType })
  return new File([blob], `${base}-trim.${ext}`, { type: outType })
}

/**
 * Re-encode [startSec, endSec] of `file` to a new File by playing that segment
 * and capturing it via MediaRecorder. Runs at ~real time. Every output is
 * validated for playability; on an unplayable result the other container
 * family is tried once before rejecting, so a broken file can never be
 * confirmed as the clip to analyze.
 *
 * Pass `opts.hostVideo` (the trimmer dialog's on-screen player, already loaded
 * with this file) — required for phones, where hidden-element capture yields
 * empty output. Without it, the legacy hidden-element path is used.
 */
export async function trimVideoFile(
  file: File,
  startSec: number,
  endSec: number,
  onProgress?: (fraction: number) => void,
  opts?: {
    hostVideo?: HTMLVideoElement | null
    onValidated?: (validation: TrimValidation) => void
  },
): Promise<File> {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    throw new Error('Video trimming is not supported in this browser.')
  }

  const host = opts?.hostVideo ?? null
  let lastReason = ''
  for (const mimeType of trimMimeCandidates()) {
    const out = host
      ? await recordSegmentFromHost(host, file, startSec, endSec, mimeType, onProgress)
      : await recordSegment(file, startSec, endSec, mimeType, onProgress)
    const expectedDurationSec = Math.max(0, endSec - startSec)
    const check = await validateTrimmedVideo(out, expectedDurationSec)
    if (check.ok) {
      opts?.onValidated?.(check)
      onProgress?.(1)
      return out
    }
    lastReason = check.reason ?? 'unplayable output'
    console.warn(`[trim] ${mimeType || 'default'} output failed validation (${lastReason}) — retrying alternate format`)
  }
  throw new Error(
    `Trim failed — ${lastReason || 'the re-encoded clip was unplayable'}. Try a shorter selection or a different source format (MP4/H.264 works best).`,
  )
}
