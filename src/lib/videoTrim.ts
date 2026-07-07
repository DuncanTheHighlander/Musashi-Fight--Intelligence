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

export type TrimWindow = { start: number; end: number }

/** Initial selection: from 0, as long as the limit (or the clip) allows. */
export function defaultTrimWindow(durationSec: number, maxSec: number): TrimWindow {
  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0
  const cap = Math.max(MIN_TRIM_SEC, Math.min(maxSec, dur || maxSec))
  return { start: 0, end: cap }
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

const pickMimeType = (): string | undefined => {
  if (typeof MediaRecorder === 'undefined') return undefined
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ]
  return candidates.find((t) => MediaRecorder.isTypeSupported(t))
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
 * Re-encode [startSec, endSec] of `file` to a new File by playing that segment
 * and capturing it via MediaRecorder. Runs at ~real time. Rejects if the
 * browser can't capture the stream.
 */
export async function trimVideoFile(
  file: File,
  startSec: number,
  endSec: number,
  onProgress?: (fraction: number) => void,
): Promise<File> {
  if (typeof window === 'undefined' || typeof MediaRecorder === 'undefined') {
    throw new Error('Video trimming is not supported in this browser.')
  }

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.src = url
  video.muted = true
  video.playsInline = true

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

    const mimeType = pickMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    const chunks: BlobPart[] = []
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data) }
    const stopped = new Promise<void>((resolve) => { recorder.onstop = () => resolve() })

    video.currentTime = Math.max(0, startSec)
    await once(video, 'seeked')

    recorder.start(100)
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
    onProgress?.(1)

    const outType = mimeType || 'video/webm'
    const ext = outType.includes('mp4') ? 'mp4' : 'webm'
    const base = file.name.replace(/\.[^.]+$/, '') || 'clip'
    const blob = new Blob(chunks, { type: outType })
    return new File([blob], `${base}-trim.${ext}`, { type: outType })
  } finally {
    URL.revokeObjectURL(url)
  }
}
