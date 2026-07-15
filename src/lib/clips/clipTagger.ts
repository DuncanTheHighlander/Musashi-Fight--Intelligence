import { safeParseResponse } from '@/lib/safeJson'
import { resolvedModels } from '@/lib/gemini/models'
import { getServerSecret } from '@/lib/cloudflare/secrets'
import type { TechniqueEntry } from '@/lib/taxonomyService'

export type ClipVideoSource =
  | { kind: 'youtube'; videoId: string }
  | { kind: 'file'; fileUri: string; mimeType: string }

export type TaggedSegment = {
  techniqueId: string
  startSec: number
  endSec: number
  label: string
  confidence: number
  tags: string[]
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  error?: { message?: string }
}

const buildVideoPart = (source: ClipVideoSource): Record<string, unknown> => {
  if (source.kind === 'youtube') {
    return { fileData: { fileUri: `https://www.youtube.com/watch?v=${source.videoId}` } }
  }
  return { fileData: { fileUri: source.fileUri, mimeType: source.mimeType } }
}

const buildTaggingPrompt = (vocabulary: TechniqueEntry[]): string => {
  const techniqueList = vocabulary
    .map((t) => `- id="${t.id}" name="${t.name}": ${t.description}`)
    .join('\n')

  return `You are tagging combat-sports technique footage for a searchable clip library.

Watch the video and identify every moment where one of the following techniques occurs. Only use the exact "id" values given below — never invent a new id or label a moment with a technique that isn't in this list. If a technique doesn't appear, omit it.

TECHNIQUE VOCABULARY:
${techniqueList}

For each occurrence, return:
- techniqueId: must exactly match one of the ids above
- startSec / endSec: the moment's boundaries in seconds from the start of the video
- label: a short human-readable caption (under 12 words) describing what happens in that moment
- confidence: 0.0–1.0, how confident you are this is really the named technique

- tags: short lowercase kebab-case occurrence tags for search filters. Include the technique name/tag, action type ("entry", "sweep", "pass", "submission", "transition"), and visible source/target positions when clear (for example "from-closed-guard", "closed-guard", "k-guard", "guard-pull"). Do not include tags you cannot see.

OUTPUT FORMAT (valid JSON array only, no markdown, no commentary):
[
  { "techniqueId": "string", "startSec": 0, "endSec": 0, "label": "string", "confidence": 0.0, "tags": ["string"] }
]

If nothing in the vocabulary appears in the video, return an empty array: []`
}

/**
 * Ask Gemini to find and timestamp occurrences of a known technique
 * vocabulary inside a video. Works identically for a YouTube URL (Gemini
 * fetches it directly — never downloaded/rehosted by us) or an
 * already-uploaded file (Files API URI), so the same function serves both
 * the YouTube-embed and owned-footage ingestion paths.
 */
export async function tagClipsForVideo(args: {
  source: ClipVideoSource
  vocabulary: TechniqueEntry[]
}): Promise<TaggedSegment[]> {
  const apiKey = await getServerSecret('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')
  if (args.vocabulary.length === 0) return []

  const model = resolvedModels.flash()
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  const prompt = buildTaggingPrompt(args.vocabulary)
  const validIds = new Set(args.vocabulary.map((t) => t.id))

  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: prompt }, buildVideoPart(args.source)],
            },
          ],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
          },
        }),
      })

      if ((resp.status === 429 || resp.status === 503) && attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))
        continue
      }

      const data = (await safeParseResponse(resp)) as GeminiResponse
      if (!resp.ok) throw new Error(data?.error?.message || `Gemini error: ${resp.status}`)

      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]'
      const parsed = JSON.parse(String(rawText).trim()) as TaggedSegment[]

      return parsed
        .filter(
          (seg) =>
            validIds.has(seg.techniqueId) &&
            Number.isFinite(seg.startSec) &&
            Number.isFinite(seg.endSec) &&
            seg.endSec > seg.startSec
        )
        .map((seg) => ({
          ...seg,
          tags: Array.isArray(seg.tags) ? seg.tags.map(String) : [],
        }))
    } catch (e) {
      lastErr = e
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))
      }
    }
  }

  throw lastErr ?? new Error('Clip tagging failed after retries')
}
