const MODEL_ID = 'fal-ai/sam-3/video-rle'
const QUEUE_BASE = 'https://queue.fal.run'

type FalQueueStatus = {
  status?: string
  error?: string
}

export type Sam3VideoRleInput = {
  videoUrl: string
  prompt?: string
}

export type Sam3VideoRleResult = {
  requestId: string
  model: typeof MODEL_ID
  data: unknown
}

/**
 * Tier 2 SAM3 via fal queue API (no @fal-ai/client dependency).
 * Caller supplies a publicly reachable video URL (upload-only path).
 */
export async function runSam3VideoRle(
  falKey: string,
  input: Sam3VideoRleInput,
  opts?: { pollIntervalMs?: number; maxWaitMs?: number }
): Promise<Sam3VideoRleResult> {
  const pollIntervalMs = opts?.pollIntervalMs ?? 2000
  const maxWaitMs = opts?.maxWaitMs ?? 240_000

  const body: Record<string, string> = { video_url: input.videoUrl }
  if (input.prompt) body.prompt = input.prompt

  const submitRes = await fetch(`${QUEUE_BASE}/${MODEL_ID}`, {
    method: 'POST',
    headers: {
      Authorization: `Key ${falKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!submitRes.ok) {
    const errText = await submitRes.text().catch(() => '')
    throw new Error(`fal submit failed (${submitRes.status}): ${errText.slice(0, 300)}`)
  }

  const submitJson = (await submitRes.json()) as { request_id?: string }
  const requestId = submitJson.request_id
  if (!requestId) throw new Error('fal submit response missing request_id')

  const deadline = Date.now() + maxWaitMs

  while (Date.now() < deadline) {
    const statusRes = await fetch(`${QUEUE_BASE}/${MODEL_ID}/requests/${requestId}/status`, {
      headers: { Authorization: `Key ${falKey}` },
    })

    if (!statusRes.ok) {
      const errText = await statusRes.text().catch(() => '')
      throw new Error(`fal status failed (${statusRes.status}): ${errText.slice(0, 300)}`)
    }

    const statusJson = (await statusRes.json()) as FalQueueStatus
    const status = statusJson.status

    if (status === 'COMPLETED') {
      const resultRes = await fetch(`${QUEUE_BASE}/${MODEL_ID}/requests/${requestId}`, {
        headers: { Authorization: `Key ${falKey}` },
      })
      if (!resultRes.ok) {
        const errText = await resultRes.text().catch(() => '')
        throw new Error(`fal result failed (${resultRes.status}): ${errText.slice(0, 300)}`)
      }
      const data = await resultRes.json()
      return { requestId, model: MODEL_ID, data }
    }

    if (status === 'FAILED') {
      throw new Error(statusJson.error || 'fal SAM3 job failed')
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  throw new Error('fal SAM3 timed out waiting for result')
}

export const SAM3_FAL_MODEL_ID = MODEL_ID
