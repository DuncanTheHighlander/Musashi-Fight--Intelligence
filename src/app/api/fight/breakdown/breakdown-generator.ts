/**
 * YouTube-Style Breakdown Generator
 *
 * Uses Gemini 3.1 Pro to produce timestamped, narrated fight breakdowns
 * with overlay annotations — like a professional YouTube fight analyst.
 */

import { safeParseResponse } from '@/lib/safeJson'
import type { FightEvidenceLedger, OverlayAnnotation } from '@/lib/fightlang/fightlang.types'
import { resolvedModels } from '@/lib/gemini/models'

export type BreakdownStyle = 'commentary' | 'coaching' | 'scouting'

export type BreakdownSegment = {
  id: string
  startMs: number
  endMs: number
  /** Short title for this segment (e.g., "Opening Exchange", "Counter Opportunity") */
  title: string
  /** Full narration script — what a YouTube analyst would say */
  narration: string
  /** Key tactical insight for on-screen text overlay */
  onScreenText: string
  /** Which fighter this segment focuses on */
  focusActor: 'A' | 'B' | 'both'
  /** Tags for categorization */
  tags: string[]
}

export type BreakdownPayload = {
  /** Video title a YouTube channel would use */
  videoTitle: string
  /** 2-3 sentence hook for the video intro */
  introHook: string
  /** Timestamped breakdown segments */
  segments: BreakdownSegment[]
  /** Overall fight summary / conclusion */
  conclusion: string
  /** Key takeaways (3-5 bullet points) */
  keyTakeaways: string[]
  /** Full narration script (all segments joined) */
  fullScript: string
  /** Overlay annotations for video */
  overlayAnnotations: OverlayAnnotation[]
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  error?: { message?: string }
}

function buildBreakdownPrompt(args: {
  ledger: FightEvidenceLedger
  retrievedSnippets: Array<{ score: number; text: string }>
  styleAssessments: Array<{ actorId: string; [k: string]: any }>
  style: BreakdownStyle
  focusActor: string
}): string {
  const { ledger, retrievedSnippets, styleAssessments, style, focusActor } = args

  const ledgerJson = JSON.stringify(
    {
      actors: ledger.actors,
      events: ledger.events.slice(0, 200),
      faults: ledger.faults.slice(0, 150),
      patterns: ledger.patterns.slice(0, 60),
      actorStateTimeline: ledger.actorStateTimeline.slice(0, 200),
      clip: ledger.clip ?? null,
    },
    null,
    2
  )

  const retrievedBlock =
    retrievedSnippets.length === 0
      ? 'None.'
      : retrievedSnippets
          .slice(0, 6)
          .map((s, i) => `Snippet ${i + 1} (score=${s.score.toFixed(3)}):\n${s.text}`)
          .join('\n\n')

  const styleBlock = styleAssessments
    .map((s) => `Fighter ${s.actorId}: ${JSON.stringify(s)}`)
    .join('\n')

  const styleInstructions: Record<BreakdownStyle, string> = {
    commentary: `You are a top-tier YouTube fight analyst (think Jack Slack, Lawrence Kenshin, or The Weasle).
Your breakdown should be entertaining, insightful, and accessible. Use vivid language.
Explain WHY things happen, not just WHAT happens. Make complex tactics understandable.
Tone: enthusiastic expert sharing discoveries with the audience.`,
    coaching: `You are a world-class fight coach reviewing footage with your fighter.
Your breakdown should be direct, actionable, and focused on improvement.
For each moment, tell the fighter what they did, why it matters, and what to do instead.
Tone: experienced coach who respects the fighter but demands better.`,
    scouting: `You are a fight scout preparing an opponent study for an upcoming bout.
Your breakdown should identify exploitable habits, tendencies, and weaknesses.
Focus on patterns that a well-prepared opponent can exploit.
Tone: clinical analyst building a game plan to beat this fighter.`,
  }

  const durSec = ledger.clip?.durationMs ? (ledger.clip.durationMs / 1000).toFixed(1) : 'unknown'

  return `${styleInstructions[style]}

You are creating a YouTube-style timestamped fight breakdown. The clip is ${durSec} seconds long.
Focus: ${focusActor === 'both' ? 'Both fighters' : `Fighter ${focusActor}`}

RULES:
- Every claim must be grounded in the FightEvidenceLedger data below
- Use specific timestamps from the ledger events/faults/patterns
- Events include CLASSIFIED STRIKES (jab, cross, lead_hook, etc.) — use specific names
- Segment the breakdown into 3-8 timestamped chapters
- Each segment needs a narration script (what you'd SAY in the video) and on-screen text
- The narration should flow naturally — imagine reading it aloud over the footage
- Include tactical analysis: WHY things happen, not just descriptions
- Reference fighter styles from the style assessment

Fight Knowledge (for grounding tactical concepts):
${retrievedBlock}

Style Assessment:
${styleBlock}

FightEvidenceLedger:
${ledgerJson}

OUTPUT FORMAT (valid JSON only, no markdown):
{
  "videoTitle": "string (catchy YouTube title, under 60 chars)",
  "introHook": "string (2-3 sentences to hook the viewer)",
  "segments": [
    {
      "id": "seg_1",
      "startMs": 0,
      "endMs": 5000,
      "title": "string (segment chapter title)",
      "narration": "string (full narration script for this segment — what the analyst says)",
      "onScreenText": "string (key insight for on-screen overlay, under 15 words)",
      "focusActor": "A|B|both",
      "tags": ["string"]
    }
  ],
  "conclusion": "string (wrap-up summary, 2-3 sentences)",
  "keyTakeaways": ["string (3-5 bullet points)"],
  "fullScript": "string (complete narration from intro through conclusion)",
  "overlayAnnotations": [
    {
      "id": "string",
      "actorId": "A|B",
      "time": {"startMs": 0, "endMs": 0},
      "annotationType": "arrow|circle|label|moment|zone",
      "anchorPoints": [{"kind": "bbox_center", "actorId": "A"}],
      "message": "string (tactical label, 3-10 words)",
      "confidence": {"score": 0.8, "basis": "model"},
      "evidence": []
    }
  ]
}

Generate at least 3 segments and 4 overlay annotations. Make the narration compelling and insightful.`
}

export async function generateGroundedBreakdown(args: {
  ledger: FightEvidenceLedger
  retrievedSnippets: Array<{ score: number; text: string; metadata?: Record<string, unknown> }>
  styleAssessments: Array<{ actorId: string; [k: string]: any }>
  style: BreakdownStyle
  focusActor: string
}): Promise<{ model: string; payload: BreakdownPayload; rawText: string }> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured')

  const model = resolvedModels.pro()
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`

  const prompt = buildBreakdownPrompt(args)

  // Retry with exponential backoff
  let lastErr: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.35,
            topP: 0.92,
            topK: 40,
            maxOutputTokens: 8192,
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

      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
      const payload = JSON.parse(String(rawText || '').trim()) as BreakdownPayload

      return { model, payload, rawText }
    } catch (e) {
      lastErr = e
      if (attempt < 3) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))
      }
    }
  }

  throw lastErr ?? new Error('Breakdown generation failed after retries')
}
