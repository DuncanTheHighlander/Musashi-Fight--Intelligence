import { safeParseResponse } from '@/lib/safeJson'
import { getServerSecret } from '@/lib/cloudflare/secrets'

import { GEMINI_MODEL_DEFAULT } from '@/lib/gemini/models'

export type GeminiReasonModel = 'gemini-3.1-pro-preview' | (string & {})

export type GeminiSseStream = ReadableStream<Uint8Array>

export type StreamReasonArgs = {
  apiKey?: string
  model?: GeminiReasonModel
  system: string
  userText: string
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
}

const defaultModel = (): GeminiReasonModel =>
  (process.env.GEMINI_REASON_MODEL as GeminiReasonModel | undefined) ||
  (process.env.GEMINI_MODEL as GeminiReasonModel | undefined) ||
  GEMINI_MODEL_DEFAULT

const getKey = async (explicit?: string): Promise<string> => {
  const key = explicit || await getServerSecret('GEMINI_API_KEY')
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  return key
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(id)
  }
}

export async function streamReasoning(args: StreamReasonArgs): Promise<{
  resp: Response
  model: string
  stream: GeminiSseStream
}> {
  const apiKey = await getKey(args.apiKey)
  const modelId = args.model || defaultModel()
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`

  const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : 45000
  const resp = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: args.system }] },
        contents: [{ role: 'user', parts: [{ text: args.userText }] }],
        generationConfig: {
          temperature: typeof args.temperature === 'number' ? args.temperature : 0.35,
          maxOutputTokens: typeof args.maxOutputTokens === 'number' ? args.maxOutputTokens : 4096,
        },
      }),
    },
    timeoutMs
  )

  if (!resp.ok || !resp.body) {
    // Consume and convert error to something usable by callers
    let msg = `Gemini reasoning error: ${resp.status}`
    try {
      const data = await safeParseResponse(resp)
      msg = (data as any)?.error?.message || msg
    } catch {
      // ignore parse errors; keep generic message
    }
    throw new Error(msg)
  }

  return { resp, model: modelId, stream: resp.body }
}

