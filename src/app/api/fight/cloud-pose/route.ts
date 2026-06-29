import { NextResponse } from 'next/server'
import { readSecretEnv } from '@/lib/env'
import { aiGuard, aiErrorResponse } from '@/lib/ai/aiGuard'
import { enforceCloudPoseRateLimit } from '@/lib/musashiUsage'

export const maxDuration = 300

const DEFAULT_MAX_UPLOAD_BYTES = 256 * 1024 * 1024
const DEFAULT_UPSTREAM_TIMEOUT_MS = 290_000
const configuredMaxUploadBytes = Number(process.env.MUSASHI_POSE_PROXY_MAX_BYTES)
const MAX_UPLOAD_BYTES =
  Number.isFinite(configuredMaxUploadBytes) && configuredMaxUploadBytes > 0
    ? configuredMaxUploadBytes
    : DEFAULT_MAX_UPLOAD_BYTES
const configuredTimeoutMs = Number(process.env.MUSASHI_POSE_PROXY_TIMEOUT_MS)
const UPSTREAM_TIMEOUT_MS =
  Number.isFinite(configuredTimeoutMs) && configuredTimeoutMs > 0
    ? configuredTimeoutMs
    : DEFAULT_UPSTREAM_TIMEOUT_MS

type PoseTarget = 'gpu' | 'cpu'
type RequestedTarget = PoseTarget | 'auto'
type UpstreamAttempt = {
  ok: boolean
  target: PoseTarget
  status: number
  payload: unknown
}

function jsonError(status: number, error: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    { success: false, error, details: details ?? {}, timestamp: new Date().toISOString() },
    { status }
  )
}

function fileLike(value: FormDataEntryValue | null): value is File {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function' &&
      typeof (value as { name?: unknown }).name === 'string'
  )
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return text ? JSON.parse(text) : null
  } catch {
    return text
  }
}

function shouldTryCpuFallback(attempt: UpstreamAttempt): boolean {
  return attempt.status === 408 || attempt.status === 429 || attempt.status >= 500
}

async function callUpstream(args: {
  endpoint: string
  target: PoseTarget
  token: string
  video: File
  mode: string
  fps: FormDataEntryValue | null
}): Promise<UpstreamAttempt> {
  const upstreamForm = new FormData()
  upstreamForm.set('mode', args.mode)
  upstreamForm.set('video', args.video, args.video.name)
  if (args.fps !== null) upstreamForm.set('fps', String(args.fps))

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)
  try {
    const upstream = await fetch(args.endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${args.token}` },
      body: upstreamForm,
      signal: controller.signal,
    })
    return {
      ok: upstream.ok,
      target: args.target,
      status: upstream.status,
      payload: await readPayload(upstream),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown upstream fetch failure'
    return {
      ok: false,
      target: args.target,
      status: 502,
      payload: { error: message },
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function GET(request: Request) {
  const guard = await aiGuard(request, 'track')
  if (!guard.ok) return guard.response

  return NextResponse.json({
    success: true,
    configured: {
      gpu: Boolean(readSecretEnv('MUSASHI_POSE_CLOUD_GPU_URL')),
      cpu: Boolean(readSecretEnv('MUSASHI_POSE_CLOUD_CPU_URL')),
      token: Boolean(readSecretEnv('MUSASHI_POSE_CLOUD_TOKEN')),
      maxUploadBytes: MAX_UPLOAD_BYTES,
      upstreamTimeoutMs: UPSTREAM_TIMEOUT_MS,
    },
  })
}

export async function POST(request: Request) {
  const guard = await aiGuard(request, 'track')
  if (!guard.ok) return guard.response

  if (guard.user && process.env.MUSASHI_DISABLE_AUTH !== '1') {
    try {
      await enforceCloudPoseRateLimit(guard.user.id)
    } catch (err) {
      return aiErrorResponse(err)
    }
  }

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.includes('multipart/form-data')) {
    return jsonError(400, 'Expected multipart/form-data with a video file.')
  }

  const contentLength = Number(request.headers.get('content-length') || '0')
  if (contentLength && contentLength > MAX_UPLOAD_BYTES) {
    return jsonError(413, 'Video upload is too large for cloud pose proxy.', { maxBytes: MAX_UPLOAD_BYTES })
  }

  const token = readSecretEnv('MUSASHI_POSE_CLOUD_TOKEN')
  if (!token) {
    return jsonError(500, 'MUSASHI_POSE_CLOUD_TOKEN is not configured.')
  }

  const cpuUrl = readSecretEnv('MUSASHI_POSE_CLOUD_CPU_URL')
  const gpuUrl = readSecretEnv('MUSASHI_POSE_CLOUD_GPU_URL')

  const form = await request.formData()
  const video = form.get('video')
  if (!fileLike(video)) {
    return jsonError(400, "Expected multipart field named 'video'.")
  }
  if (video.size > MAX_UPLOAD_BYTES) {
    return jsonError(413, 'Video upload is too large for cloud pose proxy.', { maxBytes: MAX_UPLOAD_BYTES })
  }

  const target = String(form.get('target') || 'auto').toLowerCase() as RequestedTarget
  if (target !== 'auto' && target !== 'cpu' && target !== 'gpu') {
    return jsonError(400, "target must be 'auto', 'cpu', or 'gpu'.")
  }

  const mode = String(form.get('mode') || 'rtmpose').toLowerCase()
  if (mode !== 'rtmpose' && mode !== 'mediapipe') {
    return jsonError(400, "mode must be 'rtmpose' or 'mediapipe'.")
  }

  const endpoints: Partial<Record<PoseTarget, string>> = { gpu: gpuUrl, cpu: cpuUrl }
  const plan: PoseTarget[] =
    target === 'auto'
      ? [gpuUrl ? 'gpu' : null, cpuUrl ? 'cpu' : null].filter(Boolean) as PoseTarget[]
      : [target]
  if (plan.length === 0) {
    return jsonError(500, 'No cloud pose backend URL is configured.', {
      required: ['MUSASHI_POSE_CLOUD_GPU_URL', 'MUSASHI_POSE_CLOUD_CPU_URL'],
    })
  }

  const fps = form.get('fps')

  const attempts: UpstreamAttempt[] = []
  for (const plannedTarget of plan) {
    const endpoint = endpoints[plannedTarget]
    if (!endpoint) {
      return jsonError(500, `MUSASHI_POSE_CLOUD_${plannedTarget.toUpperCase()}_URL is not configured.`)
    }
    const attempt = await callUpstream({ endpoint, target: plannedTarget, token, video, mode, fps })
    attempts.push(attempt)
    if (attempt.ok) {
      return NextResponse.json({
        success: true,
        requestedTarget: target,
        target: attempt.target,
        mode,
        fallbackFrom: attempts.length > 1 ? attempts[0] : null,
        upstream: attempt.payload,
      })
    }
    if (target !== 'auto' || !shouldTryCpuFallback(attempt)) break
  }

  const last = attempts[attempts.length - 1]
  return jsonError(last?.status ?? 502, 'Cloud pose service failed.', {
    requestedTarget: target,
    target: last?.target,
    attempts: attempts.map((attempt) => ({
      target: attempt.target,
      status: attempt.status,
      response: attempt.payload,
    })),
  })
}
