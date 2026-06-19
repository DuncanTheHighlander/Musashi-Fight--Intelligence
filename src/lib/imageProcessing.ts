/**
 * Image Processing Utilities for AI Analysis
 * Optimizes frames for better AI performance and reduced bandwidth
 */

interface ImageOptimizationOptions {
  targetSize?: number // Max dimension (default 1024)
  quality?: number // JPEG quality 0-1 (default 0.85)
  enhanceContrast?: boolean // Apply contrast enhancement (default true)
  format?: 'jpeg' | 'png' // Output format (default jpeg)
}

/**
 * Optimize a canvas frame for AI analysis
 * - Resizes to optimal dimensions
 * - Enhances contrast for better pose detection
 * - Compresses with optimal quality
 */
export function optimizeFrameForAI(
  canvas: HTMLCanvasElement,
  options: ImageOptimizationOptions = {}
): string {
  const {
    targetSize = 1024,
    quality = 0.85,
    enhanceContrast = true,
    format = 'jpeg'
  } = options

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas context not available')

  // Calculate optimal dimensions (maintain aspect ratio)
  const scale = Math.min(targetSize / canvas.width, targetSize / canvas.height)
  const shouldResize = scale < 1

  // Create optimized canvas
  const optimized = document.createElement('canvas')
  const targetWidth = shouldResize ? Math.round(canvas.width * scale) : canvas.width
  const targetHeight = shouldResize ? Math.round(canvas.height * scale) : canvas.height
  
  optimized.width = targetWidth
  optimized.height = targetHeight
  
  const optCtx = optimized.getContext('2d')!
  
  // Draw with high-quality scaling
  optCtx.imageSmoothingEnabled = true
  optCtx.imageSmoothingQuality = 'high'
  optCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight)

  // Enhance contrast if requested
  if (enhanceContrast) {
    const imageData = optCtx.getImageData(0, 0, targetWidth, targetHeight)
    enhanceImageContrast(imageData)
    optCtx.putImageData(imageData, 0, 0)
  }

  // Convert to base64 with optimal compression
  const mimeType = format === 'png' ? 'image/png' : 'image/jpeg'
  return optimized.toDataURL(mimeType, quality)
}

/**
 * Enhance image contrast using clipped luminance histogram equalization.
 *
 * Operates on luma only (BT.601 Y channel) and preserves chroma so colors
 * stay natural — important for the LLM coach which uses glove/short colour
 * to disambiguate fighters. The previous implementation multiplied each RGB
 * channel by `equalised / brightness`, which blew out saturated regions
 * (red gloves on a dark background turned magenta) and could push values
 * past the legal range.
 *
 * The CDF is clipped to ±2.5% to suppress extreme tail-driven contrast
 * stretches that were destroying detail in well-lit gym footage.
 */
function enhanceImageContrast(imageData: ImageData): void {
  const data = imageData.data
  const pixelCount = data.length / 4
  if (pixelCount === 0) return

  // Histogram of Y (luma).
  const histogram = new Uint32Array(256)
  for (let i = 0; i < data.length; i += 4) {
    const y = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) | 0
    histogram[y]++
  }

  // Clip the histogram to ±2.5% of total pixel count, redistributing the
  // excess uniformly. This is the "C" in CLAHE-style contrast and prevents
  // a single bright/dark patch from skewing the whole frame.
  const clipLimit = Math.max(1, Math.round(pixelCount * 0.025))
  let excess = 0
  for (let i = 0; i < 256; i++) {
    if (histogram[i] > clipLimit) {
      excess += histogram[i] - clipLimit
      histogram[i] = clipLimit
    }
  }
  const redistribute = (excess / 256) | 0
  for (let i = 0; i < 256; i++) histogram[i] += redistribute

  // Cumulative distribution → 0..255 lookup.
  const lut = new Uint8Array(256)
  let cum = 0
  let cdfMin = 0
  for (let i = 0; i < 256; i++) {
    cum += histogram[i]
    if (cdfMin === 0 && cum > 0) cdfMin = cum
    lut[i] = cum > 0 ? Math.round(((cum - cdfMin) / Math.max(1, pixelCount - cdfMin)) * 255) : 0
  }

  // Apply: replace luma, keep chroma. Skip the alpha channel.
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const y = (0.299 * r + 0.587 * g + 0.114 * b)
    const yNew = lut[y | 0]
    const delta = yNew - y
    data[i]     = Math.max(0, Math.min(255, r + delta))
    data[i + 1] = Math.max(0, Math.min(255, g + delta))
    data[i + 2] = Math.max(0, Math.min(255, b + delta))
  }
}

/**
 * Batch optimize multiple frames
 * Useful for multi-frame analysis
 */
export function optimizeFrameBatch(
  canvases: HTMLCanvasElement[],
  options?: ImageOptimizationOptions
): string[] {
  return canvases.map(canvas => optimizeFrameForAI(canvas, options))
}

/**
 * Convert video blob to optimized base64
 * Useful for video upload preprocessing
 */
export async function optimizeVideoBlob(
  blob: Blob,
  maxSizeMB: number = 20
): Promise<Blob> {
  // If already small enough, return as-is
  if (blob.size <= maxSizeMB * 1024 * 1024) {
    return blob
  }

  // For larger videos, we'd need to re-encode
  // This is complex and should use ffmpeg.wasm or server-side processing
  // For now, just warn and return original
  console.warn(`Video size (${(blob.size / 1024 / 1024).toFixed(2)}MB) exceeds ${maxSizeMB}MB. Consider server-side compression.`)
  return blob
}

/**
 * Extract frames from video at specified intervals
 * Returns array of base64 encoded JPEGs
 */
export async function extractVideoFrames(
  videoElement: HTMLVideoElement,
  options: {
    count?: number // Number of frames to extract
    startSec?: number // Start time in seconds
    endSec?: number // End time in seconds
    maxSize?: number // Max frame dimension
  } = {}
): Promise<string[]> {
  const {
    count = 10,
    startSec = 0,
    endSec = videoElement.duration,
    maxSize = 1024
  } = options

  const frames: string[] = []
  const duration = endSec - startSec
  const interval = duration / count

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!

  // Store original video state
  const originalTime = videoElement.currentTime
  const wasPlaying = !videoElement.paused

  if (wasPlaying) {
    videoElement.pause()
  }

  try {
    for (let i = 0; i < count; i++) {
      const targetTime = startSec + (i * interval)
      
      // Seek to target time
      videoElement.currentTime = targetTime
      await new Promise<void>(resolve => {
        const onSeeked = () => {
          videoElement.removeEventListener('seeked', onSeeked)
          resolve()
        }
        videoElement.addEventListener('seeked', onSeeked)
      })

      // Capture frame
      const scale = Math.min(maxSize / videoElement.videoWidth, maxSize / videoElement.videoHeight, 1)
      canvas.width = Math.round(videoElement.videoWidth * scale)
      canvas.height = Math.round(videoElement.videoHeight * scale)
      
      ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height)
      
      // Optimize and store
      const optimized = optimizeFrameForAI(canvas, { targetSize: maxSize })
      frames.push(optimized)
    }
  } finally {
    // Restore video state
    videoElement.currentTime = originalTime
    if (wasPlaying) {
      videoElement.play().catch(() => {})
    }
  }

  return frames
}

/**
 * Calculate optimal frame count for video analysis
 * Based on video duration and target FPS
 */
export function calculateOptimalFrameCount(
  durationSec: number,
  targetFPS: number = 2
): number {
  const ideal = Math.ceil(durationSec * targetFPS)
  const min = 3 // Minimum frames for analysis
  const max = 30 // Maximum to avoid overwhelming AI
  
  return Math.max(min, Math.min(max, ideal))
}
