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

/**
 * Client-side safe parsing for API responses.
 * When the server returns HTML (e.g. 500 error page), shows a user-friendly message.
 */
export async function parseApiResponse<T = any>(res: Response): Promise<T> {
  const text = await res.text()
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
  } catch (e) {
    throw new Error(`Server returned ${res.status} but body was invalid JSON. Check dev server.`)
  }
}
