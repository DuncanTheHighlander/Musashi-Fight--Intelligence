import { safeParseResponse } from '@/lib/safeJson'
import type { FightEvidenceLedger } from '@/lib/fightlang/fightlang.types'
import type { CoachingPayload } from '@/lib/validators/llm-output.validator'
import { GEMINI_MODEL_DEFAULT, GEMINI_EMBED_MODEL_DEFAULT, resolvedModels } from '@/lib/gemini/models'
import { getCoachingCache, sha256Hex } from '@/lib/ai/coachingCache'

class GeminiQuotaError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GeminiQuotaError'
    this.status = status
  }
}

export type GeminiModelName = string & {}

export type GeminiClientConfig = Readonly<{
  apiKey?: string
  embedModel?: GeminiModelName
  reasonModel?: GeminiModelName
}>

type GeminiGenerateResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  error?: { message?: string }
}

const getKey = (explicit?: string): string => {
  const key = explicit || process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  return key
}

const defaultEmbedModel = (): GeminiModelName =>
  ((process.env.GEMINI_EMBED_MODEL || GEMINI_EMBED_MODEL_DEFAULT) as GeminiModelName)

const defaultReasonModel = (): GeminiModelName =>
  ((process.env.GEMINI_REASON_MODEL || process.env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT) as GeminiModelName)

export function buildGroundedCoachingPrompt(args: {
  ledger: FightEvidenceLedger
  retrievedSnippets: Array<{ score: number; text: string; metadata?: Record<string, unknown> }>
}): string {
  // Keep the model constrained: ledger is truth; everything must cite evidence ids when available.
  const ledgerJson = JSON.stringify(
    {
      contractVersion: args.ledger.contractVersion,
      actors: args.ledger.actors,
      events: args.ledger.events.slice(0, 200),
      faults: args.ledger.faults.slice(0, 200),
      patterns: args.ledger.patterns.slice(0, 60),
      actorStateTimeline: args.ledger.actorStateTimeline.slice(0, 220),
      evidenceIndex: args.ledger.evidenceIndex.slice(0, 400),
      clip: args.ledger.clip ?? null,
    },
    null,
    2
  )

  const retrievedBlock =
    args.retrievedSnippets.length === 0
      ? 'None.'
      : args.retrievedSnippets
          .slice(0, 6)
          .map((s, i) => `Snippet ${i + 1} (score=${s.score.toFixed(3)}):\n${s.text}`)
          .join('\n\n')

  const shortClip =
    typeof args.ledger.clip?.durationMs === 'number' && args.ledger.clip.durationMs > 0 && args.ledger.clip.durationMs < 16_000

  const shortClipBlock = shortClip
    ? `

SHORT CLIP MODE (under ~16s): Every sentence must earn its place. Lead with the sharpest tactical read. Prefer ONE killer mainDiagnosis over three vague ones. quickCues: max 4 items, each a compressed broadcast line (viewer has seconds, not minutes).`
    : ''

  return `You are Musashi Fight Intelligence — a world-class fight analyst providing YouTube-style tactical breakdowns.

YOUR JOB: Analyze the fight evidence and produce TACTICAL, CONCEPTUAL coaching — not just "guard is low" or "stance is orthodox." Explain WHAT IS HAPPENING in the fight: who is controlling range, who is creating openings, what counters are available, what habits are forming, and what each fighter should do differently.
${shortClipBlock}

CRITICAL CONTRACT:
- The FightEvidenceLedger is the ONLY source of truth for what was detected.
- You MUST NOT invent strikes, stances, faults, or events not in the ledger.
- But you MUST interpret the data tactically. Turn raw detections into fight analysis.
- Events now include CLASSIFIED STRIKES (jab, cross, lead_hook, rear_hook, lead_uppercut, rear_uppercut, teep, lead_kick, rear_kick). Use the specific strike type in your analysis — say "jab" not "strike."
- Patterns include: guard_drop_before_entry, linear_retreat (only moves straight back), one_beat_entry (same-timing entry, counterable), circling (fighter moving laterally around opponent — describe direction and tactical purpose), ring_cutting (fighter cutting off angles to trap opponent). Name these patterns specifically and explain the tactical consequence.
- MOVEMENT IS CRITICAL: If "circling" or "ring_cutting" patterns appear in the ledger, you MUST mention them prominently. Describe WHO is circling, in what direction, and whether the other fighter is cutting off the ring or retreating linearly. Do NOT say "both fighters moving in a straight line" if a circling pattern exists.
- Example: Don't say "Guard low detected." Instead say "Fighter A is leaving the chin open after jab combinations — B has a clear counter-cross opportunity through the gap."
- Example: Don't say "Range is mid." Instead say "A is controlling distance with the jab and B can't get inside — B needs to use angles or level-change to close the gap."
- Example: Don't say "Strike detected." Instead say "A lands a cross — B's guard was low after the hook, creating a clean line."
- Cite evidence IDs when available.
- Output MUST be valid JSON. No markdown.

Retrieved fight knowledge (use to ground tactical concepts):
${retrievedBlock}

Current FightEvidenceLedger (truncated):
${ledgerJson}

CONCISENESS RULE: Be dense and punchy like a ringside analyst, NOT a lecture. Every word must earn its spot. No filler, no generic advice. quickCue ≤15 words. mainDiagnosis ≤30 words. expanded ≤2 sentences. If you can say it in fewer words, do.

PRODUCE 3-5 quickCues that sound like a knowledgeable cornerman would say between rounds. Each cue should:
1. Describe the TACTICAL SITUATION (what's happening and why it matters)
2. Identify the OPPORTUNITY or RISK (what can be exploited or must be fixed)
3. Give an ACTIONABLE INSTRUCTION (what to do differently, specifically)

OUTPUT JSON SCHEMA (exact keys):
{
  "quickCues": [
    {
      "id": "string",
      "actorId": "A|B",
      "t": {"startMs": 0, "endMs": 0},
      "quickCue": "string (punchy tactical cue, 8-15 words, like a corner coach would yell)",
      "keyMistake": "string (the specific tactical error, not just the detection name)",
      "whyItMatters": "string (the consequence in fight terms — what opening it creates, what risk it poses)",
      "whatToDoInstead": "string (specific corrective action)",
      "evidence": [{"id":"string","source":"pose|track|geometry|kinematics|compiler|user|llm","actorId":"A|B","t":{"startMs":0,"endMs":0}}],
      "confidence": {"score": 0.0, "basis": "heuristic|model|user|mixed"},
      "expanded": "string (2-3 sentence tactical explanation, like a commentator would say)",
      "audioScript": "string (optional)"
    }
  ],
  "mainDiagnosis": "string (1-2 sentence fight summary: who is winning the tactical battle and why)",
  "styleNotes": ["string (observations about fighting style: pressure vs counter, aggressive vs defensive, etc.)"],
  "suggestedCorrections": [
    {"actorId":"A|B","title":"string","why":"string (tactical reason)","doInstead":"string (specific technique or adjustment)","evidenceIds":["string"]}
  ],
  "overlayAnnotations": [
    {
      "id":"string",
      "actorId":"A|B",
      "time":{"startMs":0,"endMs":0},
      "annotationType":"arrow|circle|label|moment|zone",
      "anchorPoints":[{"kind":"bbox_center","actorId":"A"}],
      "message":"string (short tactical label for on-screen display, 3-8 words)",
      "confidence":{"score":0.0,"basis":"heuristic|model|user|mixed"},
      "evidence":[{"id":"string","source":"pose|track|geometry|kinematics|compiler|user|llm","actorId":"A|B","t":{"startMs":0,"endMs":0}}]
    }
  ],
  "audioScript": "string (optional)"
}

IMPORTANT: Generate at least 2-4 overlayAnnotations with tactical messages like "Counter opportunity — cross is open" or "Pressing but overextending" — not just repeating fault names. Use timestamps from the ledger.
`
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxRetries = 3
): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, init)
      // Retry on 429 (rate limit) and 503 (overloaded)
      if ((resp.status === 429 || resp.status === 503) && attempt < maxRetries) {
        const retryAfter = resp.headers.get('retry-after')
        const waitMs = retryAfter ? Math.min(parseInt(retryAfter, 10) * 1000, 10_000) : 1000 * Math.pow(2, attempt - 1)
        console.warn(`[Gemini] ${resp.status} on attempt ${attempt}, retrying in ${waitMs}ms`)
        await new Promise((r) => setTimeout(r, waitMs))
        continue
      }
      return resp
    } catch (e) {
      lastErr = e
      if (attempt < maxRetries) {
        const waitMs = 1000 * Math.pow(2, attempt - 1)
        console.warn(`[Gemini] Network error on attempt ${attempt}, retrying in ${waitMs}ms: ${e instanceof Error ? e.message : e}`)
        await new Promise((r) => setTimeout(r, waitMs))
      }
    }
  }
  throw lastErr ?? new Error('Gemini request failed after retries')
}

/**
 * Unified Gemini JSON generation. Single source of truth for every endpoint
 * that asks Gemini for a structured response.
 *
 *   - Always sets `responseMimeType: 'application/json'`.
 *   - Retries 429/503 with exponential backoff via `fetchWithRetry`.
 *   - THROWS on invalid JSON. Callers must not silently fake success — that
 *     was the bug we used to ship.
 *
 * @param parts  Multimodal Gemini parts. Pass `{ text: prompt }` for text-only,
 *               or include `{ inlineData }` / `{ fileData }` for video/image.
 */
export async function generateJson<T>(args: {
  model: string
  parts: Array<Record<string, unknown>>
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  apiKey?: string
}): Promise<{ model: string; data: T; rawText: string }> {
  const apiKey = getKey(args.apiKey)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: args.parts }],
    generationConfig: {
      temperature: args.temperature ?? 0.3,
      topP: args.topP ?? 0.95,
      topK: args.topK ?? 40,
      maxOutputTokens: args.maxOutputTokens ?? 2048,
      responseMimeType: 'application/json',
    },
  })

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  const json = (await safeParseResponse(resp)) as GeminiGenerateResponse
  if (!resp.ok) {
    throw new Error(json?.error?.message || `Gemini API error: ${resp.status}`)
  }

  const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  if (!rawText.trim()) {
    throw new Error('Gemini returned an empty response')
  }

  // responseMimeType: 'application/json' should give us pure JSON, but some
  // model versions still wrap in ```json fences. Strip them defensively.
  const cleaned = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')

  let data: T
  try {
    data = JSON.parse(cleaned) as T
  } catch {
    // Surface the real failure instead of pretending success. Callers can
    // catch and degrade gracefully if they want a fallback.
    throw new Error(`Gemini returned invalid JSON: ${cleaned.slice(0, 200)}`)
  }

  return { model: args.model, data, rawText }
}

async function attemptCoachingWithModel(args: {
  model: string
  apiKey: string
  prompt: string
  videoFileUri?: string
  videoMimeType?: string
}): Promise<{ model: string; payload: CoachingPayload; rawText: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent?key=${encodeURIComponent(args.apiKey)}`

  const parts: Array<Record<string, unknown>> = []
  if (args.videoFileUri) {
    parts.push({
      fileData: { fileUri: args.videoFileUri, mimeType: args.videoMimeType || 'video/mp4' },
    })
  }
  parts.push({ text: args.prompt })

  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.25,
      topP: 0.9,
      topK: 40,
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingBudget: 0 },
    },
  })

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })

  const data = (await safeParseResponse(resp)) as GeminiGenerateResponse
  if (!resp.ok) {
    const msg = data?.error?.message || `Gemini generate error: ${resp.status}`
    if (resp.status === 429 || resp.status === 503 || /quota|rate.?limit|exhausted/i.test(msg)) {
      throw new GeminiQuotaError(msg, resp.status)
    }
    throw new Error(msg)
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  let payload: CoachingPayload
  try {
    let cleaned = String(rawText || '').trim()
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
    payload = JSON.parse(cleaned) as CoachingPayload
  } catch {
    throw new Error(`Gemini returned invalid JSON for coaching payload: ${String(rawText).slice(0, 200)}`)
  }

  return { model: args.model, payload, rawText }
}

function buildDemoFallbackPayload(reason: string): CoachingPayload {
  return {
    quickCues: [
      { actorId: 'A', text: `[Demo fallback] Keep rear hand up on the exit. (${reason})` },
      { actorId: 'B', text: '[Demo fallback] Plant the lead foot before countering the jab.' },
    ] as any,
    mainDiagnosis:
      'Live AI is rate-limited; showing a demo coaching payload so the rest of the experience stays interactive.',
  } as unknown as CoachingPayload
}

export async function generateGroundedCoaching(args: {
  ledger: FightEvidenceLedger
  retrievedSnippets: Array<{ score: number; text: string; metadata?: Record<string, unknown> }>
  config?: GeminiClientConfig
  /** Gemini Files API URI — lets Pro SEE the actual fight footage alongside the ledger */
  videoFileUri?: string
  videoMimeType?: string
}): Promise<{ model: string; payload: CoachingPayload; rawText: string }> {
  // DRY_RUN short-circuit — returns a deterministic mock payload so smoke
  // tests and local iteration don't burn Gemini tokens. Toggle via env:
  //   GEMINI_DRY_RUN=1   (server)  or  NEXT_PUBLIC_GEMINI_DRY_RUN=1 (if referenced client-side)
  if (process.env.GEMINI_DRY_RUN === '1' || process.env.NEXT_PUBLIC_GEMINI_DRY_RUN === '1') {
    const mockPayload: CoachingPayload = {
      quickCues: [
        { actorId: 'A', text: '[DRY_RUN] Keep rear hand up on the exit.' },
        { actorId: 'B', text: '[DRY_RUN] Plant before countering the jab.' },
      ] as any,
      mainDiagnosis: '[DRY_RUN] Mocked coaching payload — GEMINI_DRY_RUN=1.',
    } as unknown as CoachingPayload
    return { model: 'dry-run-mock', payload: mockPayload, rawText: JSON.stringify(mockPayload) }
  }

  const apiKey = getKey(args.config?.apiKey)
  const prompt = buildGroundedCoachingPrompt({
    ledger: args.ledger,
    retrievedSnippets: args.retrievedSnippets,
  })

  // Phase 2: dedupe + LRU result cache. Two callers with literally identical
  // Gemini inputs share one round-trip; repeated requests inside the TTL
  // window are served from memory. Toggle off with MUSASHI_COACHING_CACHE=0
  // if you ever need to force-bypass it (e.g., A/B'ing prompt changes).
  const cachingDisabled = process.env.MUSASHI_COACHING_CACHE === '0'
  const cacheKey = cachingDisabled
    ? null
    : await sha256Hex(`${prompt}\u0000${args.videoFileUri ?? ''}\u0000${args.videoMimeType ?? ''}`)

  const runGemini = async (): Promise<{ model: string; payload: CoachingPayload; rawText: string }> => {
    // Model cascade: try the configured Pro model first; on quota/rate errors
    // fall back to Flash; if Flash is also exhausted, return a demo payload
    // so the UI still lights up during a presentation. Non-quota errors are
    // NOT swallowed — they bubble up so we don't hide real failures.
    const proModel = args.config?.reasonModel || defaultReasonModel()
    const flashModel = resolvedModels.flash()
    const cascade = proModel === flashModel ? [proModel] : [proModel, flashModel]
    const allowDemoFallback = process.env.GEMINI_DEMO_FALLBACK !== '0'

    let lastQuotaError: GeminiQuotaError | null = null
    for (const model of cascade) {
      try {
        return await attemptCoachingWithModel({
          model,
          apiKey,
          prompt,
          videoFileUri: args.videoFileUri,
          videoMimeType: args.videoMimeType,
        })
      } catch (err) {
        if (err instanceof GeminiQuotaError) {
          console.warn(`[Gemini] ${model} quota error: ${err.message}. Trying next model in cascade.`)
          lastQuotaError = err
          continue
        }
        throw err
      }
    }

    if (allowDemoFallback && lastQuotaError) {
      console.warn(`[Gemini] All models in cascade exhausted; serving demo fallback payload.`)
      const payload = buildDemoFallbackPayload(`HTTP ${lastQuotaError.status}`)
      return { model: 'demo-fallback', payload, rawText: JSON.stringify(payload) }
    }

    throw lastQuotaError ?? new Error('Gemini coaching generation failed')
  }

  if (!cacheKey) return runGemini()

  type CoachingResult = { model: string; payload: CoachingPayload; rawText: string }
  const cache = getCoachingCache<CoachingResult>()
  return cache.getOrCompute(cacheKey, runGemini)
}

