/**
 * Safe JSON parsing for HTTP responses.
 * When external APIs (Gemini, OpenAI) return HTML error pages (404, 403, 429, 500),
 * response.json() throws "Unexpected token '<', "<!DOCTYPE "... is not valid JSON".
 * This helper returns a clear error instead.
 */
export async function safeParseResponse(resp: Response): Promise<any> {
  const text = await resp.text()
  const trimmed = text.trim()

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    throw new Error(
      `AI service returned an error page (status ${resp.status}). Check your API key, model name, and quota.`
    )
  }

  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(
      `AI service returned invalid JSON (status ${resp.status}). Check your API key, model name, and quota.`
    )
  }
}

function parseApiResponseText<T>(res: Response, text: string): T {
  const trimmed = text.trim()

  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    const preview = trimmed.slice(0, 80).replace(/\s+/g, ' ')
    const bodyDesc = trimmed.length === 0 ? 'empty body' : `"${preview}${trimmed.length > 80 ? '...' : ''}"`
    const urlHint = res.url ? ` Endpoint: ${res.url}.` : ''
    const hint = res.status === 500 && trimmed.length === 0
      ? ` The server may have crashed before sending a response. Check your terminal/dev server logs for the actual error.${urlHint}`
      : ` Check dev server and API route.${urlHint}`
    throw new Error(`Server returned ${res.status} (expected JSON, got ${bodyDesc}).${hint}`)
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`Server returned ${res.status} but body was invalid JSON. Check dev server.`)
  }
}

/**
 * Client-side safe parsing for API responses.
 * When the server returns HTML (e.g. 500 error page), shows a user-friendly message.
 */
export async function parseApiResponse<T = any>(res: Response): Promise<T> {
  const text = await res.text()
  return parseApiResponseText<T>(res, text)
}

export type ApiGuardStatus = 401 | 402 | 403 | 429 | 503

export type ApiGuardBody = {
  code?: string
  hint?: string
  [key: string]: unknown
}

export type ParsedFetchResult<T> =
  | { kind: 'ok'; status: number; data: T }
  | { kind: 'guard'; status: ApiGuardStatus; body: ApiGuardBody | null; retryAfter?: number }

const GUARD_STATUSES = new Set<number>([401, 402, 403, 429, 503])

/**
 * Fetch + parse in one pass. Safe to share via dedupeInflight — concurrent
 * callers receive the same parsed result instead of re-reading one Response body.
 */
export async function fetchAndParseApiResponse<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<ParsedFetchResult<T>> {
  const res = await fetch(input, init)
  const text = await res.text()

  if (GUARD_STATUSES.has(res.status)) {
    let body: ApiGuardBody | null = null
    const trimmed = text.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        body = JSON.parse(text) as ApiGuardBody
      } catch {
        body = null
      }
    }
    const retryAfterRaw = Number(res.headers.get('Retry-After') || '')
    const retryAfter = Number.isFinite(retryAfterRaw) && retryAfterRaw > 0 ? retryAfterRaw : undefined
    return {
      kind: 'guard',
      status: res.status as ApiGuardStatus,
      body,
      retryAfter,
    }
  }

  return {
    kind: 'ok',
    status: res.status,
    data: parseApiResponseText<T>(res, text),
  }
}
