export type VideoContentRect = {
  left: number
  top: number
  width: number
  height: number
  canvasWidth: number
  canvasHeight: number
}

/**
 * Height of the browser's native `<video controls>` strip. The strip is painted
 * over the bottom of the element; the decoded picture is letterboxed into the
 * area above it — not the full clientHeight.
 */
export function estimateVideoControlsHeight(video: HTMLVideoElement): number {
  if (!video.controls) return 0
  const w = video.clientWidth
  if (w <= 0) return 0
  return Math.min(56, Math.max(32, Math.round(w * 0.062)))
}

/**
 * Picture rect inside the video element box under `object-fit: contain`.
 *
 * When native controls are enabled, the picture is centered in the region above
 * the controls strip (Chromium/Safari/Firefox all behave this way). Mapping
 * landmarks into the full clientHeight without subtracting controls shifts the
 * skeleton vertically off the fighters during playback.
 *
 * When `canvas` is supplied, the returned left/top are relative to the canvas
 * bitmap origin (handles canvas/video DOM boxes that are siblings under a
 * shared wrapper but not pixel-identical).
 */
export function getVideoContentRect(
  video: HTMLVideoElement,
  canvas?: HTMLCanvasElement | null
): VideoContentRect | null {
  const { clientWidth, clientHeight, videoWidth, videoHeight } = video
  if (!clientWidth || !clientHeight || !videoWidth || !videoHeight) return null

  const controlsHeight = estimateVideoControlsHeight(video)
  const pictureHeight = Math.max(1, clientHeight - controlsHeight)

  const scale = Math.min(clientWidth / videoWidth, pictureHeight / videoHeight)
  const width = videoWidth * scale
  const height = videoHeight * scale

  const canvasWidth = canvas?.clientWidth || clientWidth
  const canvasHeight = canvas?.clientHeight || clientHeight

  let left = (clientWidth - width) / 2
  let top = (pictureHeight - height) / 2

  if (canvas) {
    const videoBox = video.getBoundingClientRect()
    const canvasBox = canvas.getBoundingClientRect()
    left = videoBox.left - canvasBox.left + left
    top = videoBox.top - canvasBox.top + top
  }

  return {
    left,
    top,
    width,
    height,
    canvasWidth,
    canvasHeight,
  }
}

export function syncCanvasToElement(canvas: HTMLCanvasElement, rect: VideoContentRect): void {
  if (canvas.width !== rect.canvasWidth) canvas.width = rect.canvasWidth
  if (canvas.height !== rect.canvasHeight) canvas.height = rect.canvasHeight
}

/**
 * Prepare a video frame for MediaPipe pose detection.
 * Downscales when the native resolution exceeds `maxLongestSide` so CPU
 * inference stays within the tier budget (landmarks remain normalized 0–1).
 */
export function syncPoseDetectionSurface(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxLongestSide: number
): HTMLVideoElement | HTMLCanvasElement {
  const vw = video.videoWidth
  const vh = video.videoHeight
  if (!vw || !vh) return video

  const longest = Math.max(vw, vh)
  if (longest <= maxLongestSide) return video

  const scale = maxLongestSide / longest
  const dw = Math.max(1, Math.round(vw * scale))
  const dh = Math.max(1, Math.round(vh * scale))
  if (canvas.width !== dw) canvas.width = dw
  if (canvas.height !== dh) canvas.height = dh

  const ctx = canvas.getContext('2d')
  if (!ctx) return video
  ctx.drawImage(video, 0, 0, dw, dh)
  return canvas
}
