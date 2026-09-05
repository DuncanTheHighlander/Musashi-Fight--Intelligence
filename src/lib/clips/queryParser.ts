import { safeParseResponse } from '@/lib/safeJson'
import { resolvedModels } from '@/lib/gemini/models'
import { getServerSecret } from '@/lib/cloudflare/secrets'

export type ParsedClipQuery = {
  includeTags: string[]
  excludeTags: string[]
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  error?: { message?: string }
}

const STOP_WORDS = new Set([
  'and',
  'are',
  'for',
  'from',
  'into',
  'that',
  'the',
  'with',
])

const normalizeTag = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^entries$/, 'entry')
    .replace(/^attacks$/, 'attack')
    .replace(/^transitions$/, 'transition')

const normalizeTags = (values: unknown[]): string[] =>
  Array.from(
    new Set(
      values
        .map((value) => normalizeTag(String(value)))
        .filter((tag) => tag.length > 2 && !STOP_WORDS.has(tag))
    )
  )

const buildPrompt = (query: string): string =>
  `Parse this combat-sports technique search into tag filters.

Query: "${query}"

Return JSON only: { "includeTags": ["string"], "excludeTags": ["string"] }
- includeTags: short lowercase keywords/tags the result MUST relate to (e.g. "k-guard", "entry")
- excludeTags: short lowercase keywords/tags that disqualify a result (e.g. if the query says "not from closed guard", excludeTags should include "closed-guard")
- Use short tag-like words, not full sentences. Empty arrays are fine if nothing applies.`

/** Naive fallback used when Gemini isn't configured or parsing fails. */
const fallbackParse = (query: string): ParsedClipQuery => {
  const excludeMatch = query.match(/\b(?:not|isn't|aren't|excluding|without|but no)\b\s+(?:from\s+|using\s+)?([a-z0-9 \-]+)/i)
  const excludeTags = excludeMatch
    ? normalizeTags([excludeMatch[1]])
    : []

  const cleaned = excludeMatch ? query.replace(excludeMatch[0], '') : query
  const includeTags = normalizeTags(cleaned
    .toLowerCase()
    .replace(/[^a-z0-9 \-]/g, ' ')
    .split(/\s+/)
    .slice(0, 8))

  return { includeTags, excludeTags }
}

/**
 * Turn a free-text query like "K-guard entries that aren't from closed
 * guard" into structured tag filters. Reproduces OutlierDB's NL search
 * against an already-exact-tagged taxonomy, so it's a filter-extraction
 * step rather than a vector search.
 */
export async function parseClipQuery(query: string): Promise<ParsedClipQuery> {
  const apiKey = await getServerSecret('GEMINI_API_KEY')
  if (!apiKey) return fallbackParse(query)

  try {
    const model = resolvedModels.pro()
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(query) }] }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 512,
          responseMimeType: 'application/json',
        },
      }),
    })

    const data = (await safeParseResponse(resp)) as GeminiResponse
    if (!resp.ok) throw new Error(data?.error?.message || `Gemini error: ${resp.status}`)

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    const parsed = JSON.parse(String(rawText).trim()) as Partial<ParsedClipQuery>

    return {
      includeTags: Array.isArray(parsed.includeTags) ? normalizeTags(parsed.includeTags) : [],
      excludeTags: Array.isArray(parsed.excludeTags) ? normalizeTags(parsed.excludeTags) : [],
    }
  } catch {
    return fallbackParse(query)
  }
}
