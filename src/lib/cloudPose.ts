/**
 * Cloud pose client - run the heavy dense pass on a GPU server instead of the
 * user's device, then feed the result into the SAME track playback uses.
 *
 * Flow: video bytes -> POST /api/fight/cloud-pose (Next proxy -> Modal GPU/CPU,
 * see cloud/modal_app.py) -> candidate frames -> identityReplayCore -> A/B track.
 *
 * Opt-in only (?poseBackend=cloud). Off => the in-browser dense pass runs exactly
 * as today. Any failure returns null so the caller can fall back to local pose.
 */
import {
  replayCandidatesToDenseTrack,
  type DenseTrackSample,
  type ReplayInFrame,
} from '@/lib/identityReplayCore'

const CLOUD_POSE_ENDPOINT = '/api/fight/cloud-pose'

export type CloudPoseOptions = {
  mode: 'rtmpose' | 'mediapipe'
  target: 'auto' | 'gpu' | 'cpu'
}

function parseChoice<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/**
 * Opt-in. URL `?poseBackend=cloud` or localStorage `musashiPoseBackend`.
 *
 * Optional switches:
 *   ?poseCloudTarget=auto|gpu|cpu
 *   ?poseCloudMode=rtmpose|mediapipe
 */
export function getCloudPoseOptions(): CloudPoseOptions | null {
  if (typeof window === 'undefined') return null
  try {
    const params = new URLSearchParams(window.location.search)
    const backend = params.get('poseBackend') || window.localStorage.getItem('musashiPoseBackend')
    if (backend !== 'cloud') return null
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

export function cloudPoseRequested(): boolean {
  return getCloudPoseOptions() !== null
}

type CloudUpstream = {
  version?: string
  backend?: string
  meta?: { frames?: number; candidateFrames?: number; twoFighterFrames?: number; elapsedMs?: number }
  frames?: ReplayInFrame[]
}

export type CloudDenseResult = {
  track: DenseTrackSample[]
  backend: string
  target: string
  meta: CloudUpstream['meta']
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
}): Promise<CloudDenseResult | null> {
  try {
    const videoResp = await fetch(opts.videoUrl, { signal: opts.signal })
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

    const resp = await fetch(CLOUD_POSE_ENDPOINT, {
      method: 'POST',
      body: form,
      signal: opts.signal,
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
    return {
      track,
      backend: json.upstream?.backend ?? 'rtmpose',
      target: json.target ?? 'auto',
      meta: json.upstream?.meta,
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null
    console.warn('[CloudPose] dense pass failed, falling back to local:', err)
    return null
  }
}
