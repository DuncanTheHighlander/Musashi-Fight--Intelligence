/**
 * Burst Capture Service
 * 
 * Captures a 1-second "proof packet" of fight footage:
 * - 12-15 frames spanning ~1000ms centered on an event
 * - Matched pose data for each frame
 * - JPEG images capped at 720p
 */

import type { LandmarkHistory } from '@/lib/kinematics'

export interface BurstFrame {
  seq: number              // Frame sequence number (0-based)
  dtMs: number             // Offset from burst center in milliseconds
  jpegBase64: string       // JPEG image, max 720p
  landmarks: number[][]    // 33 x [x, y, z, visibility] — fighter A (or focus target if A/B)
  landmarksB?: number[][]  // 33 x [x, y, z, visibility] — fighter B, only present when focusTarget === 'both'
}

export interface KinematicBurst {
  burstId: string
  centerMs: number         // Video time at burst center
  focusTarget: 'A' | 'B' | 'both'
  frames: BurstFrame[]
  metadata: {
    captureReason: 'manual' | 'auto-detected' | 'peak-motion'
    videoDuration: number
    capturedAt: number     // Unix timestamp
    eventKind?: string     // What triggered this burst
  }
}

// Configuration
const BURST_CONFIG = {
  WINDOW_MS: 1000,         // Total window size (±500ms from center)
  TARGET_FRAMES: 12,       // Target number of frames
  MAX_WIDTH: 1280,         // Max frame width (720p)
  MAX_HEIGHT: 720,         // Max frame height
  JPEG_QUALITY: 0.85,      // JPEG compression quality
} as const

/**
 * Generate a unique burst ID
 */
function generateBurstId(): string {
  return `burst_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Find the nearest pose sample to a given timestamp.
 * Pose buffers are kept in chronological order, so we binary-search for the
 * insertion point and check the two adjacent samples — O(log n) instead of
 * the previous O(n) scan that ran 12× per burst capture.
 */
function findNearestPose(
  poseBuffer: LandmarkHistory[],
  targetMs: number
): LandmarkHistory | null {
  const n = poseBuffer.length
  if (n === 0) return null

  // Binary search for the first sample with timestamp >= targetMs.
  let lo = 0
  let hi = n
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (poseBuffer[mid].timestampMs < targetMs) lo = mid + 1
    else hi = mid
  }

  const after = lo < n ? poseBuffer[lo] : null
  const before = lo > 0 ? poseBuffer[lo - 1] : null

  let nearest: LandmarkHistory | null = null
  if (after && before) {
    nearest = (targetMs - before.timestampMs) <= (after.timestampMs - targetMs) ? before : after
  } else {
    nearest = after ?? before
  }

  if (!nearest) return null
  if (Math.abs(nearest.timestampMs - targetMs) > 100) return null
  return nearest
}

/**
 * Convert landmarks to serializable array format
 */
function landmarksToArray(landmarks: any[]): number[][] {
  return landmarks.map(lm => [
    lm.x ?? 0,
    lm.y ?? 0,
    lm.z ?? 0,
    lm.visibility ?? 0
  ])
}

/**
 * Capture a single frame from video and encode as JPEG base64
 */
async function captureFrameAsJpeg(
  videoEl: HTMLVideoElement,
  targetTime: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Create offscreen canvas
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    
    if (!ctx) {
      reject(new Error('Could not get canvas context'))
      return
    }
    
    // Calculate dimensions (cap at 720p)
    let width = videoEl.videoWidth
    let height = videoEl.videoHeight
    
    if (width > BURST_CONFIG.MAX_WIDTH || height > BURST_CONFIG.MAX_HEIGHT) {
      const scale = Math.min(
        BURST_CONFIG.MAX_WIDTH / width,
        BURST_CONFIG.MAX_HEIGHT / height
      )
      width = Math.round(width * scale)
      height = Math.round(height * scale)
    }
    
    canvas.width = width
    canvas.height = height
    
    // Store original time
    const originalTime = videoEl.currentTime
    
    // Seek to target time
    const onSeeked = () => {
      videoEl.removeEventListener('seeked', onSeeked)
      
      // Draw frame to canvas
      ctx.drawImage(videoEl, 0, 0, width, height)
      
      // Convert to JPEG base64
      const dataUrl = canvas.toDataURL('image/jpeg', BURST_CONFIG.JPEG_QUALITY)
      const base64 = dataUrl.split(',')[1] || ''
      
      // Restore original time
      videoEl.currentTime = originalTime
      
      resolve(base64)
    }
    
    videoEl.addEventListener('seeked', onSeeked)
    videoEl.currentTime = targetTime
    
    // Timeout fallback
    setTimeout(() => {
      videoEl.removeEventListener('seeked', onSeeked)
      reject(new Error('Frame capture timeout'))
    }, 2000)
  })
}

/**
 * Capture a burst of frames centered on a specific time
 * 
 * This is the synchronous version that uses the current frame buffer
 * instead of seeking the video (faster, less disruptive)
 */
export function captureBurstFromBuffer(
  poseBufferA: LandmarkHistory[],
  poseBufferB: LandmarkHistory[],
  centerMs: number,
  focusTarget: 'A' | 'B' | 'both',
  captureReason: 'manual' | 'auto-detected' | 'peak-motion' = 'manual',
  eventKind?: string
): Omit<KinematicBurst, 'frames'> & { poseFrames: Array<{ seq: number; dtMs: number; landmarks: number[][]; landmarksB?: number[][] }> } {
  const halfWindow = BURST_CONFIG.WINDOW_MS / 2
  const startMs = centerMs - halfWindow
  const frameInterval = BURST_CONFIG.WINDOW_MS / BURST_CONFIG.TARGET_FRAMES

  const poseFrames: Array<{ seq: number; dtMs: number; landmarks: number[][]; landmarksB?: number[][] }> = []

  // For 'both', primary slot carries fighter A and fighter B is added alongside.
  // Previously fell through to A only — fighter B's pose data was silently dropped.
  const primaryBuffer = focusTarget === 'B' ? poseBufferB : poseBufferA
  const includeB = focusTarget === 'both'

  for (let i = 0; i < BURST_CONFIG.TARGET_FRAMES; i++) {
    const targetMs = startMs + (i * frameInterval)
    const dtMs = Math.round(targetMs - centerMs)

    const primaryPose = findNearestPose(primaryBuffer, targetMs)
    const landmarks = primaryPose ? landmarksToArray(primaryPose.landmarks) : []

    const frame: { seq: number; dtMs: number; landmarks: number[][]; landmarksB?: number[][] } = {
      seq: i,
      dtMs,
      landmarks,
    }

    if (includeB) {
      const poseB = findNearestPose(poseBufferB, targetMs)
      frame.landmarksB = poseB ? landmarksToArray(poseB.landmarks) : []
    }

    poseFrames.push(frame)
  }

  return {
    burstId: generateBurstId(),
    centerMs,
    focusTarget,
    poseFrames,
    metadata: {
      captureReason,
      videoDuration: 0, // Will be filled by caller
      capturedAt: Date.now(),
      eventKind
    }
  }
}

/**
 * Capture a full burst with video frames (async, requires video seeking)
 * 
 * This captures actual JPEG frames from the video element
 */
export async function captureBurst(
  videoEl: HTMLVideoElement,
  poseBufferA: LandmarkHistory[],
  poseBufferB: LandmarkHistory[],
  centerMs: number,
  focusTarget: 'A' | 'B' | 'both' = 'both',
  captureReason: 'manual' | 'auto-detected' | 'peak-motion' = 'manual',
  eventKind?: string
): Promise<KinematicBurst> {
  const halfWindow = BURST_CONFIG.WINDOW_MS / 2
  const startMs = centerMs - halfWindow
  const frameInterval = BURST_CONFIG.WINDOW_MS / BURST_CONFIG.TARGET_FRAMES
  
  const frames: BurstFrame[] = []

  const primaryBuffer = focusTarget === 'B' ? poseBufferB : poseBufferA
  const includeB = focusTarget === 'both'

  // Store original video state
  const originalTime = videoEl.currentTime
  const wasPlaying = !videoEl.paused

  if (wasPlaying) {
    videoEl.pause()
  }

  try {
    for (let i = 0; i < BURST_CONFIG.TARGET_FRAMES; i++) {
      const targetMs = startMs + (i * frameInterval)
      const targetSec = Math.max(0, Math.min(targetMs / 1000, videoEl.duration))
      const dtMs = Math.round(targetMs - centerMs)

      // Capture frame
      let jpegBase64 = ''
      try {
        jpegBase64 = await captureFrameAsJpeg(videoEl, targetSec)
      } catch (e) {
        console.warn(`Failed to capture frame ${i}:`, e)
      }

      const primaryPose = findNearestPose(primaryBuffer, targetMs)
      const landmarks = primaryPose ? landmarksToArray(primaryPose.landmarks) : []

      const frame: BurstFrame = { seq: i, dtMs, jpegBase64, landmarks }
      if (includeB) {
        const poseB = findNearestPose(poseBufferB, targetMs)
        frame.landmarksB = poseB ? landmarksToArray(poseB.landmarks) : []
      }
      frames.push(frame)
    }
  } finally {
    // Restore video state
    videoEl.currentTime = originalTime
    if (wasPlaying) {
      videoEl.play().catch(() => {})
    }
  }
  
  return {
    burstId: generateBurstId(),
    centerMs,
    focusTarget,
    frames,
    metadata: {
      captureReason,
      videoDuration: videoEl.duration * 1000,
      capturedAt: Date.now(),
      eventKind
    }
  }
}

/**
 * Quick burst capture using current frame only (no seeking)
 * Uses canvas screenshot of current video frame
 */
export function captureQuickBurst(
  videoEl: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  poseBufferA: LandmarkHistory[],
  poseBufferB: LandmarkHistory[],
  focusTarget: 'A' | 'B' | 'both' = 'both',
  captureReason: 'manual' | 'auto-detected' | 'peak-motion' = 'manual'
): KinematicBurst {
  const centerMs = videoEl.currentTime * 1000
  const primaryBuffer = focusTarget === 'B' ? poseBufferB : poseBufferA
  const includeB = focusTarget === 'both'

  // Get current frame as JPEG
  const jpegBase64 = canvas.toDataURL('image/jpeg', BURST_CONFIG.JPEG_QUALITY).split(',')[1] || ''

  // Get recent pose samples for the burst window
  const halfWindow = BURST_CONFIG.WINDOW_MS / 2
  const startMs = centerMs - halfWindow
  const frameInterval = BURST_CONFIG.WINDOW_MS / BURST_CONFIG.TARGET_FRAMES

  const frames: BurstFrame[] = []

  for (let i = 0; i < BURST_CONFIG.TARGET_FRAMES; i++) {
    const targetMs = startMs + (i * frameInterval)
    const dtMs = Math.round(targetMs - centerMs)

    const primaryPose = findNearestPose(primaryBuffer, targetMs)
    const landmarks = primaryPose ? landmarksToArray(primaryPose.landmarks) : []

    // Only include actual image for the center frame
    const isCenterFrame = Math.abs(dtMs) < frameInterval / 2

    const frame: BurstFrame = {
      seq: i,
      dtMs,
      jpegBase64: isCenterFrame ? jpegBase64 : '',
      landmarks,
    }
    if (includeB) {
      const poseB = findNearestPose(poseBufferB, targetMs)
      frame.landmarksB = poseB ? landmarksToArray(poseB.landmarks) : []
    }
    frames.push(frame)
  }
  
  return {
    burstId: generateBurstId(),
    centerMs,
    focusTarget,
    frames,
    metadata: {
      captureReason,
      videoDuration: videoEl.duration * 1000,
      capturedAt: Date.now()
    }
  }
}

export { BURST_CONFIG }
