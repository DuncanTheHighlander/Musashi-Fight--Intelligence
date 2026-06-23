import { afterEach, describe, expect, it, vi } from 'vitest'
import { GET, POST } from './route'

type JsonBody = {
  error?: string
  requestedTarget?: string
  target?: string
  fallbackFrom?: { target: string; status: number; payload?: unknown } | null
  success?: boolean
  upstream?: unknown
  configured?: {
    gpu: boolean
    cpu: boolean
    token: boolean
  }
}

function multipartRequest(form: FormData, headers?: HeadersInit): Request {
  return new Request('http://localhost/api/fight/cloud-pose', {
    method: 'POST',
    headers,
    body: form,
  })
}

function clipForm(fields: Record<string, string> = {}): FormData {
  const form = new FormData()
  form.set('video', new File(['clip'], 'clip.mp4', { type: 'video/mp4' }))
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  return form
}

describe('/api/fight/cloud-pose', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('fails closed when the proxy token is not configured', async () => {
    vi.stubEnv('MUSASHI_POSE_CLOUD_TOKEN', '')
    vi.stubEnv('MUSASHI_POSE_CLOUD_GPU_URL', 'https://gpu.example')

    const response = await POST(multipartRequest(clipForm()))
    const body = (await response.json()) as JsonBody

    expect(response.status).toBe(500)
    expect(body.error).toContain('MUSASHI_POSE_CLOUD_TOKEN')
  })

  it('reports backend configuration without exposing secrets', async () => {
    vi.stubEnv('MUSASHI_POSE_CLOUD_TOKEN', 'test-token')
    vi.stubEnv('MUSASHI_POSE_CLOUD_GPU_URL', 'https://gpu.example')
    vi.stubEnv('MUSASHI_POSE_CLOUD_CPU_URL', '')

    const response = await GET()
    const body = (await response.json()) as JsonBody

    expect(response.status).toBe(200)
    expect(body.configured).toMatchObject({ gpu: true, cpu: false, token: true })
  })

  it('defaults to auto target and forwards video, mode, fps, and auth to GPU', async () => {
    vi.stubEnv('MUSASHI_POSE_CLOUD_TOKEN', 'test-token')
    vi.stubEnv('MUSASHI_POSE_CLOUD_GPU_URL', 'https://gpu.example')
    vi.stubEnv('MUSASHI_POSE_CLOUD_CPU_URL', 'https://cpu.example')

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe('https://gpu.example')
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
      expect(init?.method).toBe('POST')
      const upstreamForm = init?.body as FormData
      expect(upstreamForm.get('mode')).toBe('rtmpose')
      expect(upstreamForm.get('fps')).toBe('24')
      const video = upstreamForm.get('video') as File
      expect(video.name).toBe('clip.mp4')
      expect(await video.text()).toBe('clip')
      return new Response(JSON.stringify({ version: 'musashi-pose-api-v1', frames: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(multipartRequest(clipForm({ mode: 'rtmpose', fps: '24' })))
    const body = (await response.json()) as JsonBody

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.requestedTarget).toBe('auto')
    expect(body.target).toBe('gpu')
    expect(body.upstream).toEqual({ version: 'musashi-pose-api-v1', frames: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('can force the CPU backend for benchmarking', async () => {
    vi.stubEnv('MUSASHI_POSE_CLOUD_TOKEN', 'test-token')
    vi.stubEnv('MUSASHI_POSE_CLOUD_GPU_URL', 'https://gpu.example')
    vi.stubEnv('MUSASHI_POSE_CLOUD_CPU_URL', 'https://cpu.example')

    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe('https://cpu.example')
      const upstreamForm = init?.body as FormData
      expect(upstreamForm.get('mode')).toBe('mediapipe')
      return new Response(JSON.stringify({ backend: 'mediapipe', frames: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(multipartRequest(clipForm({ target: 'cpu', mode: 'mediapipe' })))
    const body = (await response.json()) as JsonBody

    expect(response.status).toBe(200)
    expect(body.requestedTarget).toBe('cpu')
    expect(body.target).toBe('cpu')
    expect(body.upstream).toEqual({ backend: 'mediapipe', frames: [] })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back from GPU to CPU when auto target hits a service failure', async () => {
    vi.stubEnv('MUSASHI_POSE_CLOUD_TOKEN', 'test-token')
    vi.stubEnv('MUSASHI_POSE_CLOUD_GPU_URL', 'https://gpu.example')
    vi.stubEnv('MUSASHI_POSE_CLOUD_CPU_URL', 'https://cpu.example')

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'gpu unavailable' }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ backend: 'rtmpose', frames: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    const response = await POST(multipartRequest(clipForm({ target: 'auto', mode: 'rtmpose' })))
    const body = (await response.json()) as JsonBody

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toBe('https://gpu.example')
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://cpu.example')
    expect(body.requestedTarget).toBe('auto')
    expect(body.target).toBe('cpu')
    expect(body.fallbackFrom).toMatchObject({ target: 'gpu', status: 503 })
    expect(body.upstream).toEqual({ backend: 'rtmpose', frames: [] })
  })
})
