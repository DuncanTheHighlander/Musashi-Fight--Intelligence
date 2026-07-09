/**
 * Cloud pose client - run the heavy dense pass on a GPU server instead of the
 * user's device, then feed the result into the SAME track playback uses.
 *
 * Flow: video bytes -> POST /api/fight/cloud-pose (Next proxy -> Modal GPU/CPU,
 * see cloud/modal_app.py) -> candidate frames -> identityReplayCore -> A/B track.
 *
 * ENGINE PRIORITY (docs/POSE_ENGINE_PRIORITY.md): cloud RTMPose is the DEFAULT
 * primary engine for clip analysis — validated better than the MediaPipe pass
 * on the 3-clip envelope (2026-07-01). Opt out with ?poseBackend=local (or any
 * non-cloud backend value), or build with NEXT_PUBLIC_POSE_PRIMARY_ENGINE=mediapipe.
 * Any cloud failure returns null so the caller falls back to local MediaPipe —
 * the proven on-device path can never regress.
 */
import {
  replayCandidatesToDenseTrack,
  type DenseTrackSample,
  type ReplayInFrame,
} from '@/lib/identityReplayCore'
import { assessDenseTrackQuality, type PoseQualitySummary } from '@/lib/pose/poseQuality'
import type { PoseFrame } from '@/lib/fightlang/fightlang.types'

const CLOUD_POSE_ENDPOINT = '/api/fight/cloud-pose'
/** Client-side ceiling for one cloud dense pass (proxy upstream timeout is 290s). */
const CLOUD_POSE_TIMEOUT_MS = 300_000

export type CloudPoseOptions = {
  mode: 'rtmpose' | 'mediapipe'
  target: 'auto' | 'gpu' | 'cpu'
}

function parseChoice<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/**
 * Engine selection. Cloud RTMPose is ON BY DEFAULT (primary engine).
 *
 * Overrides:
 *   ?poseBackend=cloud       -> explicit cloud (same as default)
 *   ?poseBackend=<anything else, e.g. local|rtmpose|mediapipe>
 *                            -> cloud OFF (user picked an on-device backend)
 *   NEXT_PUBLIC_POSE_PRIMARY_ENGINE=mediapipe -> default OFF unless ?poseBackend=cloud
 *   ?poseCloudTarget=auto|gpu|cpu, ?poseCloudMode=rtmpose|mediapipe
 * localStorage mirrors: musashiPoseBackend / musashiPoseCloudTarget / musashiPoseCloudMode.
 */
export function getCloudPoseOptions(): CloudPoseOptions | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const backend = params.get('poseBackend') || window.localStorage.getItem('musashiPoseBackend')
    if (backend && backend !== 'cloud') return null
    if (!backend) {
      // No explicit backend: cloud runs only while RTMPose is the configured primary.
      const primary = (process.env.NEXT_PUBLIC_POSE_PRIMARY_ENGINE || 'rtmpose').toLowerCase()
      if (primary !== 'rtmpose') return null
    }
    return {
      mode: parseChoice(
        params.get('poseCloudMode') || params.get('poseMode') || window.localStorage.getItem('musashiPoseCloudMode'),
        ['rtmpose', 'mediapipe'] as const,
        'rtmpose'
      ),
      target: parseChoice(
        params.get('poseCloudTarget') || params.get('poseTarget') || window.localStorage.getItem('musashiPoseCloudTarget'),
        ['auto', 'gpu', 'cpu'] as const,
        'auto'
      ),
    }
  } catch {
    return null
  }
}

// Once-per-session preflight cache: `null` = not checked yet.
let cloudConfiguredCache: boolean | null = null

/**
 * Cheap GET preflight — is the proxy actually wired to a Modal backend?
 * Prevents uploading megabytes of video to a proxy that will 500 on dev
 * boxes without MUSASHI_POSE_CLOUD_* set. Result is cached for the session.
 */
export async function cloudPoseConfigured(): Promise<boolean> {
  if (cloudConfiguredCache !== null) return cloudConfiguredCache
  try {
    const resp = await fetch(CLOUD_POSE_ENDPOINT, { method: 'GET' })
    const json = (await resp.json()) as {
      success?: boolean
      configured?: { gpu?: boolean; cpu?: boolean; token?: boolean }
    }
    cloudConfiguredCache = Boolean(
      resp.ok && json.success && json.configured?.token && (json.configured.gpu || json.configured.cpu)
    )
  } catch {
    cloudConfiguredCache = false
  }
  return cloudConfiguredCache
}

/** Test hook — reset the preflight cache. */
export function resetCloudPoseConfiguredCache(): void {
  cloudConfiguredCache = null
}

export function cloudPoseRequested(): boolean {
  return getCloudPoseOptions() !== null
}

type CloudUpstream = {
  version?: string
  backend?: string
  meta?: {
    frames?: number
    candidateFrames?: number
    twoFighterFrames?: number
    elapsedMs?: number
    pose3DEnabled?: boolean
  }
  frames?: ReplayInFrame[]
  /** Present only when optional 3D lifting succeeded on Modal. */
  pose3DFrames?: ReplayInFrame[] | null
}

export type CloudDenseResult = {
  track: DenseTrackSample[]
  backend: string
  target: string
  meta: CloudUpstream['meta']
  /** Present when `durationMs` was provided — grade of the returned track. */
  quality?: PoseQualitySummary
  /** A/B dense track from 3D-lifted candidates (optional). */
  pose3DTrack?: DenseTrackSample[]
}

/** Convert identity-replay output to FightLang pose frames (preserves z when present). */
export function denseTrackToPoseFrames(track: ReadonlyArray<DenseTrackSample>): PoseFrame[] {
  return track.map((s) => ({
    tMs: s.tMs,
    videoTimeSec: s.tMs / 1000,
    actors: {
      ...(s.A?.length ? { A: s.A } : {}),
      ...(s.B?.length ? { B: s.B } : {}),
    },
  }))
}

function pose3dRequested(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    return params.get('pose3d') === '1' || window.localStorage.getItem('musashiPose3d') === '1'
  } catch {
    return false
  }
}

/**
 * Estimate how many samples a complete track would hold, from its own median
 * cadence. Uniform subsampling (e.g. 15fps) stays coverage=1; a track that
 * silently dropped a chunk of the clip grades down.
 */
function expectedSamplesFor(track: DenseTrackSample[], durationMs: number): number {
  if (track.length < 2 || durationMs <= 0) return Math.max(1, track.length)
  const gaps: number[] = []
  for (let i = 1; i < track.length; i++) gaps.push(track[i].tMs - track[i - 1].tMs)
  gaps.sort((a, b) => a - b)
  const median = Math.max(1, gaps[Math.floor(gaps.length / 2)])
  return Math.max(1, Math.floor(durationMs / median))
}

/**
 * Run the cloud dense pass for one clip. `videoUrl` is the element's currentSrc
 * (blob: for uploads, /test-videos/... for fixtures) - both are fetchable here.
 */
export async function fetchCloudDenseTrack(opts: {
  videoUrl: string
  mode?: 'rtmpose' | 'mediapipe'
  target?: 'auto' | 'gpu' | 'cpu'
  fps?: number
  filename?: string
  signal?: AbortSignal
  /** Clip duration; when provided the result includes a quality grade. */
  durationMs?: number
}): Promise<CloudDenseResult | null> {
  const signal = opts.signal ?? AbortSignal.timeout(CLOUD_POSE_TIMEOUT_MS)
  try {
    const videoResp = await fetch(opts.videoUrl, { signal })
    if (!videoResp.ok) {
      console.warn('[CloudPose] could not read video bytes:', videoResp.status)
      return null
    }
    const blob = await videoResp.blob()

    const form = new FormData()
    form.set('video', blob, opts.filename ?? 'clip.mp4')
    form.set('mode', opts.mode ?? 'rtmpose')
    form.set('target', opts.target ?? 'auto')
    if (opts.fps) form.set('fps', String(opts.fps))
    if (pose3dRequested()) form.set('lift3d', 'true')

    const resp = await fetch(CLOUD_POSE_ENDPOINT, {
      method: 'POST',
      body: form,
      signal,
    })
    const json = (await resp.json()) as {
      success?: boolean
      error?: string
      target?: string
      upstream?: CloudUpstream
    }
    if (!resp.ok || !json.success) {
      console.warn('[CloudPose] proxy error:', json.error ?? resp.status)
      return null
    }
    const frames = json.upstream?.frames
    if (!Array.isArray(frames) || frames.length === 0) {
      console.warn('[CloudPose] upstream returned no frames')
      return null
    }

    const track = replayCandidatesToDenseTrack(frames)
    const pose3dCandidates = json.upstream?.pose3DFrames
    const pose3DTrack =
      Array.isArray(pose3dCandidates) && pose3dCandidates.length > 0
        ? replayCandidatesToDenseTrack(pose3dCandidates)
        : undefined
    const quality =
      typeof opts.durationMs === 'number' && opts.durationMs > 0
        ? assessDenseTrackQuality(track, expectedSamplesFor(track, opts.durationMs))
        : undefined
    return {
      track,
      backend: json.upstream?.backend ?? 'rtmpose',
      target: json.target ?? 'auto',
      meta: json.upstream?.meta,
      quality,
      ...(pose3DTrack?.length ? { pose3DTrack } : {}),
    }
  } catch (err) {
    if (err instanceof DOMException && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      console.warn('[CloudPose] dense pass aborted/timed out, falling back to local')
      return null
    }
    console.warn('[CloudPose] dense pass failed, falling back to local:', err)
    return null
  }
}
