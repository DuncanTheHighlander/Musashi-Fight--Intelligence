'use client'

// ─── MediaPipe stderr noise filter ────────────────────────────────────────
// The @mediapipe/tasks-vision WASM module writes TFLite INFO logs (e.g.
// "INFO: Created TensorFlow Lite XNNPACK delegate for CPU.") to fd 2,
// which Emscripten routes to console.error. Next.js's dev overlay then
// intercepts console.error and surfaces it as an unhandled client error
// even though it's just informational noise. Filter those specific
// messages here — installed once at module load, idempotent across HMR.
if (typeof window !== 'undefined') {
  const w = window as unknown as { __musashiMpConsoleFilterInstalled?: boolean }
  if (!w.__musashiMpConsoleFilterInstalled) {
    w.__musashiMpConsoleFilterInstalled = true
    const MP_BENIGN_PATTERNS = [
      /INFO:\s*Created TensorFlow Lite XNNPACK delegate/i,
      /^INFO:\s*Initialized TensorFlow Lite runtime/i,
    ]
    const isBenignMpLog = (args: unknown[]): boolean => {
      if (args.length === 0) return false
      const first = args[0]
      if (typeof first !== 'string') return false
      return MP_BENIGN_PATTERNS.some((re) => re.test(first))
    }
    const originalError = console.error.bind(console)
    console.error = (...args: unknown[]) => {
      if (isBenignMpLog(args)) {
        // Downgrade to info so the dev overlay doesn't treat it as an error.
        console.info(...(args as [unknown, ...unknown[]]))
        return
      }
      originalError(...(args as [unknown, ...unknown[]]))
    }
  }
}

import React, { useCallback, useEffect, useRef } from 'react'
import { PoseLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision'
import {
  assignFightersByPosition,
  assignFightersWithTracking,
  blendPoses,
  computeKinematicsSnapshot,
  getTorsoVelocity,
  pruneHistory,
  smoothLandmarks,
  type KinematicsSnapshot,
  type PoseHistory,
} from '@/lib/kinematics'
import { createRetryLandmarker, detectSecondFighter as detectSecondFighterShared, detectInRegion } from '@/lib/poseRetry'
import { initRtmpose, isRtmposeReady, rtmposeInRegionAsync, rtmposeRequested } from '@/lib/pose/rtmposeBackend'
import { createAppearanceTracker, sampleColorProfile, blendColorProfile, colorProfileDist, type AppearanceTracker, type ColorProfile } from '@/lib/appearance'
import {
  advanceCrossingPhase,
  assignFighterTracks,
  clampVelocity,
  crossingHoldMs,
  crossingSmoothAlpha,
  dedupePoseCandidates,
  IDENTITY_STALE_MS,
  isCrossingPhase,
  updateIdentitySlotColor,
  type CrossingPhase,
  type IdentityCandidate,
  type IdentitySlot,
} from '@/lib/identityTracking'
import { buildFightLangFrameEvidence } from '@/lib/compiler/evidenceCompiler'
import type { FightLangFrameEvidence } from '@/lib/fightlang/ledger'
import { getPerformanceProfile, FrameBudget } from '@/lib/performanceProfile'
import { denseTrackKey, loadDenseTrack, pruneGhostRuns, saveDenseTrack } from '@/lib/denseTrackCache'
import { cloudPoseRequested, fetchCloudDenseTrack, getCloudPoseOptions } from '@/lib/cloudPose'
import { syncPoseDetectionSurface } from '@/lib/videoCanvas'

export type FightAnalyzerProps = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  enabled: boolean
  focus: 'A' | 'B' | 'both'
  /** Seek across the clip after metadata loads (paused) so pose / FightLang buffers fill before first play. */
  preScanOnLoad?: boolean
  /** When this value changes (e.g. new `videoUrl`), pre-scan is allowed to run again for the new clip. */
  preScanResetKey?: string | null
  /** Fires while the paused seek pass runs (video may jump under the hood). */
  onPreScanActiveChange?: (active: boolean) => void
  /** How many full seek passes over the clip (default 1). Use 2–3 so buffers are warm before first play. */
  preScanPasses?: number
  /** Called after all pre-scan passes finish (or if pre-scan is skipped). */
  onPreScanComplete?: () => void
  /** After each paused seek + pose sample during pre-scan (awaited so work can finish before the next seek). */
  onPreScanFrame?: (info: {
    passIndex: number
    passCount: number
    stepIndex: number
    totalSteps: number
    videoTimeSec: number
  }) => void | Promise<void>
  onPreScanPoseDetected?: (detected: { A: boolean; B: boolean }) => void
  onPose: (pose: { A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null }) => void
  /**
   * Fires alongside every onPose with the VIDEO-CLOCK time (ms) of the frame that
   * MediaPipe actually analyzed. The overlay uses this to keep skeletons glued to
   * the frame being displayed rather than lagging behind by the detection latency.
   */
  onPoseVideoTime?: (videoTimeMs: number) => void
  onPoseDetected?: (detected: { A: boolean; B: boolean }) => void
  onKinematics?: (snapshot: KinematicsSnapshot) => void
  onFrameEvidence?: (evidence: FightLangFrameEvidence) => void
  /**
   * Fires once the per-frame deep track is ready (freshly computed or restored
   * from cache), with the number of cached frames. Lets the shell report the
   * real deep-track coverage instead of the small sparse keyframe count.
   */
  onDenseTrackReady?: (frameCount: number) => void
}

const TASKS_VISION_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm'
const POSE_MODEL_HEAVY =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task'
const POSE_MODEL_FULL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task'

// Reduced from 52 → 24 to cut boot pre-scan memory + CPU pressure. With BOOT_PIPELINE_PASSES=1
// 24 paused seeks is enough density for the FightLang compiler to produce a usable ledger.
const PRESCAN_MAX_SEEKS = 24
// Dense boot pass: after the sparse pre-scan, the clip is stepped frame-by-frame
// through the FULL live pipeline (identity + appearance + forced crop-zoom
// refinement, no realtime rate limits) and the finished track is cached.
// Playback then replays the cached track — offline-grade landmarks at zero
// detection cost. This is the same regime as the offline eval harness that
// produced the baseline metrics.
const DENSE_TRACK_MAX_DURATION_MS = 10 * 60 * 1000
const DENSE_TRACK_MAX_SAMPLES = 1800
const DENSE_TRACK_MIN_STEP_MS = 33
/** A dense sample within this distance of the displayed frame is replayed as-is. */
const DENSE_TRACK_TOLERANCE_MS = 70

type DenseTrackSample = {
  tMs: number
  A: NormalizedLandmark[] | null
  B: NormalizedLandmark[] | null
}
/** HAVE_CURRENT_DATA — frame available for canvas / MediaPipe */
const HAVE_CURRENT_DATA = 2

type FighterKey = 'A' | 'B'
type PoseAnchor = { x: number; y: number }
type CornerCandidate = IdentityCandidate
type CornerIdentitySlot = IdentitySlot & {
  confidence: number
}
type CornerAppearanceProfile = {
  color: ColorProfile | null
  scale: number | null
  samples: number
}
type PreScanTrackSample = {
  tMs: number
  A: PoseAnchor | null
  B: PoseAnchor | null
  confidence: number
}

const IDENTITY_SCALE_WEIGHT = 0.16
const IDENTITY_POSE_WEIGHT = 0.18
const IDENTITY_VELOCITY_ALPHA = 0.28
const IDENTITY_COLOR_SMOOTHING = 0.15
const IDENTITY_OCCLUSION_HOLD_MS = 1800
const IDENTITY_PROFILE_COLOR_WEIGHT = 0.82
const IDENTITY_PROFILE_SCALE_WEIGHT = 0.10
const IDENTITY_PROFILE_CLEAR_MARGIN = 0.065
const PRESCAN_HINT_MAX_DISTANCE = 0.36
const PRESCAN_HINT_STRONG_MARGIN = 0.045

const TRACKING_POINTS: Array<[number, number]> = [
  [11, 1.2], [12, 1.2], [23, 1.2], [24, 1.2],
  [0, 0.45], [13, 0.55], [14, 0.55], [15, 0.4], [16, 0.4],
  [25, 0.75], [26, 0.75], [27, 0.65], [28, 0.65],
]

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/** Expose dense track + RTM status for QA loop / Playwright E2E (dev or ?qaLoop=1). */
function publishDenseTrackForQa(track: DenseTrackSample[], stepMs: number): void {
  if (typeof window === 'undefined') return
  const qaLoop = new URLSearchParams(window.location.search).get('qaLoop') === '1'
  if (process.env.NODE_ENV === 'production' && !qaLoop) return
  const w = window as unknown as {
    __denseTrack?: DenseTrackSample[]
    __musashiRtm?: { requested: boolean; ready: boolean }
  }
  w.__denseTrack = track
  w.__musashiRtm = { requested: rtmposeRequested(), ready: isRtmposeReady() }
  window.dispatchEvent(
    new CustomEvent('musashi:dense-ready', { detail: { frames: track.length, stepMs } })
  )
}

function getPoseAnchor(landmarks: NormalizedLandmark[]): PoseAnchor | null {
  const ls = landmarks[11]
  const rs = landmarks[12]
  const lh = landmarks[23]
  const rh = landmarks[24]
  const pts = [ls, rs, lh, rh].filter(Boolean) as NormalizedLandmark[]
  if (pts.length < 2) return null
  let x = 0
  let y = 0
  let w = 0
  for (const lm of pts) {
    const weight = Math.max(0.25, lm.visibility ?? 1)
    x += lm.x * weight
    y += lm.y * weight
    w += weight
  }
  return w > 0 ? { x: x / w, y: y / w } : null
}

function getPoseScale(landmarks: NormalizedLandmark[]): number {
  const ls = landmarks[11]
  const rs = landmarks[12]
  const lh = landmarks[23]
  const rh = landmarks[24]
  if (!ls || !rs || !lh || !rh) return 0.18
  const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y)
  const hipW = Math.hypot(lh.x - rh.x, lh.y - rh.y)
  const torsoH =
    (Math.hypot(ls.x - lh.x, ls.y - lh.y) + Math.hypot(rs.x - rh.x, rs.y - rh.y)) / 2
  return Math.max(0.08, shoulderW, hipW, torsoH)
}

function poseShapeDistance(a: NormalizedLandmark[], b: NormalizedLandmark[]): number {
  if (a.length !== b.length) return 0.5
  let total = 0
  let weight = 0
  for (const [idx, baseWeight] of TRACKING_POINTS) {
    const la = a[idx]
    const lb = b[idx]
    if (!la || !lb) continue
    const vis = Math.min(la.visibility ?? 1, lb.visibility ?? 1)
    if (vis < 0.08) continue
    const w = baseWeight * Math.max(0.35, vis)
    total += Math.hypot(la.x - lb.x, la.y - lb.y) * w
    weight += w
  }
  return weight > 0 ? total / weight : 0.5
}

function mixProfileColor(
  previous: ColorProfile | null,
  next: ColorProfile | null,
  samples: number
): ColorProfile | null {
  if (!next) return previous
  if (!previous || samples <= 0) return next
  const a = Math.max(0.035, Math.min(0.16, 1 / (samples + 2)))
  return blendColorProfile(previous, next, a)
}

function waitUntilHaveCurrentData(
  video: HTMLVideoElement,
  isCancelled: () => boolean
): Promise<void> {
  if (video.readyState >= HAVE_CURRENT_DATA) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      video.removeEventListener('loadeddata', finish)
      video.removeEventListener('canplay', finish)
      resolve()
    }
    const timeoutId = window.setTimeout(finish, 15_000)
    video.addEventListener('loadeddata', finish, { once: true })
    video.addEventListener('canplay', finish, { once: true })
    const tryNow = () => {
      if (isCancelled()) {
        finish()
        return
      }
      if (video.readyState >= HAVE_CURRENT_DATA) {
        finish()
      }
    }
    queueMicrotask(tryNow)
    requestAnimationFrame(tryNow)
  })
}

function seekVideoAndWait(video: HTMLVideoElement, tSec: number): Promise<void> {
  const dur = video.duration
  const cap = Number.isFinite(dur) && dur > 0 ? Math.max(0, dur - 1 / 60) : Infinity
  const target = Math.min(Math.max(0, tSec), cap)

  if (Math.abs(video.currentTime - target) < 0.02) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
    video.addEventListener('seeked', onSeeked)
    try {
      video.currentTime = target
    } catch {
      video.removeEventListener('seeked', onSeeked)
      resolve()
    }
  })
}

export function FightAnalyzer({
  videoRef,
  enabled,
  focus,
  preScanOnLoad = true,
  preScanResetKey = null,
  onPreScanActiveChange,
  preScanPasses = 1,
  onPreScanComplete,
  onPreScanFrame,
  onPreScanPoseDetected,
  onKinematics,
  onPose,
  onPoseVideoTime,
  onPoseDetected,
  onFrameEvidence,
  onDenseTrackReady,
}: FightAnalyzerProps) {
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null)
  const retryLandmarkerRef = useRef<PoseLandmarker | null>(null)
  const retryCropCanvasRef = useRef<HTMLCanvasElement | null>(null)
  // Crop-zoom refinement: re-detect each fighter on a zoomed crop so the
  // model sees ~4x the pixels per body. One canvas + timestamp per slot.
  const refineCanvasRef = useRef<{ A: HTMLCanvasElement | null; B: HTMLCanvasElement | null }>({ A: null, B: null })
  const lastRefineWallMsRef = useRef<{ A: number; B: number }>({ A: 0, B: 0 })
  const poseDetectCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const lastCropRetryWallMsRef = useRef<number>(0)
  // Cached offline-grade track from the dense boot pass (sorted by tMs).
  const denseTrackRef = useRef<DenseTrackSample[]>([])
  const denseTrackReadyRef = useRef<boolean>(false)
  // True while the dense boot pass is stepping the clip. The pass must match
  // the VERIFIED offline replay (identityReplay.offline.test.ts) exactly, so
  // browser-only extras (appearance override, motion fallback, pre-scan
  // hints) are disabled while this is set — they are what the replay excludes.
  const densePassActiveRef = useRef<boolean>(false)
  const visionFilesetReadyRef = useRef<Promise<any> | null>(null)
  const poseInitPromiseRef = useRef<Promise<void> | null>(null)

  const rafRef = useRef<number | null>(null)
  // Handle for requestVideoFrameCallback. Kept separate from rafRef so we can
  // cancel the RVFC-scheduled callback cleanly on pause/unmount without
  // confusing it with the setTimeout fallback path.
  const rvfcHandleRef = useRef<number | null>(null)
  const lastPoseMsRef = useRef<number>(0)
  const lastRvfcPoseWallMsRef = useRef<number>(0)
  const lastKinematicsMsRef = useRef<number>(0)
  /** Strictly monotonic timestamp for MediaPipe — prevents "timestamp mismatch" floods */
  const lastMediaPipeTsRef = useRef<number>(0)
  /**
   * Rebase offset added to the media-clock timestamp before it is handed to
   * MediaPipe. VIDEO mode needs timestamps that are BOTH strictly monotonic
   * AND advance with realistic frame deltas (its internal landmark filter and
   * ROI tracker integrate over Δt). A bare `max(ts, last+1)` clamp satisfies
   * monotonicity but collapses every frame after a backward seek — or after
   * the wall-clock-stamped pre-scan — to 1 ms increments, which silently
   * degrades tracking for the rest of the session. Instead, whenever the
   * incoming timestamp would go backwards we bump this offset so the stream
   * jumps forward once (~one frame) and then keeps real deltas.
   */
  const mediaPipeTsOffsetRef = useRef<number>(0)

  const poseHistoryRef = useRef<PoseHistory>({ A: [], B: [] })
  const smoothedLandmarksRef = useRef<{ A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null }>({
    A: null,
    B: null,
  })
  // Last RAW (unsmoothed) landmarks — used as the anchor for smoothing so that
  // during occlusion we don't repeatedly smooth against already-smoothed output
  // (which caused the skeleton to "snap slowly" after the fighter reappeared).
  const lastRawLandmarksRef = useRef<{ A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null }>({
    A: null,
    B: null,
  })
  const previousRawLandmarksRef = useRef<{ A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null }>({
    A: null,
    B: null,
  })
  const identitySlotsRef = useRef<{ A: CornerIdentitySlot | null; B: CornerIdentitySlot | null }>({
    A: null,
    B: null,
  })
  const identityProfilesRef = useRef<{ A: CornerAppearanceProfile; B: CornerAppearanceProfile }>({
    A: { color: null, scale: null, samples: 0 },
    B: { color: null, scale: null, samples: 0 },
  })
  const identitySamplerCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const identitySwapStreakRef = useRef(0)
  const identityOcclusionUntilRef = useRef(0)
  const crossingPhaseRef = useRef<CrossingPhase>('tracking')
  const crossingRecoveryStableRef = useRef(0)
  /** While a crossing collapses to a single visible body, the label that body
   *  is locked to. Frozen for the duration of the overlap (hysteresis) so the
   *  visible fighter keeps being tracked without flip-flopping; identity is
   *  re-evaluated with accumulated evidence at separation. */
  const crossingLockKeyRef = useRef<FighterKey | null>(null)
  const preScanTrackRef = useRef<PreScanTrackSample[]>([])
  const lastPoseSeenRef = useRef<{ A: number | null; B: number | null }>({ A: null, B: null })
  /** Appearance-based identity tracker. Captures HSV histogram of each fighter's
   *  torso region; overrides motion-based assignment when they strongly disagree
   *  (the motion-only system can't distinguish fighters during full occlusion). */
  const appearanceTrackerRef = useRef<AppearanceTracker | null>(null)
  const getAppearanceTracker = (): AppearanceTracker => {
    if (!appearanceTrackerRef.current) {
      appearanceTrackerRef.current = createAppearanceTracker()
    }
    return appearanceTrackerRef.current
  }
  /** Last known velocity (normalized coords/frame) for each fighter. Used to
   *  extrapolate position during occlusion so the reacquired pose matches the
   *  correct identity slot. */
  const velocityRef = useRef<{ A: { vx: number; vy: number }; B: { vx: number; vy: number } }>({
    A: { vx: 0, vy: 0 },
    B: { vx: 0, vy: 0 },
  })
  const preScanDoneForSrcRef = useRef<string | null>(null)
  /** True while the paused seek pre-scan loop is running — `seeked` must be ignored then or it corrupts mpTs offset / timestamps. */
  const preScanActiveRef = useRef(false)
  const preScanResetKeyPrevRef = useRef<string | null>(null)
  const onPreScanActiveChangeRef = useRef(onPreScanActiveChange)
  const onPreScanCompleteRef = useRef(onPreScanComplete)
  const onPreScanFrameRef = useRef(onPreScanFrame)
  const onPreScanPoseDetectedRef = useRef(onPreScanPoseDetected)
  const onDenseTrackReadyRef = useRef(onDenseTrackReady)

  // Keep callback refs fresh without triggering re-renders.
  // Previously these were assigned at render-time (outside useEffect) which
  // could leave stale references after React 18 concurrent re-renders.
  useEffect(() => { onPreScanActiveChangeRef.current = onPreScanActiveChange }, [onPreScanActiveChange])
  useEffect(() => { onPreScanCompleteRef.current = onPreScanComplete }, [onPreScanComplete])
  useEffect(() => { onPreScanFrameRef.current = onPreScanFrame }, [onPreScanFrame])
  useEffect(() => { onPreScanPoseDetectedRef.current = onPreScanPoseDetected }, [onPreScanPoseDetected])
  useEffect(() => { onDenseTrackReadyRef.current = onDenseTrackReady }, [onDenseTrackReady])

  // New clip / blob URL: reset MediaPipe time cursors and tracks — stale state
  // from the previous file causes empty detections or “frozen” tracking.
  useEffect(() => {
    if (preScanResetKey == null) return
    lastMediaPipeTsRef.current = 0
    mediaPipeTsOffsetRef.current = 0
    lastPoseMsRef.current = 0
    lastRvfcPoseWallMsRef.current = 0
    lastCropRetryWallMsRef.current = 0
    frameBudgetRef.current.reset()
    smoothedLandmarksRef.current = { A: null, B: null }
    lastRawLandmarksRef.current = { A: null, B: null }
    previousRawLandmarksRef.current = { A: null, B: null }
    identitySlotsRef.current = { A: null, B: null }
    identityProfilesRef.current = {
      A: { color: null, scale: null, samples: 0 },
      B: { color: null, scale: null, samples: 0 },
    }
    identitySwapStreakRef.current = 0
    identityOcclusionUntilRef.current = 0
    crossingPhaseRef.current = 'tracking'
    crossingRecoveryStableRef.current = 0
    crossingLockKeyRef.current = null
    preScanTrackRef.current = []
    poseHistoryRef.current = { A: [], B: [] }
    lastPoseSeenRef.current = { A: null, B: null }
    velocityRef.current = { A: { vx: 0, vy: 0 }, B: { vx: 0, vy: 0 } }
    // New clip → forget previous fighters' appearance fingerprints
    appearanceTrackerRef.current?.reset()
  }, [preScanResetKey])

  const ensureVisionFileset = useCallback(async () => {
    if (!visionFilesetReadyRef.current) {
      visionFilesetReadyRef.current = FilesetResolver.forVisionTasks(TASKS_VISION_WASM)
    }
    return visionFilesetReadyRef.current
  }, [])

  const initPoseLandmarker = useCallback(async () => {
    if (poseLandmarkerRef.current) return
    if (poseInitPromiseRef.current) return poseInitPromiseRef.current

    poseInitPromiseRef.current = (async () => {
      try {
        const vision = await ensureVisionFileset()

        // Initialize the crop-retry landmarker in parallel with the main one so
        // the second fighter can be detected from the very first frames. It's a
        // lightweight IMAGE-mode CPU landmarker that shares the already-loaded
        // WASM binary, so it doesn't contend with the main GPU/CPU init. Kicked
        // off fire-and-forget here — it becomes available as soon as it's ready
        // instead of after a fixed 1s delay (which left the 2nd fighter
        // undetected during the opening seconds of playback).
        if (!retryLandmarkerRef.current) {
          void (async () => {
            try {
              retryLandmarkerRef.current = await createRetryLandmarker(vision)
            } catch {
              console.warn('[Pose] Retry landmarker deferred init failed')
            }
          })()
        }

        // Opt-in RTMPose backend (flag: ?poseBackend=rtmpose). Inert unless the
        // flag is set AND the model/runtime load — otherwise the per-fighter
        // refine stays on MediaPipe exactly as today.
        if (rtmposeRequested()) void initRtmpose()

        const base = {
          runningMode: 'VIDEO' as const,
          numPoses: 2,
          // Moderate thresholds — high values reject real bodies on dark / phone / wide shots.
          minPoseDetectionConfidence: 0.35,
          minPosePresenceConfidence: 0.33,
          minTrackingConfidence: 0.32,
        }

        // CPU-first strategy: CPU delegate is 100% reliable (no WebGL context limits)
        // and gives identical tracking quality. GPU is tried only as an upgrade AFTER
        // CPU proves stable. This prevents the "emscripten_webgl_create_context error 0"
        // crash that was killing ALL skeleton tracking.
        //
        // On LITE hardware (integrated GPU, ≤16GB RAM): prefer the smaller Full model
        // over Heavy, and skip GPU attempts entirely — the iGPU VRAM contention with
        // video decode is the main freeze cause.
        const perfProfile = getPerformanceProfile()
        const candidates: Array<{ modelAssetPath: string; delegate: 'GPU' | 'CPU' }> =
          perfProfile.tier === 'lite'
            ? [
                // Full model first on lite hardware — 10MB lighter than Heavy, plenty accurate
                { modelAssetPath: POSE_MODEL_FULL, delegate: 'CPU' },
                { modelAssetPath: POSE_MODEL_HEAVY, delegate: 'CPU' },
              ]
            : perfProfile.tryGpuDelegate
              ? [
                  { modelAssetPath: POSE_MODEL_HEAVY, delegate: 'CPU' },
                  { modelAssetPath: POSE_MODEL_FULL, delegate: 'CPU' },
                  { modelAssetPath: POSE_MODEL_HEAVY, delegate: 'GPU' },
                  { modelAssetPath: POSE_MODEL_FULL, delegate: 'GPU' },
                ]
              : [
                  { modelAssetPath: POSE_MODEL_HEAVY, delegate: 'CPU' },
                  { modelAssetPath: POSE_MODEL_FULL, delegate: 'CPU' },
                ]

        let landmarker: PoseLandmarker | null = null
        let lastErr: unknown = null
        for (const baseOptions of candidates) {
          try {
            landmarker = await PoseLandmarker.createFromOptions(vision, { baseOptions, ...base })
            console.log(`[Pose] Main landmarker ready (${baseOptions.delegate}, ${baseOptions.modelAssetPath.includes('heavy') ? 'heavy' : 'full'})`)
            break
          } catch (e) {
            lastErr = e
            // Only warn, don't log as error — GPU failures are expected and normal
            console.warn(`[Pose] ${baseOptions.delegate} ${baseOptions.modelAssetPath.includes('heavy') ? 'heavy' : 'full'} failed, trying next`)
          }
        }

        if (!landmarker) {
          throw new Error(lastErr instanceof Error ? lastErr.message : 'Failed to initialize PoseLandmarker')
        }

        poseLandmarkerRef.current = landmarker
      } catch (e) {
        // Clear stale promise so future calls can retry instead of returning a rejected promise
        poseInitPromiseRef.current = null
        throw e
      }
    })()

    return poseInitPromiseRef.current
  }, [ensureVisionFileset])

  const detectSecondFighter = useCallback(
    (
      source: HTMLVideoElement | HTMLCanvasElement,
      firstPose: NormalizedLandmark[] | null
    ) => {
      const retry = retryLandmarkerRef.current
      if (!retry) return null
      if (!retryCropCanvasRef.current) retryCropCanvasRef.current = document.createElement('canvas')
      return detectSecondFighterShared(retry, source, firstPose, retryCropCanvasRef.current)
    },
    []
  )

  const recordPreScanTrack = useCallback((tMs: number, poses: NormalizedLandmark[][]) => {
    const candidates = poses
      .map((pose) => ({ pose, anchor: getPoseAnchor(pose), scale: getPoseScale(pose) }))
      .filter((candidate): candidate is { pose: NormalizedLandmark[]; anchor: PoseAnchor; scale: number } => Boolean(candidate.anchor))
      .slice(0, 2)

    if (candidates.length === 0) {
      preScanTrackRef.current.push({ tMs, A: null, B: null, confidence: 0 })
      return
    }

    const previous = [...preScanTrackRef.current].reverse().find((sample) => sample.A || sample.B)
    let A: PoseAnchor | null = null
    let B: PoseAnchor | null = null

    if (candidates.length === 1) {
      const only = candidates[0]
      if (previous?.A && previous?.B) {
        const distA = Math.hypot(only.anchor.x - previous.A.x, only.anchor.y - previous.A.y)
        const distB = Math.hypot(only.anchor.x - previous.B.x, only.anchor.y - previous.B.y)
        if (distA <= distB) A = only.anchor
        else B = only.anchor
      } else if (previous?.A) {
        A = only.anchor
      } else if (previous?.B) {
        B = only.anchor
      } else {
        A = only.anchor
      }
      preScanTrackRef.current.push({ tMs, A, B, confidence: 0.35 })
      return
    }

    const [c0, c1] = candidates
    if (previous?.A && previous?.B) {
      const direct =
        Math.hypot(c0.anchor.x - previous.A.x, c0.anchor.y - previous.A.y) +
        Math.hypot(c1.anchor.x - previous.B.x, c1.anchor.y - previous.B.y)
      const swap =
        Math.hypot(c0.anchor.x - previous.B.x, c0.anchor.y - previous.B.y) +
        Math.hypot(c1.anchor.x - previous.A.x, c1.anchor.y - previous.A.y)
      if (direct <= swap) {
        A = c0.anchor
        B = c1.anchor
      } else {
        A = c1.anchor
        B = c0.anchor
      }
    } else {
      const sorted = [c0, c1].sort((p, q) => p.anchor.x - q.anchor.x)
      A = sorted[0].anchor
      B = sorted[1].anchor
    }

    const gap = A && B ? Math.hypot(A.x - B.x, A.y - B.y) : 0
    preScanTrackRef.current.push({
      tMs,
      A,
      B,
      confidence: gap > 0.18 ? 0.85 : 0.55,
    })
  }, [])

  const getPreScanTrackHint = useCallback((tMs: number): PreScanTrackSample | null => {
    const samples = preScanTrackRef.current
      .filter((sample) => sample.A && sample.B)
      .sort((a, b) => a.tMs - b.tMs)
    if (samples.length === 0) return null

    let best = samples[0]
    let bestDist = Math.abs(samples[0].tMs - tMs)
    for (let i = 1; i < samples.length; i++) {
      const dist = Math.abs(samples[i].tMs - tMs)
      if (dist < bestDist) {
        best = samples[i]
        bestDist = dist
      }
    }

    // Do not let a very distant sparse sample overrule live tracking.
    if (bestDist > 900) return null
    return best
  }, [])

  const assignCornerIdentities = useCallback(
    (video: HTMLVideoElement, poses: NormalizedLandmark[][], wallNow: number, videoTimeMs: number) => {
      if (!identitySamplerCanvasRef.current) {
        const c = document.createElement('canvas')
        c.width = 160
        c.height = 90
        identitySamplerCanvasRef.current = c
      }
      const sampler = identitySamplerCanvasRef.current
      const candidates: CornerCandidate[] = []
      for (const pose of poses) {
        const anchor = getPoseAnchor(pose)
        if (!anchor) continue
        candidates.push({
          pose,
          anchor,
          color: sampleColorProfile(video, pose, sampler),
          scale: getPoseScale(pose),
        })
      }

      const slots = identitySlotsRef.current
      const phaseIn = crossingPhaseRef.current

      if (candidates.length === 0) {
        if (wallNow < identityOcclusionUntilRef.current || isCrossingPhase(phaseIn)) {
          return { A: slots.A?.pose ?? null, B: slots.B?.pose ?? null }
        }
        return { A: null, B: null }
      }

      const profileCost = (candidate: CornerCandidate, key: FighterKey): number => {
        const profile = identityProfilesRef.current[key]
        if (!profile.color || !candidate.color || profile.samples < 2) return Infinity
        const color = colorProfileDist(candidate.color, profile.color)
        const scale =
          profile.scale && profile.scale > 0
            ? Math.abs(Math.log(Math.max(0.05, candidate.scale) / Math.max(0.05, profile.scale)))
            : 0.18
        return color * IDENTITY_PROFILE_COLOR_WEIGHT + Math.min(0.45, scale) * IDENTITY_PROFILE_SCALE_WEIGHT
      }

      const updateProfile = (key: FighterKey, candidate: CornerCandidate | undefined, clearFrame: boolean) => {
        if (!candidate?.color || !clearFrame) return
        const profile = identityProfilesRef.current[key]
        identityProfilesRef.current[key] = {
          color: mixProfileColor(profile.color, candidate.color, profile.samples),
          scale: profile.scale == null ? candidate.scale : profile.scale * 0.94 + candidate.scale * 0.06,
          samples: Math.min(80, profile.samples + 1),
        }
      }

      const updateSlot = (
        key: FighterKey,
        candidate: CornerCandidate | undefined,
        learnAppearance: boolean,
        phase: CrossingPhase
      ) => {
        if (!candidate) return
        const prev = slots[key]
        let velocity = { vx: 0, vy: 0 }
        if (prev) {
          const dt = Math.max(1, wallNow - prev.wallMs)
          const raw = clampVelocity(
            (candidate.anchor.x - prev.anchor.x) / dt,
            (candidate.anchor.y - prev.anchor.y) / dt
          )
          velocity = {
            vx: prev.velocity.vx * (1 - IDENTITY_VELOCITY_ALPHA) + raw.vx * IDENTITY_VELOCITY_ALPHA,
            vy: prev.velocity.vy * (1 - IDENTITY_VELOCITY_ALPHA) + raw.vy * IDENTITY_VELOCITY_ALPHA,
          }
        }
        const color =
          learnAppearance || phase === 'tracking'
            ? updateIdentitySlotColor(prev, candidate, phase, IDENTITY_COLOR_SMOOTHING)
            : prev?.color ?? candidate.color
        slots[key] = {
          pose: candidate.pose,
          anchor: candidate.anchor,
          color,
          anchorColor: prev?.anchorColor ?? null,
          scale: learnAppearance && prev ? prev.scale * 0.84 + candidate.scale * 0.16 : prev?.scale ?? candidate.scale,
          velocity,
          wallMs: wallNow,
          confidence: Math.min(1, (prev?.confidence ?? 0.6) + 0.08),
        }
        updateProfile(key, candidate, learnAppearance && phase === 'tracking')
      }

      let { A: assignA, B: assignB } = assignFighterTracks(
        candidates,
        slots.A,
        slots.B,
        wallNow,
        phaseIn,
        (candidate, slot) => ({
          poseShape: poseShapeDistance(candidate.pose, slot.pose),
          scaleWeight: IDENTITY_SCALE_WEIGHT,
          poseWeight: IDENTITY_POSE_WEIGHT,
        })
      )

      // During crossing with a single visible body: lock that body to ONE label
      // for the whole overlap window. The long-term appearance profile can
      // override the lock when it is decisive; otherwise the lock seeds from
      // the bipartite assignment on the first ambiguous frame and then holds.
      // Keeping the visible (front) fighter assigned — rather than dropping
      // both assignments as before — keeps its slot fresh (anchor, velocity,
      // wallMs), so the phase machine doesn't go stale mid-clinch and the
      // hidden fighter's slot is the only one held + predicted.
      if (candidates.length === 1 && slots.A && slots.B && isCrossingPhase(phaseIn)) {
        identityOcclusionUntilRef.current = wallNow + IDENTITY_OCCLUSION_HOLD_MS
        const profileA = profileCost(candidates[0], 'A')
        const profileB = profileCost(candidates[0], 'B')
        const profileClear =
          Number.isFinite(profileA) &&
          Number.isFinite(profileB) &&
          Math.abs(profileA - profileB) > IDENTITY_PROFILE_CLEAR_MARGIN * 1.5
        let lockKey: FighterKey
        if (profileClear) {
          lockKey = profileA < profileB ? 'A' : 'B'
        } else if (crossingLockKeyRef.current) {
          lockKey = crossingLockKeyRef.current
        } else {
          // First ambiguous overlap frame: trust the predicted-position +
          // appearance bipartite result for who stayed visible, then freeze.
          lockKey = assignA ? 'A' : 'B'
        }
        crossingLockKeyRef.current = lockKey
        assignA = lockKey === 'A' ? candidates[0] : undefined
        assignB = lockKey === 'B' ? candidates[0] : undefined
      } else if (candidates.length >= 2) {
        crossingLockKeyRef.current = null
      }

      // Strong pre-scan hint can override bipartite assignment during merged/recovering.
      // Skipped in the dense pass — the verified offline replay excludes hints, and
      // sparse-pass hints use positional labels that can be swapped.
      if (!densePassActiveRef.current && candidates.length >= 2 && (phaseIn === 'merged' || phaseIn === 'recovering')) {
        const [c0, c1] = candidates
        const preScanHint = getPreScanTrackHint(videoTimeMs)
        if (preScanHint?.A && preScanHint.B) {
          const hintDirect =
            Math.hypot(c0.anchor.x - preScanHint.A.x, c0.anchor.y - preScanHint.A.y) +
            Math.hypot(c1.anchor.x - preScanHint.B.x, c1.anchor.y - preScanHint.B.y)
          const hintSwap =
            Math.hypot(c0.anchor.x - preScanHint.B.x, c0.anchor.y - preScanHint.B.y) +
            Math.hypot(c1.anchor.x - preScanHint.A.x, c1.anchor.y - preScanHint.A.y)
          const hintMargin = Math.abs(hintDirect - hintSwap)
          if (
            Math.min(hintDirect, hintSwap) < PRESCAN_HINT_MAX_DISTANCE &&
            hintMargin > PRESCAN_HINT_STRONG_MARGIN * (preScanHint.confidence ?? 0.5)
          ) {
            assignA = hintDirect <= hintSwap ? c0 : c1
            assignB = hintDirect <= hintSwap ? c1 : c0
          }
        }
      }

      const learnAppearance = phaseIn === 'tracking' && candidates.length >= 2
      updateSlot('A', assignA, learnAppearance, phaseIn)
      updateSlot('B', assignB, learnAppearance, phaseIn)

      const phaseResult = advanceCrossingPhase(
        phaseIn,
        slots.A,
        slots.B,
        poses.length,
        wallNow,
        crossingRecoveryStableRef.current
      )
      crossingPhaseRef.current = phaseResult.phase
      crossingRecoveryStableRef.current = phaseResult.stableFrames
      if (phaseResult.phase === 'tracking') {
        crossingLockKeyRef.current = null
      }

      // Return only REAL assignments. The old code also returned the slot's
      // held pose while a crossing was active — but the caller treats any
      // returned pose as a fresh sighting (refreshes lastSeen, smoothing,
      // velocity), so a held pose kept re-arming the render hold forever.
      // When a fighter walked out of frame after a close pass, that left a
      // frozen ghost skeleton on screen for up to 5 s. The caller's own hold
      // window (crossingHoldMs: 1.8 s during crossings) already renders the
      // hidden fighter through genuine occlusions.
      return {
        A: assignA?.pose ?? null,
        B: assignB?.pose ?? null,
      }
    },
    [getPreScanTrackHint]
  )

  const syncCornerIdentitySlot = useCallback(
    (video: HTMLVideoElement, key: FighterKey, pose: NormalizedLandmark[] | null, wallNow: number) => {
      if (!pose) return
      const anchor = getPoseAnchor(pose)
      if (!anchor) return
      if (!identitySamplerCanvasRef.current) {
        const c = document.createElement('canvas')
        c.width = 160
        c.height = 90
        identitySamplerCanvasRef.current = c
      }

      const sampler = identitySamplerCanvasRef.current
      const color = sampleColorProfile(video, pose, sampler)
      const scale = getPoseScale(pose)
      const slots = identitySlotsRef.current
      const prev = slots[key]
      let velocity = { vx: 0, vy: 0 }

      if (prev) {
        const dt = Math.max(1, wallNow - prev.wallMs)
        const raw = clampVelocity(
          (anchor.x - prev.anchor.x) / dt,
          (anchor.y - prev.anchor.y) / dt
        )
        velocity = {
          vx: prev.velocity.vx * (1 - IDENTITY_VELOCITY_ALPHA) + raw.vx * IDENTITY_VELOCITY_ALPHA,
          vy: prev.velocity.vy * (1 - IDENTITY_VELOCITY_ALPHA) + raw.vy * IDENTITY_VELOCITY_ALPHA,
        }
      }

      const phase = crossingPhaseRef.current
      slots[key] = {
        pose,
        anchor,
        color: updateIdentitySlotColor(prev, { pose, anchor, color, scale } as CornerCandidate, phase, IDENTITY_COLOR_SMOOTHING),
        anchorColor: prev?.anchorColor ?? null,
        scale: prev ? prev.scale * 0.84 + scale * 0.16 : scale,
        velocity,
        wallMs: wallNow,
        confidence: 1,
      }

      if (color && phase === 'tracking') {
        const profile = identityProfilesRef.current[key]
        identityProfilesRef.current[key] = {
          color: mixProfileColor(profile.color, color, profile.samples),
          scale: profile.scale == null ? scale : profile.scale * 0.78 + scale * 0.22,
          samples: Math.min(80, profile.samples + 1),
        }
      }
    },
    []
  )

  const processPoseFrame = useCallback(
    async (opts?: { skipThrottle?: boolean; preScan?: boolean; densePass?: boolean; mediaPipeTimestampMs?: number }) => {
      const video = videoRef.current
      const landmarker = poseLandmarkerRef.current
      if (!video || !landmarker || video.ended || video.readyState < 2) return

      // Raw frame timestamp — prefer the RVFC-supplied mediaTime*1000 (exact
      // video clock of the presented frame). For pre-scan seeds we fall back
      // to performance.now(); for the scrub / direct-invoke path we fall back
      // to `video.currentTime * 1000` (better than wall clock for matching
      // the frame being analyzed).
      const rawFrameTs =
        typeof video.currentTime === 'number'
          ? Math.round(video.currentTime * 1000)
          : performance.now()
      // Unified frame timestamp: ONE value drives both the MediaPipe detection
      // timestamp AND the overlay history key (onPoseVideoTime / history). The
      // detector previously used metadata.mediaTime*1000 while the overlay keyed
      // history off video.currentTime*1000 (rawFrameTs) — the two clocks drift
      // apart so the drawn skeleton lags/leads the analyzed frame. Prefer the
      // RVFC media clock (opts.mediaPipeTimestampMs); fall back to rawFrameTs.
      const unifiedFrameTs = Math.round(opts?.mediaPipeTimestampMs ?? rawFrameTs)
      // The dense boot pass steps through MEDIA time, not wall time — identity
      // holds/staleness must age on the clip's clock there (exactly like the
      // offline eval harness), otherwise slow seek steps would expire holds
      // 4-5x too early.
      const wallNow = opts?.densePass ? unifiedFrameTs : performance.now()
      // Inner throttle floor — derived from the active hardware tier so balanced/max
      // actually benefit from their faster cadences. Previously hardcoded at 75 ms
      // which silently clamped balanced (66 ms target) and max (45 ms target) to
      // 13 Hz. We subtract a 10 ms safety margin so outer tick timing jitter
      // doesn't trip this floor and skip legitimate frames.
      // Pre-scan uses skipThrottle so it runs at full resolution regardless.
      const perfForGap = getPerformanceProfile()
      // Allow more frequent samples than poseIntervalMs (RVFC + inner gate) — was skipping
      // too many frames on 60fps video when gap tracked media time tightly.
      const minFrameGap = Math.max(10, Math.min(22, perfForGap.poseIntervalMs - 18))
      // Throttle on the same media clock we publish to the overlay — using
      // video.currentTime here while publishing RVFC mediaTime desynced cadence
      // from the composited frame and made the skeleton trail during playback.
      if (!opts?.skipThrottle && unifiedFrameTs - lastPoseMsRef.current < minFrameGap) return
      lastPoseMsRef.current = unifiedFrameTs
      // Keep strictly monotonic for MediaPipe VIDEO mode while preserving real
      // frame deltas. Rebase (instead of clamping to last+1) so a backward
      // seek / replay — or the wall-clock-stamped pre-scan — doesn't collapse
      // all subsequent timestamps to 1 ms increments, which wrecks MediaPipe's
      // temporal smoothing and made tracking degrade after the first rewind.
      const unifiedRounded = Math.round(unifiedFrameTs)
      let frameTs = unifiedRounded + mediaPipeTsOffsetRef.current
      if (frameTs <= lastMediaPipeTsRef.current) {
        mediaPipeTsOffsetRef.current = lastMediaPipeTsRef.current + 33 - unifiedRounded
        frameTs = unifiedRounded + mediaPipeTsOffsetRef.current
      }
      lastMediaPipeTsRef.current = frameTs

      if (!poseDetectCanvasRef.current) {
        poseDetectCanvasRef.current = document.createElement('canvas')
      }
      const detectSurface = syncPoseDetectionSurface(
        video,
        poseDetectCanvasRef.current,
        perfForGap.maxPoseResolution
      )

      try {
        // Full-frame detection (numPoses:2); the crop-retry below fills in a
        // missed second fighter. The dense boot pass uses this SAME regime so
        // it equals the VERIFIED offline replay (identityReplay.offline.test.ts)
        // exactly — full-frame candidates assigned by identity, then refined.
        const detectedPoses: NormalizedLandmark[][] = []
        const result = landmarker.detectForVideo(detectSurface, frameTs)
        for (const p of result.landmarks || []) detectedPoses.push(p)

        // Crop-retry when the main pass misses the second fighter (common during crossing).
        // The dense boot pass has no realtime budget, so it retries on EVERY miss.
        if (!opts?.preScan && detectedPoses.length < 2) {
          if (opts?.densePass || wallNow - lastCropRetryWallMsRef.current >= perfForGap.cropRetryMinIntervalMs) {
            lastCropRetryWallMsRef.current = wallNow
            const secondPose = detectSecondFighter(detectSurface, detectedPoses[0] || null)
            if (secondPose) detectedPoses.push(secondPose)
          }
        }

        // Suppress duplicate detections of the SAME body BEFORE identity
        // assignment. During overlap, the main pass often returns the front
        // fighter twice; without this gate the duplicate claims the hidden
        // fighter's slot in the 2x2 assignment and drags that identity onto
        // the front fighter (the overlay only suppressed the *display*).
        const poses = dedupePoseCandidates(detectedPoses)

        if (opts?.preScan) {
          recordPreScanTrack(rawFrameTs, poses)
        }

        const trackingPrevA = lastRawLandmarksRef.current.A ?? smoothedLandmarksRef.current.A
        const trackingPrevB = lastRawLandmarksRef.current.B ?? smoothedLandmarksRef.current.B
        let { A: rawA, B: rawB } = opts?.preScan
          ? assignFightersByPosition(poses)
          : assignCornerIdentities(video, poses, wallNow, unifiedFrameTs)

        // Motion-based fallback is browser-only salvage — the verified offline
        // replay has no equivalent, and during the dense pass it can grab a
        // phantom (watermark / duplicate blob) that the claim gate correctly
        // rejected. Disabled there.
        if (!opts?.preScan && !opts?.densePass && !rawA && !rawB) {
          ;({ A: rawA, B: rawB } = assignFightersWithTracking(
            poses,
            trackingPrevA,
            trackingPrevB,
            previousRawLandmarksRef.current.A,
            previousRawLandmarksRef.current.B
          ))
        }

        // ─── Appearance reconciliation ──────────────────────────────────────
        // Motion-based assignment (above) cannot distinguish fighters during
        // full occlusion — position is identical, velocity is unreliable.
        // We sample an HSV histogram from each candidate's torso and override
        // the assignment when appearance strongly disagrees with motion.
        //
        // Caveat: `assignCornerIdentities` may return a *held-over* pose from
        // a previous frame (during short occlusion gaps). Those references
        // aren't in the current `poses[]` array, so findIndex returns -1.
        // We treat that as "no opinion this frame" and let motion stand.
        //
        // Skipped during pre-scan (we want positional baseline there) AND
        // during the dense pass — the verified offline replay excludes
        // appearance reconciliation, and mixed-clock tracker state from the
        // sparse pass can flap identities mid-track.
        if (!opts?.preScan && !opts?.densePass && poses.length > 0) {
          const tracker = getAppearanceTracker()
          let appearanceCorrected = false
          // Tracker creates and reuses its own scratch canvas internally.
          const candidateHists = tracker.sample(
            null as unknown as HTMLCanvasElement,
            video,
            poses
          )

          // Map current motion-based assignment back to candidate indices.
          // -1 (not in current poses[]) is treated as null = appearance abstains.
          const indexOrNull = (p: NormalizedLandmark[] | null): number | null => {
            if (!p) return null
            const i = poses.indexOf(p)
            return i >= 0 ? i : null
          }
          const motionAIdx = indexOrNull(rawA)
          const motionBIdx = indexOrNull(rawB)

          // Identity hysteresis: while the boxes overlap (approaching/merged)
          // the torso histograms sample mixed pixels — appearance evidence is
          // degraded exactly when it would be acted on. Freeze the labels
          // through the overlap window and only let appearance re-evaluate
          // identity at separation ('recovering') or in normal tracking.
          const phaseForAppearance = crossingPhaseRef.current
          const allowAppearanceOverride =
            phaseForAppearance === 'tracking' || phaseForAppearance === 'recovering'

          if (allowAppearanceOverride && tracker.isReady() && motionAIdx !== null && motionBIdx !== null) {
            const scores = tracker.score(candidateHists)
            const swap = tracker.suggestSwap(scores, motionAIdx, motionBIdx)
            if (swap && swap.aIndex !== null && swap.bIndex !== null) {
              // Appearance strongly disagrees with motion — override.
              rawA = poses[swap.aIndex] ?? null
              rawB = poses[swap.bIndex] ?? null
              appearanceCorrected = true
            }
          }

          if (appearanceCorrected) {
            syncCornerIdentitySlot(video, 'A', rawA, wallNow)
            syncCornerIdentitySlot(video, 'B', rawB, wallNow)
            identitySwapStreakRef.current = 0
          }

          // Commit fingerprints with the FINAL (possibly corrected) assignment.
          // Only commit when the assigned pose is one of the current candidates;
          // a held-over pose has no fresh histogram to learn from. Learning is
          // disabled while a crossing is in progress so overlapped (mixed-pixel)
          // histograms never contaminate a fighter's stored fingerprint/bank.
          tracker.commit(
            candidateHists,
            indexOrNull(rawA),
            indexOrNull(rawB),
            wallNow,
            { allowLearn: phaseForAppearance === 'tracking' }
          )
        }

        // Identity is handled by the corner-aware tracker first, then by the
        // cost-min tracker as a fallback when the corner lock has no answer.
        // Appearance reconciles the result against visual fingerprints.

        // ─── Crop-zoom landmark refinement ──────────────────────────────────
        // The full-frame pass sees each fighter at maybe 200px tall; hands and
        // feet wobble at that scale. Re-detecting on a padded crop around the
        // assigned pose gives the model ~4x the pixels per body and produces
        // dramatically tighter landmarks. Identity is NOT re-decided here —
        // we only replace the landmark geometry, and only when the refined
        // pose is clearly the same body (anchor within 0.06 of the original).
        // Skipped while fighters overlap (the crop would contain both bodies)
        // and rate-limited per performance tier. The dense boot pass runs this
        // on EVERY frame (rate limit waived below) for offline-grade tightness.
        if (!opts?.preScan && perfForGap.refineMinIntervalMs > 0 && crossingPhaseRef.current === 'tracking') {
          const retry = retryLandmarkerRef.current
          const boxOf = (p: NormalizedLandmark[]) => {
            const vis = p.filter((lm) => (lm.visibility ?? 1) > 0.3)
            if (vis.length < 6) return null
            return {
              left: Math.min(...vis.map((l) => l.x)),
              top: Math.min(...vis.map((l) => l.y)),
              right: Math.max(...vis.map((l) => l.x)),
              bottom: Math.max(...vis.map((l) => l.y)),
            }
          }
          const boxA = rawA ? boxOf(rawA) : null
          const boxB = rawB ? boxOf(rawB) : null
          const boxesOverlap =
            boxA && boxB
              ? Math.max(0, Math.min(boxA.right, boxB.right) - Math.max(boxA.left, boxB.left)) > 0 &&
                Math.max(0, Math.min(boxA.bottom, boxB.bottom) - Math.max(boxA.top, boxB.top)) > 0
              : false
          if (retry && !boxesOverlap) {
            const refineSlot = (key: 'A' | 'B', raw: NormalizedLandmark[] | null, box: { left: number; top: number; right: number; bottom: number } | null) => {
              if (!raw || !box) return raw
              if (!opts?.densePass && wallNow - lastRefineWallMsRef.current[key] < perfForGap.refineMinIntervalMs) return raw
              // Box must be small enough that zooming actually helps.
              if (box.right - box.left > 0.6 || box.bottom - box.top > 0.85) return raw
              lastRefineWallMsRef.current[key] = wallNow
              if (!refineCanvasRef.current[key]) refineCanvasRef.current[key] = document.createElement('canvas')
              const refined = detectInRegion(retry, detectSurface, box, refineCanvasRef.current[key]!)
              if (!refined) return raw
              const a0 = getPoseAnchor(raw)
              const a1 = getPoseAnchor(refined)
              if (!a0 || !a1 || Math.hypot(a0.x - a1.x, a0.y - a1.y) > 0.06) return raw
              return refined
            }
            // Detector fusion: on the dense boot pass, when the RTMPose flag is
            // on AND the model is ready, refine each fighter with RTMPose (better
            // on small/blurry/occluded crops), falling back to MediaPipe when
            // RTMPose returns nothing. Flag off / live path keeps the exact
            // synchronous MediaPipe refine below — no behavior change, no await.
            const useRtm = !!opts?.densePass && rtmposeRequested() && isRtmposeReady()
            if (useRtm) {
              const refineSlotRtm = async (
                key: 'A' | 'B',
                raw: NormalizedLandmark[] | null,
                box: { left: number; top: number; right: number; bottom: number } | null
              ) => {
                if (!raw || !box) return raw
                if (box.right - box.left > 0.6 || box.bottom - box.top > 0.85) return raw
                lastRefineWallMsRef.current[key] = wallNow
                if (!refineCanvasRef.current[key]) refineCanvasRef.current[key] = document.createElement('canvas')
                let refined = await rtmposeInRegionAsync(detectSurface, box, refineCanvasRef.current[key]!)
                if (!refined) refined = detectInRegion(retry, detectSurface, box, refineCanvasRef.current[key]!)
                if (!refined) return raw
                const a0 = getPoseAnchor(raw)
                const a1 = getPoseAnchor(refined)
                if (!a0 || !a1 || Math.hypot(a0.x - a1.x, a0.y - a1.y) > 0.06) return raw
                return refined
              }
              if (rawA) rawA = await refineSlotRtm('A', rawA, boxA)
              if (rawB) rawB = await refineSlotRtm('B', rawB, boxB)
            } else {
              if (rawA) rawA = refineSlot('A', rawA, boxA)
              if (rawB) rawB = refineSlot('B', rawB, boxB)
            }
          }
        }

        const holdMs = crossingHoldMs(crossingPhaseRef.current, poses.length)
        const lastSeen = lastPoseSeenRef.current

        // Re-acquisition reset.
        // If MediaPipe re-detects a fighter after the hold window expired,
        // the cached anchors (lastRaw, previousRaw, smoothed) point at a stale
        // location. Smoothing the new pose against that stale anchor produces
        // a 1–3 frame "drag" toward the old position right at the moment the
        // user is watching for clean recovery. We null those anchors so the
        // first re-acquired frame is taken as-is, then smoothing resumes.
        const reAcquiredA =
          rawA && (lastSeen.A === null || wallNow - lastSeen.A > holdMs)
        const reAcquiredB =
          rawB && (lastSeen.B === null || wallNow - lastSeen.B > holdMs)
        if (reAcquiredA) {
          lastRawLandmarksRef.current.A = null
          previousRawLandmarksRef.current.A = null
          smoothedLandmarksRef.current.A = null
        }
        if (reAcquiredB) {
          lastRawLandmarksRef.current.B = null
          previousRawLandmarksRef.current.B = null
          smoothedLandmarksRef.current.B = null
        }

        if (rawA) lastSeen.A = wallNow
        if (rawB) lastSeen.B = wallNow

        // Occlusion bridge — a fighter can be briefly lost while hidden behind
        // the opponent during a crossing the phase machine didn't flag (detection
        // variance, or the containment dedupe rejecting the overlapped box). If
        // it was last seen MID-FRAME (not exiting via an edge) and the other
        // fighter IS present, treat it as occluded: extend the hold and allow
        // coasting so it bridges the gap instead of dropping to a null/ghost.
        // A fighter that left via a frame edge stays un-bridged (clean exit).
        const OCCLUSION_BRIDGE_MS = 1000
        const lastSeenMidFrame = (p: NormalizedLandmark[] | null) => {
          if (!p) return false
          const a = getPoseAnchor(p)
          return !!a && a.x > 0.08 && a.x < 0.92 && a.y > 0.05 && a.y < 0.95
        }
        const occludedA = !rawA && Boolean(rawB) && lastSeenMidFrame(smoothedLandmarksRef.current.A)
        const occludedB = !rawB && Boolean(rawA) && lastSeenMidFrame(smoothedLandmarksRef.current.B)
        const holdA = occludedA ? Math.max(holdMs, OCCLUSION_BRIDGE_MS) : holdMs
        const holdB = occludedB ? Math.max(holdMs, OCCLUSION_BRIDGE_MS) : holdMs
        const keepA = !rawA && lastSeen.A !== null && wallNow - lastSeen.A < holdA
        const keepB = !rawB && lastSeen.B !== null && wallNow - lastSeen.B < holdB

        // Velocity-based extrapolation during hold: instead of freezing the
        // skeleton at its last known position (which looks "stuck" and then
        // snaps on reacquisition), nudge it in the direction it was moving.
        // This is a lightweight Kalman-like prediction that keeps the skeleton
        // visually plausible during occlusion. The nudge decays over time so
        // it doesn't drift too far if the hold lasts longer than expected.
        // Only coast while a crossing is in progress — that is when the hidden
        // fighter is genuinely moving behind the opponent. During normal
        // tracking a missed detection is noise; coasting on velocity made the
        // skeleton visibly sail off the body, so we freeze in place instead.
        // Coast ONLY during a flagged crossing (the hidden fighter is genuinely
        // moving behind the opponent, roughly in place). An occlusion-bridged or
        // exiting fighter must FREEZE, never coast — velocity extrapolation on a
        // fighter who is actually leaving frame marches the collapsing skeleton
        // off into a corner ("exploding off"). The bridge still keeps the slot
        // alive via its extended hold above; it just holds position instead.
        const coastingOk = isCrossingPhase(crossingPhaseRef.current)
        if (coastingOk && keepA && !rawA && smoothedLandmarksRef.current.A) {
          const vel = velocityRef.current.A
          const elapsed = wallNow - (lastSeen.A ?? wallNow)
          // Decay factor: full velocity for first 200ms, then linearly decay to 0 by holdMs
          const decay = Math.max(0, 1 - Math.max(0, elapsed - 200) / (holdMs - 200))
          if (Math.hypot(vel.vx, vel.vy) > 0.002 && decay > 0) {
            const nudged = smoothedLandmarksRef.current.A.map(lm => ({
              ...lm,
              x: Math.max(0, Math.min(1, lm.x + vel.vx * decay * 0.5)),
              y: Math.max(0, Math.min(1, lm.y + vel.vy * decay * 0.5)),
            })) as NormalizedLandmark[]
            smoothedLandmarksRef.current = { ...smoothedLandmarksRef.current, A: nudged }
          }
        }
        if (coastingOk && keepB && !rawB && smoothedLandmarksRef.current.B) {
          const vel = velocityRef.current.B
          const elapsed = wallNow - (lastSeen.B ?? wallNow)
          const decay = Math.max(0, 1 - Math.max(0, elapsed - 200) / (holdMs - 200))
          if (Math.hypot(vel.vx, vel.vy) > 0.002 && decay > 0) {
            const nudged = smoothedLandmarksRef.current.B.map(lm => ({
              ...lm,
              x: Math.max(0, Math.min(1, lm.x + vel.vx * decay * 0.5)),
              y: Math.max(0, Math.min(1, lm.y + vel.vy * decay * 0.5)),
            })) as NormalizedLandmark[]
            smoothedLandmarksRef.current = { ...smoothedLandmarksRef.current, B: nudged }
          }
        }

        const smoothAlpha = crossingSmoothAlpha(crossingPhaseRef.current)
        const landmarksA = rawA
          ? smoothLandmarks(rawA, lastRawLandmarksRef.current.A ?? smoothedLandmarksRef.current.A, smoothAlpha)
          : keepA
            ? smoothedLandmarksRef.current.A
            : null
        const landmarksB = rawB
          ? smoothLandmarks(rawB, lastRawLandmarksRef.current.B ?? smoothedLandmarksRef.current.B, smoothAlpha)
          : keepB
            ? smoothedLandmarksRef.current.B
            : null
        if (rawA) {
          // Update velocity estimate for Fighter A before overwriting the ref.
          // This velocity is used for occlusion prediction and identity recovery.
          if (lastRawLandmarksRef.current.A) {
            velocityRef.current.A = getTorsoVelocity(rawA, lastRawLandmarksRef.current.A)
          }
          previousRawLandmarksRef.current.A = lastRawLandmarksRef.current.A
          lastRawLandmarksRef.current.A = rawA
        }
        if (rawB) {
          if (lastRawLandmarksRef.current.B) {
            velocityRef.current.B = getTorsoVelocity(rawB, lastRawLandmarksRef.current.B)
          }
          previousRawLandmarksRef.current.B = lastRawLandmarksRef.current.B
          lastRawLandmarksRef.current.B = rawB
        }

        smoothedLandmarksRef.current = { A: landmarksA, B: landmarksB }

        // Dense boot pass: record the finished (refined + identity-stable +
        // smoothed) frame into the cached track instead of driving the overlay.
        if (opts?.densePass) {
          denseTrackRef.current.push({
            tMs: Math.round(unifiedFrameTs),
            A: landmarksA,
            B: landmarksB,
          })
          return
        }

        // Pre-scan seeks to ~24 random positions across the clip before the
        // user presses play. The overlay callbacks below drive the on-screen
        // skeleton via `latestPose` / `latestPoseVideoTimeMsRef`, so firing
        // them during pre-scan pushes poses from random timestamps into the
        // overlay — the skeleton jumps to a pose sampled at 12s while the
        // video is displaying a frame at 3s, which looks like "bouncing".
        // Pre-scan has its own dedicated `onPreScanFrame` callback; the three
        // overlay callbacks must only fire on real playback / scrub frames.
        if (opts?.preScan) {
          onPreScanPoseDetectedRef.current?.({ A: Boolean(landmarksA), B: Boolean(landmarksB) })
          return
        }

        onPoseVideoTime?.(Math.round(unifiedFrameTs))
        onPose?.({ A: landmarksA, B: landmarksB })
        onPoseDetected?.({ A: Boolean(landmarksA), B: Boolean(landmarksB) })

        const timestampMs = Date.now()
        if (landmarksA) {
          poseHistoryRef.current.A = pruneHistory([...poseHistoryRef.current.A, { landmarks: landmarksA, timestampMs }])
        }
        if (landmarksB) {
          poseHistoryRef.current.B = pruneHistory([...poseHistoryRef.current.B, { landmarks: landmarksB, timestampMs }])
        }

        const kinGap = 100
        if (onKinematics && wallNow - lastKinematicsMsRef.current > kinGap) {
          lastKinematicsMsRef.current = wallNow
          const snapshot = computeKinematicsSnapshot(
            poseHistoryRef.current,
            typeof video.currentTime === 'number' ? video.currentTime : null,
            Math.max(1, video.videoWidth || 1)
          )
          onKinematics(snapshot)
        }

        if (onFrameEvidence) {
          const evidence = buildFightLangFrameEvidence({
            tMs: timestampMs,
            videoTimeSec: typeof video.currentTime === 'number' ? video.currentTime : null,
            A: landmarksA,
            B: landmarksB,
          })
          onFrameEvidence(evidence)
        }
      } catch (err) {
        // MediaPipe WASM can throw on corrupt frames or during teardown — log once, don't flood.
        if (typeof err === 'object' && err !== null && 'message' in err) {
          const msg = String((err as Error).message || '')
          if (msg.includes('timestamp') || msg.includes('Graph has errors')) {
            // Known MediaPipe timestamp issue — already guarded above, skip silently
          } else {
            console.warn('[FightAnalyzer] pose detection error:', msg)
          }
        }
      }
    },
    [
      detectSecondFighter,
      assignCornerIdentities,
      syncCornerIdentitySlot,
      recordPreScanTrack,
      onFrameEvidence,
      onKinematics,
      onPose,
      onPoseVideoTime,
      onPoseDetected,
      videoRef,
    ]
  )

  const processPoseFrameRef = useRef(processPoseFrame)
  processPoseFrameRef.current = processPoseFrame

  /**
   * Replay one frame from the cached dense track. Returns true when a sample
   * close enough to the displayed frame existed and was emitted — the caller
   * then skips live detection entirely (offline-grade landmarks, zero
   * per-frame inference cost). Returns false to fall back to live detection
   * (track not ready, or playhead outside the cached range).
   */
  const replayDenseFrame = useCallback(
    (mediaTimeMs: number): boolean => {
      if (process.env.NODE_ENV !== 'production') {
        const dbg = window as unknown as { __replayCalls?: number }
        dbg.__replayCalls = (dbg.__replayCalls ?? 0) + 1
      }
      if (!denseTrackReadyRef.current) return false
      const track = denseTrackRef.current
      if (track.length === 0) return false

      // Binary search for the bracketing samples around the displayed frame.
      let lo = 0
      let hi = track.length - 1
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (track[mid].tMs < mediaTimeMs) lo = mid + 1
        else hi = mid
      }

      let prevIndex = lo
      if (track[prevIndex].tMs > mediaTimeMs && prevIndex > 0) {
        prevIndex -= 1
      }
      const prevSample = track[prevIndex]
      const nextSample = prevIndex + 1 < track.length ? track[prevIndex + 1] : null
      const nearestMs = nextSample
        ? Math.abs(prevSample.tMs - mediaTimeMs) <= Math.abs(nextSample.tMs - mediaTimeMs)
          ? prevSample.tMs
          : nextSample.tMs
        : prevSample.tMs
      if (Math.abs(nearestMs - mediaTimeMs) > DENSE_TRACK_TOLERANCE_MS) return false

      let A: NormalizedLandmark[] | null = prevSample.A
      let B: NormalizedLandmark[] | null = prevSample.B
      if (nextSample && nextSample.tMs > prevSample.tMs) {
        const gap = nextSample.tMs - prevSample.tMs
        const blendU = gap > 0 ? clamp01((mediaTimeMs - prevSample.tMs) / gap) : 0
        if (blendU > 0) {
          A = blendPoses(prevSample.A, nextSample.A, blendU)
          B = blendPoses(prevSample.B, nextSample.B, blendU)
        }
      }

      // An empty cached sample must NOT blank the screen — fall back to live
      // detection for this frame instead of suppressing it. (Cached gaps come
      // from pruned ghosts or hold expiries; live detection may still see a
      // fighter there, and the pre-dense behavior is the floor, never worse.)
      if (!A && !B) return false
      if (process.env.NODE_ENV !== 'production') {
        const dbg = window as unknown as { __replayEmits?: number }
        dbg.__replayEmits = (dbg.__replayEmits ?? 0) + 1
      }

      // Emit the displayed RVFC media time (rounded), not the cached sample
      // timestamp, so overlay history lookup stays aligned with the frame on screen.
      onPoseVideoTime?.(Math.round(mediaTimeMs))
      onPose?.({ A, B })
      onPoseDetected?.({ A: Boolean(A), B: Boolean(B) })

      const timestampMs = Date.now()
      if (A) {
        poseHistoryRef.current.A = pruneHistory([...poseHistoryRef.current.A, { landmarks: A, timestampMs }])
      }
      if (B) {
        poseHistoryRef.current.B = pruneHistory([...poseHistoryRef.current.B, { landmarks: B, timestampMs }])
      }

      const wallNow = performance.now()
      const video = videoRef.current
      if (onKinematics && video && wallNow - lastKinematicsMsRef.current > 100) {
        lastKinematicsMsRef.current = wallNow
        onKinematics(
          computeKinematicsSnapshot(
            poseHistoryRef.current,
            typeof video.currentTime === 'number' ? video.currentTime : null,
            Math.max(1, video.videoWidth || 1)
          )
        )
      }
      if (onFrameEvidence) {
        onFrameEvidence(
          buildFightLangFrameEvidence({
            tMs: timestampMs,
            videoTimeSec: mediaTimeMs / 1000,
            A,
            B,
          })
        )
      }
      return true
    },
    [onPose, onPoseVideoTime, onPoseDetected, onKinematics, onFrameEvidence, videoRef]
  )
  const replayDenseFrameRef = useRef(replayDenseFrame)
  replayDenseFrameRef.current = replayDenseFrame

  // Uses setTimeout instead of requestAnimationFrame so we only wake the main thread
  // when we actually want to process a frame (~75ms intervals). RAF would fire 60 times/sec
  // even though we only need ~13 frames — the wasted calls steal decode time from the video
  // element and cause stuttering/freezing. setTimeout yields the main thread to video decode,
  // rendering, and user interaction between ticks.
  // Rolling-average frame budget. If pose detection consistently overruns,
  // we auto-throttle up to 2× the base interval. Keeps the browser responsive
  // on thin laptops (Zenbook-class) without sacrificing skeleton rendering.
  // Budget raised from 90 → 120ms and window from 8 → 12: skeleton was backing
  // off too eagerly on brief CPU hiccups, which made tracking fall behind. Now
  // we only throttle if sustained load pushes avg > 120ms (≈8 Hz).
  const frameBudgetRef = useRef<FrameBudget>(new FrameBudget(120, 12))
  const tick = useCallback(() => {
    const video = videoRef.current
    if (!video || video.paused || video.ended) {
      rafRef.current = null
      return
    }
    const perf = getPerformanceProfile()
    // Dense replay (setTimeout fallback path): cached track wins over live detection.
    if (typeof video.currentTime === 'number' && replayDenseFrameRef.current(video.currentTime * 1000)) {
      rafRef.current = window.setTimeout(tick, perf.poseIntervalMs) as unknown as number
      return
    }
    const t0 = performance.now()
    const mediaTimeMs =
      typeof video.currentTime === 'number' && Number.isFinite(video.currentTime)
        ? video.currentTime * 1000
        : undefined
    // Wrap in try/catch so a single frame-level exception (e.g. transient
    // MediaPipe error, WebGL loss) doesn't leak the setTimeout chain — which
    // would cause duplicate tick loops when the next play event re-enters.
    try {
      processPoseFrameRef.current(
        mediaTimeMs != null ? { mediaPipeTimestampMs: mediaTimeMs } : undefined
      )
    } catch (e) {
      console.warn('[FightAnalyzer] tick error:', e)
    }
    const dt = performance.now() - t0
    frameBudgetRef.current.record(dt)
    // Base interval from profile; if we're sustained over budget, back off
    // by only 1.10× (was 1.25×). Even mild backoff visibly slows tracking,
    // and the 120ms FrameBudget already has slack — only sustained heavy
    // overruns should slow us, and even then only marginally.
    const base = perf.poseIntervalMs
    const interval = frameBudgetRef.current.overBudget() ? Math.round(base * 1.10) : base
    rafRef.current = window.setTimeout(tick, interval) as unknown as number
  }, [videoRef])

  // requestVideoFrameCallback (RVFC) tick — fires exactly when the browser is
  // about to composite a new video frame. This eliminates setTimeout phase drift
  // (where we'd detect on a frame that's up to 90 ms older than what the user
  // sees) and gives us the exact frame media-time to use as the MediaPipe
  // timestamp. Net effect: skeleton is glued to the frame being displayed,
  // not a random past frame.
  //
  // We still honor the performance-tier poseIntervalMs: RVFC fires at the
  // video's frame rate (often 30–60 Hz), but on lite tier we only want ~11 Hz.
  // So we skip frames until enough wall time has elapsed since the last pose.
  const videoFrameTick = useCallback(
    (now: number, metadata: { mediaTime: number; presentedFrames?: number }) => {
      if (process.env.NODE_ENV !== 'production') {
        const dbg = window as unknown as { __rvfcTicks?: number }
        dbg.__rvfcTicks = (dbg.__rvfcTicks ?? 0) + 1
      }
      const video = videoRef.current
      if (!video) {
        rvfcHandleRef.current = null
        return
      }
      if (video.paused || video.ended) {
        rvfcHandleRef.current = null
        return
      }

      // Dense replay: when the boot pass cached a full-quality track for this
      // clip, render the cached frame and skip live detection entirely.
      if (replayDenseFrameRef.current(metadata.mediaTime * 1000)) {
        const vDense = video as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: typeof videoFrameTick) => number
        }
        rvfcHandleRef.current =
          typeof vDense.requestVideoFrameCallback === 'function'
            ? vDense.requestVideoFrameCallback(videoFrameTick)
            : null
        return
      }

      const perf = getPerformanceProfile()
      // RVFC passes wall `now` (DOMHighResTimeStamp). Compare only to wall refs —
      // `lastPoseMsRef` is video media ms from processPoseFrame and must never
      // be subtracted from `now` (that made the outer gate always "open" and
      // broke over-budget backoff).
      const elapsed = now - lastRvfcPoseWallMsRef.current
      const budget = frameBudgetRef.current
      const overBudget = budget.overBudget()
      // Under sustained CPU load, multiply target interval by 1.10× (matches the
      // setTimeout fallback behavior). Otherwise fire as soon as target interval
      // elapsed. Tighter backoff keeps the skeleton glued to the fighter even
      // under load — at 1.25× the cadence drop was visible as trailing.
      const targetInterval = overBudget ? perf.poseIntervalMs * 1.10 : perf.poseIntervalMs

      if (elapsed >= targetInterval - 4) {
        lastRvfcPoseWallMsRef.current = now
        const t0 = performance.now()
        try {
          processPoseFrameRef.current({
            // mediaTime is in SECONDS. Convert to ms for MediaPipe. Multiply by
            // 1000 (not 1_000_000 — MediaPipe wants milliseconds).
            mediaPipeTimestampMs: metadata.mediaTime * 1000,
          })
        } catch (e) {
          console.warn('[FightAnalyzer] RVFC tick error:', e)
        }
        budget.record(performance.now() - t0)
      }

      // Schedule next RVFC. We do this unconditionally (even when we skipped
      // processing) so we stay synced to future frames.
      const v = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (cb: typeof videoFrameTick) => number
      }
      if (typeof v.requestVideoFrameCallback === 'function') {
        rvfcHandleRef.current = v.requestVideoFrameCallback(videoFrameTick)
      } else {
        rvfcHandleRef.current = null
      }
    },
    [videoRef]
  )

  // Paused seek pass: fill pose + FightLang buffers before first play (models load in parallel with decode).
  useEffect(() => {
    const video = videoRef.current
    if (!video || !enabled || !preScanOnLoad) return

    const resetKey = preScanResetKey ?? ''
    if (preScanResetKeyPrevRef.current !== resetKey) {
      preScanResetKeyPrevRef.current = resetKey
      preScanDoneForSrcRef.current = null
    }

    let cancelled = false
    let kickoffStarted = false

    const runPreScan = async () => {
      const signalComplete = () => {
        onPreScanCompleteRef.current?.()
      }

      if (cancelled) {
        signalComplete()
        return
      }
      await waitUntilHaveCurrentData(video, () => cancelled)
      if (cancelled) {
        signalComplete()
        return
      }

      const dur = video.duration
      if (!Number.isFinite(dur) || dur <= 0 || dur > 7200) {
        signalComplete()
        return
      }

      const clipKey =
        resetKey.trim() || (video.currentSrc || video.src || '').trim()
      if (!clipKey || preScanDoneForSrcRef.current === clipKey) {
        signalComplete()
        return
      }

      try {
        await initPoseLandmarker()
      } catch {
        signalComplete()
        return
      }
      if (cancelled) {
        signalComplete()
        return
      }

      let mpTs = performance.now()
      const durMs = Math.round(dur * 1000)
      const steps = Math.min(PRESCAN_MAX_SEEKS, Math.max(1, Math.ceil(durMs / 100)))
      const restoreTime = video.currentTime
      const passes = Math.max(1, Math.min(5, preScanPasses))

      onPreScanActiveChangeRef.current?.(true)
      preScanActiveRef.current = true
      preScanTrackRef.current = []
      denseTrackRef.current = []
      denseTrackReadyRef.current = false
      const abortOnPlay = () => {
        cancelled = true
      }
      video.addEventListener('play', abortOnPlay)

      try {
        for (let pass = 0; pass < passes; pass++) {
          if (cancelled) break
          for (let i = 0; i < steps; i++) {
            if (cancelled) break
            const tMs = steps <= 1 ? 0 : Math.round((i / (steps - 1)) * durMs)
            await seekVideoAndWait(video, tMs / 1000)
            if (cancelled) break

            smoothedLandmarksRef.current = { A: null, B: null }
            lastRawLandmarksRef.current = { A: null, B: null }
            previousRawLandmarksRef.current = { A: null, B: null }
            lastPoseSeenRef.current = { A: null, B: null }
            mpTs += 33
            processPoseFrameRef.current({
              skipThrottle: true,
              preScan: true,
              mediaPipeTimestampMs: mpTs,
            })
            await Promise.resolve(
              onPreScanFrameRef.current?.({
                passIndex: pass,
                passCount: passes,
                stepIndex: i,
                totalSteps: steps,
                videoTimeSec: typeof video.currentTime === 'number' ? video.currentTime : 0,
              })
            )
          }
        }

        // ── Dense full-quality pass ─────────────────────────────────────
        // Step the whole clip in order through the FULL pipeline with no
        // realtime limits (refinement + crop-retry on every frame) and cache
        // the finished track. Playback replays this cache — the same regime
        // as the offline eval harness behind the quality baseline.
        if (!cancelled && durMs <= DENSE_TRACK_MAX_DURATION_MS) {
          const stepMs = Math.max(DENSE_TRACK_MIN_STEP_MS, Math.ceil(durMs / DENSE_TRACK_MAX_SAMPLES))
          const denseSteps = Math.max(1, Math.floor(durMs / stepMs))

          // Opt-in cloud dense pass (?poseBackend=cloud): offload detection +
          // RTMPose to the GPU server (cloud/modal_app.py via the Next proxy),
          // replay the returned candidates through the on-device identity
          // tracker, and cache under a 'cloud-rtmpose' namespace. Returns false
          // — so the local pass below runs — when the flag is off OR the cloud
          // call fails, so the working on-device path can never regress.
          const tryCloudDensePass = async (): Promise<boolean> => {
            const cloudOptions = getCloudPoseOptions()
            if (!cloudOptions) return false
            const cloudKey = denseTrackKey(video, stepMs, `cloud-${cloudOptions.target}-${cloudOptions.mode}`)
            const cloudCached = (await loadDenseTrack(cloudKey)) as DenseTrackSample[] | null
            let track: DenseTrackSample[] | null =
              cloudCached && cloudCached.length > 0 ? cloudCached : null
            if (!track) {
              const result = await fetchCloudDenseTrack({
                videoUrl: video.currentSrc || video.src,
                mode: cloudOptions.mode,
                target: cloudOptions.target,
              })
              if (result && result.track.length > 0) {
                track = result.track
                void saveDenseTrack(cloudKey, stepMs, track)
              }
            }
            if (!track || track.length === 0 || cancelled) return false
            denseTrackRef.current = pruneGhostRuns(track)
            denseTrackReadyRef.current = true
            onDenseTrackReadyRef.current?.(track.length)
            if (process.env.NODE_ENV !== 'production') {
              ;(window as unknown as { __denseTrack?: DenseTrackSample[] }).__denseTrack = track
            }
            publishDenseTrackForQa(track, stepMs)
            console.log(
              `[DenseTrack] cloud ${cloudOptions.target}/${cloudOptions.mode} - ${track.length} frames`
            )
            return true
          }

          const cloudRequested = cloudPoseRequested()

          // The pass is deterministic per clip and costs minutes — restore
          // from the IndexedDB cache when this clip was analyzed before.
          const cacheKey = denseTrackKey(video, stepMs, rtmposeRequested() ? 'rtmpose' : 'mediapipe')
          const cached = cloudRequested
            ? null
            : (await loadDenseTrack(cacheKey)) as DenseTrackSample[] | null
          if (cached && cached.length >= denseSteps * 0.5 && !cancelled) {
            denseTrackRef.current = pruneGhostRuns(cached)
            denseTrackReadyRef.current = true
            onDenseTrackReadyRef.current?.(cached.length)
            console.log(`[DenseTrack] restored from cache — ${cached.length} frames (skipping deep pass)`)
            if (process.env.NODE_ENV !== 'production') {
              ;(window as unknown as { __denseTrack?: DenseTrackSample[] }).__denseTrack = cached
            }
            publishDenseTrackForQa(cached, stepMs)
          } else if (await tryCloudDensePass()) {
            // Cloud dense pass populated the track above; skip the local pass.
          } else if (!cancelled) {
          denseTrackRef.current = []
          denseTrackReadyRef.current = false
          densePassActiveRef.current = true
          // Sequential pipeline state must start clean (the sparse pass above
          // seeks random positions and resets per-seek; this pass is ordered).
          // The long-term appearance profiles ALSO reset — the sparse pass
          // labels fighters positionally and its profiles can be swapped,
          // which would poison the dense pass's crossing locks.
          smoothedLandmarksRef.current = { A: null, B: null }
          lastRawLandmarksRef.current = { A: null, B: null }
          previousRawLandmarksRef.current = { A: null, B: null }
          lastPoseSeenRef.current = { A: null, B: null }
          identitySlotsRef.current = { A: null, B: null }
          identityProfilesRef.current = {
            A: { color: null, scale: null, samples: 0 },
            B: { color: null, scale: null, samples: 0 },
          }
          velocityRef.current = { A: { vx: 0, vy: 0 }, B: { vx: 0, vy: 0 } }
          identitySwapStreakRef.current = 0
          identityOcclusionUntilRef.current = 0
          crossingPhaseRef.current = 'tracking'
          crossingRecoveryStableRef.current = 0
          crossingLockKeyRef.current = null
          for (let i = 0; i < denseSteps; i++) {
            if (cancelled) break
            const tMs = Math.min(Math.max(0, durMs - 1), i * stepMs)
            await seekVideoAndWait(video, tMs / 1000)
            if (cancelled) break
            await processPoseFrameRef.current({
              skipThrottle: true,
              densePass: true,
              mediaPipeTimestampMs: tMs,
            })
            await Promise.resolve(
              onPreScanFrameRef.current?.({
                passIndex: passes,
                passCount: passes + 1,
                stepIndex: i,
                totalSteps: denseSteps,
                videoTimeSec: typeof video.currentTime === 'number' ? video.currentTime : 0,
              })
            )
          }
          densePassActiveRef.current = false
          if (!cancelled && denseTrackRef.current.length >= denseSteps * 0.5) {
            // Persist the RAW track; pruning is display-policy and happens at
            // use time, so a too-aggressive pruner can never poison the cache.
            void saveDenseTrack(cacheKey, stepMs, denseTrackRef.current)
            denseTrackRef.current = pruneGhostRuns(denseTrackRef.current)
            denseTrackReadyRef.current = true
            onDenseTrackReadyRef.current?.(denseTrackRef.current.length)
            console.log(
              `[DenseTrack] ready — ${denseTrackRef.current.length} frames @ ${stepMs}ms step (offline-grade replay active)`
            )
            if (process.env.NODE_ENV !== 'production') {
              ;(window as unknown as { __denseTrack?: DenseTrackSample[] }).__denseTrack = denseTrackRef.current
            }
            publishDenseTrackForQa(denseTrackRef.current, stepMs)
          }
          }
        }
      } finally {
        densePassActiveRef.current = false
        preScanActiveRef.current = false
        video.removeEventListener('play', abortOnPlay)
        try {
          if (!cancelled) {
            await seekVideoAndWait(video, restoreTime)
            preScanDoneForSrcRef.current = clipKey
          } else if (video.paused) {
            try {
              await seekVideoAndWait(video, restoreTime)
            } catch {
              void 0
            }
          }
        } finally {
          // Pre-scan done — reset throttle cursor so the first playback
          // frame isn't blocked by a stale value. Timestamps are now driven
          // by the simple monotonic `Math.max(rawTs, lastTs + 1)` in
          // processPoseFrame, so no offset bookkeeping is needed here.
          lastPoseMsRef.current = 0
          smoothedLandmarksRef.current = { A: null, B: null }
          lastRawLandmarksRef.current = { A: null, B: null }
          previousRawLandmarksRef.current = { A: null, B: null }
          identitySlotsRef.current = { A: null, B: null }
          identitySwapStreakRef.current = 0
          identityOcclusionUntilRef.current = 0
          crossingPhaseRef.current = 'tracking'
          crossingRecoveryStableRef.current = 0
          crossingLockKeyRef.current = null
          lastPoseSeenRef.current = { A: null, B: null }
          onPreScanActiveChangeRef.current?.(false)
          signalComplete()
        }
      }
    }

    const tryKickoff = () => {
      if (cancelled || kickoffStarted) return
      if (!Number.isFinite(video.duration) || video.duration <= 0 || video.duration > 7200) return
      kickoffStarted = true
      video.removeEventListener('loadedmetadata', tryKickoff)
      void runPreScan()
    }

    video.addEventListener('loadedmetadata', tryKickoff)
    queueMicrotask(() => tryKickoff())
    requestAnimationFrame(() => tryKickoff())

    // Deep-pass resume: pressing play mid-pass aborts the boot pass (its seeks
    // would hijack live viewing) — but a silent abort used to strand the clip
    // on weak live tracking ("only 24 frames") with no way back. When the user
    // pauses or the clip ends and the dense track never finished, re-run the
    // pass automatically.
    const resumeIfIncomplete = () => {
      if (preScanActiveRef.current) return
      if (denseTrackReadyRef.current) return
      const clipKey = (preScanResetKey ?? '').trim() || (video.currentSrc || video.src || '').trim()
      if (!clipKey || preScanDoneForSrcRef.current === clipKey) return
      cancelled = false
      kickoffStarted = false
      tryKickoff()
    }
    video.addEventListener('pause', resumeIfIncomplete)
    video.addEventListener('ended', resumeIfIncomplete)

    // Self-heal watchdog: whatever load flow brought the clip in (upload,
    // fixture, restored session) and whatever interrupted the pass, if the
    // deep track is missing while the video sits idle, start the pass. This
    // is what guarantees "Deep tracking" actually runs for every clip.
    const healTimer = window.setInterval(() => {
      if (!video.paused) return
      resumeIfIncomplete()
    }, 5000)

    return () => {
      cancelled = true
      window.clearInterval(healTimer)
      video.removeEventListener('loadedmetadata', tryKickoff)
      video.removeEventListener('pause', resumeIfIncomplete)
      video.removeEventListener('ended', resumeIfIncomplete)
    }
  }, [enabled, preScanOnLoad, preScanResetKey, preScanPasses, videoRef, initPoseLandmarker])

  // Start/stop pose-tick loop based on video state.
  // Uses requestVideoFrameCallback (when available) so detection fires on
  // actual video frames — no setTimeout phase drift. Falls back to setTimeout
  // on browsers without RVFC (older Firefox, old Safari).
  useEffect(() => {
    const video = videoRef.current
    if (!video || !enabled) return

    const v = video as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: typeof videoFrameTick) => number
      cancelVideoFrameCallback?: (handle: number) => void
    }
    const hasRvfc = typeof v.requestVideoFrameCallback === 'function'

    const clearLoops = () => {
      if (rafRef.current != null) {
        clearTimeout(rafRef.current)
        rafRef.current = null
      }
      if (rvfcHandleRef.current != null) {
        try {
          v.cancelVideoFrameCallback?.(rvfcHandleRef.current)
        } catch {
          /* best effort */
        }
        rvfcHandleRef.current = null
      }
    }

    const handlePlay = () => {
      // Reset throttle cursors so the first playback frame isn't blocked
      // by a stale pre-scan value. Timestamps are handled by the simple
      // monotonic clamp in processPoseFrame — no offset math needed.
      lastPoseMsRef.current = 0
      lastRvfcPoseWallMsRef.current = 0
      void initPoseLandmarker().then(() => {
        // Guard: stop if component unmounted or loop already running.
        if (!videoRef.current) return
        if (hasRvfc) {
          // Kick off the RVFC loop — it will schedule itself on each video frame.
          if (rvfcHandleRef.current != null) return
          rvfcHandleRef.current = v.requestVideoFrameCallback!(videoFrameTick)
        } else {
          // Fallback to setTimeout on browsers without RVFC.
          if (rafRef.current != null) return
          rafRef.current = window.setTimeout(tick, 10) as unknown as number
        }
      })
    }

    const handlePause = () => clearLoops()
    const handleEnded = () => clearLoops()

    /** One detection when scrubbing (paused or playing) so skeletons stay glued to the frame. */
    const handleSeeked = () => {
      if (preScanActiveRef.current) return
      // A seek is a time discontinuity — just reset the throttle cursor so
      // the next detection isn't blocked. The monotonic clamp in
      // processPoseFrame keeps MediaPipe's timestamp requirement satisfied.
      lastPoseMsRef.current = 0
      const mediaTimeMs =
        typeof video.currentTime === 'number' && Number.isFinite(video.currentTime)
          ? video.currentTime * 1000
          : undefined
      const runDetect = () =>
        processPoseFrameRef.current({
          skipThrottle: true,
          ...(mediaTimeMs != null ? { mediaPipeTimestampMs: mediaTimeMs } : {}),
        })
      if (poseLandmarkerRef.current) {
        runDetect()
      } else {
        void initPoseLandmarker().then(runDetect)
      }
    }

    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('ended', handleEnded)
    video.addEventListener('seeked', handleSeeked)

    if (!video.paused && !video.ended) {
      handlePlay()
    }

    return () => {
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('ended', handleEnded)
      video.removeEventListener('seeked', handleSeeked)
      clearLoops()
    }
  }, [enabled, initPoseLandmarker, tick, videoFrameTick, videoRef])

  // Cleanup MediaPipe objects on unmount.
  // Capture the video element at effect mount time — by the time the cleanup
  // fires on unmount, videoRef.current may have already been nulled by React's
  // ref-detach, which would leak any in-flight RVFC handle.
  useEffect(() => {
    const capturedVideo = videoRef.current as (HTMLVideoElement & {
      cancelVideoFrameCallback?: (handle: number) => void
    }) | null
    return () => {
      if (rafRef.current) clearTimeout(rafRef.current)
      rafRef.current = null
      if (capturedVideo && rvfcHandleRef.current != null) {
        try {
          capturedVideo.cancelVideoFrameCallback?.(rvfcHandleRef.current)
        } catch {
          /* best effort */
        }
      }
      rvfcHandleRef.current = null
      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close()
        poseLandmarkerRef.current = null
      }
      if (retryLandmarkerRef.current) {
        retryLandmarkerRef.current.close()
        retryLandmarkerRef.current = null
      }
    }
  }, [videoRef])

  return null
}
