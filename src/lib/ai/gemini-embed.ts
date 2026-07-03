import { safeParseResponse } from '@/lib/safeJson'

import { GEMINI_EMBED_MODEL_DEFAULT } from '@/lib/gemini/models'

export type GeminiEmbedModel = 'gemini-embedding-2-preview' | (string & {})

export const GEMINI_EMBED_DIMENSION_DEFAULT = 1536

export type EmbedOptions = {
  apiKey?: string
  model?: GeminiEmbedModel
  taskType?: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'
  outputDimensionality?: number
}

export type EmbedVideoInput =
  | { kind: 'inline'; mimeType: 'video/mp4' | 'video/quicktime'; base64: string }
  | { kind: 'file'; fileUri: string; mimeType: string }

type EmbedResponse = {
  embedding?: {
    values?: number[]
  }
  embeddings?: Array<{
    values?: number[]
  }>
  error?: { message?: string }
}

const defaultModel = (): GeminiEmbedModel =>
  (process.env.GEMINI_EMBED_MODEL as GeminiEmbedModel | undefined) || GEMINI_EMBED_MODEL_DEFAULT

export const defaultOutputDimensionality = (): number => {
  const raw = process.env.GEMINI_EMBED_DIMENSION
  if (!raw) return GEMINI_EMBED_DIMENSION_DEFAULT

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) return GEMINI_EMBED_DIMENSION_DEFAULT
  return parsed
}

const getKey = (explicit?: string): string => {
  const key = explicit || process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  return key
}

const toInputs = (input: string | string[]): string[] => (Array.isArray(input) ? input : [input])

const buildUrl = (model: string, apiKey: string, batch = false): string => {
  const action = batch ? 'batchEmbedContents' : 'embedContent'
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${action}?key=${encodeURIComponent(apiKey)}`
}

const extractSingleVector = (data: EmbedResponse): number[] => {
  const vec = data?.embedding?.values ?? data?.embeddings?.[0]?.values
  if (!Array.isArray(vec) || vec.length === 0) throw new Error('Gemini embed returned empty vector')
  return vec
}

const buildVideoPart = (input: EmbedVideoInput): Record<string, unknown> => {
  if (input.kind === 'file') {
    return { fileData: { fileUri: input.fileUri, mimeType: input.mimeType } }
  }
  return { inlineData: { mimeType: input.mimeType, data: input.base64 } }
}

// ── Text embedding (unchanged API) ──────────────────────────────────────────

export async function embedText(
  input: string | string[],
  options?: EmbedOptions
): Promise<number[] | number[][]> {
  const apiKey = getKey(options?.apiKey)
  const model = options?.model || defaultModel()

  const inputs = toInputs(input)
  if (inputs.length === 0) return []

  const taskType = options?.taskType || 'RETRIEVAL_QUERY'
  const outputDimensionality =
    typeof options?.outputDimensionality === 'number' ? options.outputDimensionality : defaultOutputDimensionality()

  if (inputs.length === 1) {
    const singleUrl = buildUrl(model, apiKey, false)
    const resp = await fetch(singleUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text: inputs[0] }] },
        taskType,
        ...(outputDimensionality ? { outputDimensionality } : {}),
      }),
    })
    const data = (await safeParseResponse(resp)) as EmbedResponse
    if (!resp.ok) throw new Error(data?.error?.message || `Gemini embed error: ${resp.status}`)
    return extractSingleVector(data)
  }

  // Batch endpoint: batchEmbedContents requires `model` field in each request
  const batchUrl = buildUrl(model, apiKey, true)
  const modelPath = `models/${model}`
  const resp = await fetch(batchUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: inputs.map((text) => ({
        model: modelPath,
        content: { parts: [{ text }] },
        taskType,
        ...(outputDimensionality ? { outputDimensionality } : {}),
      })),
    }),
  })

  const data = (await safeParseResponse(resp)) as EmbedResponse
  if (!resp.ok) throw new Error(data?.error?.message || `Gemini embed error: ${resp.status}`)
  const vectors = (data?.embeddings || []).map((e) => e?.values).filter((v): v is number[] => Array.isArray(v) && v.length > 0)
  if (vectors.length !== inputs.length) throw new Error('Gemini embed returned mismatched batch size')
  return vectors
}

// ── Video embedding (native multimodal) ─────────────────────────────────────

export async function embedVideo(
  input: EmbedVideoInput,
  options?: EmbedOptions
): Promise<number[]> {
  const apiKey = getKey(options?.apiKey)
  const model = options?.model || defaultModel()
  const url = buildUrl(model, apiKey)

  const taskType = options?.taskType || 'RETRIEVAL_DOCUMENT'
  const outputDimensionality =
    typeof options?.outputDimensionality === 'number' ? options.outputDimensionality : defaultOutputDimensionality()

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: { parts: [buildVideoPart(input)] },
      taskType,
      ...(outputDimensionality ? { outputDimensionality } : {}),
    }),
  })

  const data = (await safeParseResponse(resp)) as EmbedResponse
  if (!resp.ok) throw new Error(data?.error?.message || `Gemini video embed error: ${resp.status}`)
  return extractSingleVector(data)
}

export async function embedVideoWithCaption(
  caption: string,
  video: EmbedVideoInput,
  options?: EmbedOptions
): Promise<number[]> {
  const apiKey = getKey(options?.apiKey)
  const model = options?.model || defaultModel()
  const url = buildUrl(model, apiKey)

  const taskType = options?.taskType || 'RETRIEVAL_DOCUMENT'
  const outputDimensionality =
    typeof options?.outputDimensionality === 'number' ? options.outputDimensionality : defaultOutputDimensionality()

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: {
        parts: [
          { text: caption },
          buildVideoPart(video),
        ],
      },
      taskType,
      ...(outputDimensionality ? { outputDimensionality } : {}),
    }),
  })

  const data = (await safeParseResponse(resp)) as EmbedResponse
  if (!resp.ok) throw new Error(data?.error?.message || `Gemini video+caption embed error: ${resp.status}`)
  return extractSingleVector(data)
}
