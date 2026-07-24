/**
 * Vision-first Pass 1 — the SINGLE full-video Gemini call.
 *
 * Gemini watches the normalized tape (video + audio) once and returns a strict
 * structured evidence ledger. Everything downstream (coaching, chat, Teach
 * compliance, overlays) consumes this JSON; the video is NOT re-sent to the
 * coaching pass. Re-sending the tape is allowed only for a controlled retry
 * or a Shogun diagnostic.
 *
 * Evidence classes are kept strictly separate:
 *   SEEN      — visually observed, timestamped
 *   HEARD     — audio observations (a coach yelling "throw a knee" is HEARD,
 *               never evidence that a knee occurred)
 *   INFERRED  — reasoned from SEEN/HEARD, labeled as such
 *   UNCERTAIN — explicitly unknown (hidden grips, occluded limbs, identity)
 *
 * Model: resolvedModels.vision() (stable gemini-3.6-flash by default).
 * Sampling: videoMetadata.fps from MUSASHI_GEMINI_VIDEO_FPS (default 24, the
 * API maximum). Media resolution: LOW (66 tokens/frame) via generationConfig.
 * Gemini 3.x policy: no temperature/topP/topK overrides (kept at defaults).
 */

import { requireGeminiApiKey } from '@/lib/cloudflare/secrets'
import { resolvedModels } from '@/lib/gemini/models'
import { safeParseResponse } from '@/lib/safeJson'
import {
  buildGeminiVideoFilePart,
  buildGeminiVideoInlinePart,
  GEMINI_MEDIA_RESOLUTION_LOW,
} from '@/lib/gemini/videoFilePart'

export const VISION_EVIDENCE_SCHEMA_VERSION = 'vision-evidence/1'

export type VisionPersonRole =
  | 'fighter'
  | 'referee'
  | 'spectator'
  | 'cameraman'
  | 'coach'
  | 'unknown'

export type VisionPerson = {
  /** Stable id like "p1" — referenced by seen/fighterAssignment entries. */
  id: string
  role: VisionPersonRole
  /** Visible traits only: "tall fighter in black shorts with red gloves". */
  description: string
  /** Rough dominant screen position across the clip. */
  screenPosition: 'left' | 'right' | 'center' | 'foreground' | 'background' | 'moving'
  /** Inside the cage/ring/mat competition area (null when no area visible). */
  insideFightArea: boolean | null
  /** True only for the actual competing fighters. */
  focusCandidate: boolean
  confidence: number
}

export type VisionFighterAssignment = {
  fighterA_personId: string | null
  fighterB_personId: string | null
  /** How A/B were assigned (e.g. "A = left at clip start, blue rash guard"). */
  basis: string
  confidence: number
  /** Corner colors ONLY when visually confirmed; otherwise "unknown". */
  cornerColors: { A: 'blue' | 'red' | 'unknown'; B: 'blue' | 'red' | 'unknown' }
}

export type VisionSeen = {
  startSec: number
  endSec: number
  /** person ids involved (subjects first). */
  personIds: string[]
  observation: string
  confidence: number
}

export type VisionHeard = {
  tSec: number
  kind: 'coach_instruction' | 'crowd' | 'referee' | 'impact' | 'bell' | 'speech' | 'other'
  /** Short transcript/description of the sound. */
  transcript: string
  /** Who/where it came from, if tellable ("corner", "crowd", "referee"). */
  attribution: string
  confidence: number
}

export type VisionInference = {
  inference: string
  /** What SEEN/HEARD facts support it. */
  basis: string
  confidence: number
}

export type VisionPhase = { startSec: number; endSec: number; label: string }
export type VisionCoachingWindow = { startSec: number; endSec: number; reason: string }

export type VisionEvidence = {
  schemaVersion: string
  scene: {
    setting: 'cage' | 'ring' | 'mat' | 'open_gym' | 'outdoor' | 'unknown'
    fightAreaVisible: boolean
    visibilityNotes: string[]
    cameraMotion: 'stable' | 'handheld' | 'moving' | 'unknown'
    orientation: 'landscape' | 'portrait' | 'unknown'
  }
  people: VisionPerson[]
  fighterAssignment: VisionFighterAssignment
  phases: VisionPhase[]
  seen: VisionSeen[]
  heard: VisionHeard[]
  inferred: VisionInference[]
  uncertain: string[]
  coachingWindows: VisionCoachingWindow[]
}

/** Gemini v1beta responseSchema (uppercase type names, enum support). */
export const VISION_EVIDENCE_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    schemaVersion: { type: 'STRING' },
    scene: {
      type: 'OBJECT',
      properties: {
        setting: { type: 'STRING', enum: ['cage', 'ring', 'mat', 'open_gym', 'outdoor', 'unknown'] },
        fightAreaVisible: { type: 'BOOLEAN' },
        visibilityNotes: { type: 'ARRAY', items: { type: 'STRING' } },
        cameraMotion: { type: 'STRING', enum: ['stable', 'handheld', 'moving', 'unknown'] },
        orientation: { type: 'STRING', enum: ['landscape', 'portrait', 'unknown'] },
      },
      required: ['setting', 'fightAreaVisible', 'cameraMotion', 'orientation'],
    },
    people: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          role: { type: 'STRING', enum: ['fighter', 'referee', 'spectator', 'cameraman', 'coach', 'unknown'] },
          description: { type: 'STRING' },
          screenPosition: { type: 'STRING', enum: ['left', 'right', 'center', 'foreground', 'background', 'moving'] },
          insideFightArea: { type: 'BOOLEAN', nullable: true },
          focusCandidate: { type: 'BOOLEAN' },
          confidence: { type: 'NUMBER' },
        },
        required: ['id', 'role', 'description', 'screenPosition', 'focusCandidate', 'confidence'],
      },
    },
    fighterAssignment: {
      type: 'OBJECT',
      properties: {
        fighterA_personId: { type: 'STRING', nullable: true },
        fighterB_personId: { type: 'STRING', nullable: true },
        basis: { type: 'STRING' },
        confidence: { type: 'NUMBER' },
        cornerColors: {
          type: 'OBJECT',
          properties: {
            A: { type: 'STRING', enum: ['blue', 'red', 'unknown'] },
            B: { type: 'STRING', enum: ['blue', 'red', 'unknown'] },
          },
          required: ['A', 'B'],
        },
      },
      required: ['fighterA_personId', 'fighterB_personId', 'basis', 'confidence', 'cornerColors'],
    },
    phases: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          startSec: { type: 'NUMBER' },
          endSec: { type: 'NUMBER' },
          label: { type: 'STRING' },
        },
        required: ['startSec', 'endSec', 'label'],
      },
    },
    seen: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          startSec: { type: 'NUMBER' },
          endSec: { type: 'NUMBER' },
          personIds: { type: 'ARRAY', items: { type: 'STRING' } },
          observation: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
        },
        required: ['startSec', 'endSec', 'personIds', 'observation', 'confidence'],
      },
    },
    heard: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tSec: { type: 'NUMBER' },
          kind: { type: 'STRING', enum: ['coach_instruction', 'crowd', 'referee', 'impact', 'bell', 'speech', 'other'] },
          transcript: { type: 'STRING' },
          attribution: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
        },
        required: ['tSec', 'kind', 'transcript', 'attribution', 'confidence'],
      },
    },
    inferred: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          inference: { type: 'STRING' },
          basis: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
        },
        required: ['inference', 'basis', 'confidence'],
      },
    },
    uncertain: { type: 'ARRAY', items: { type: 'STRING' } },
    coachingWindows: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          startSec: { type: 'NUMBER' },
          endSec: { type: 'NUMBER' },
          reason: { type: 'STRING' },
        },
        required: ['startSec', 'endSec', 'reason'],
      },
    },
  },
  required: [
    'schemaVersion',
    'scene',
    'people',
    'fighterAssignment',
    'phases',
    'seen',
    'heard',
    'inferred',
    'uncertain',
    'coachingWindows',
  ],
} as const

export function buildVisionEvidencePrompt(args: {
  sport?: string | null
  clipType?: string | null
  focusTarget?: string | null
  clipDurationSec?: number | null
}): string {
  const dur = args.clipDurationSec && args.clipDurationSec > 0
    ? `The clip is about ${Math.round(args.clipDurationSec)} seconds long.`
    : ''
  return `You are the evidence extraction stage of Musashi Fight Intelligence. Watch the ENTIRE video, including the audio track, and return one strict JSON evidence ledger. You are NOT coaching yet — you are recording what a careful fight analyst can actually see and hear.

CONTEXT:
- Selected sport: ${args.sport || 'unspecified'}
- Clip type: ${args.clipType || 'unspecified'}
- User focus request: ${args.focusTarget || 'unspecified'}
${dur}

PEOPLE AND ROLES (critical):
- Enumerate EVERY distinct person visible for more than a moment: fighters, referee, coaches, spectators, cameraman/phone-holder shadows.
- A person is a FIGHTER only if they are actively competing/sparring inside the fight area. Referees wear distinct uniforms/gloves and separate fighters. Spectators are outside the cage/ring/mat or watching from the edge. A large person in the foreground near the camera is almost always a spectator or cameraman, NOT a fighter.
- Set focusCandidate=true ONLY for the actual competing fighters. Never a referee, spectator, coach, or cameraman.
- Assign fighterA_personId / fighterB_personId to the two competing fighters. Prefer stable visual anchors (shorts/gi color, build, position at clip start) and state your basis. If you cannot confidently identify two fighters, set the ids to null and explain in "uncertain".
- cornerColors: report "blue"/"red" ONLY when corner color is visually confirmed (gloves, corner pad, rash guard clearly used as corner identity). Otherwise "unknown".

EVIDENCE CLASSES — keep them strictly separate:
- "seen": ONLY what is visually observable, with timestamps in seconds. Techniques, positions, strikes, takedowns, movement, fence/cage work.
- "heard": ONLY audio — coach instructions, crowd, referee commands, impact sounds, bells. A voice shouting "throw a knee" is a HEARD coach_instruction; it is NEVER evidence a knee was thrown. Only a visible knee in "seen" proves a knee.
- "inferred": conclusions you reason to (e.g. "A is the pressure fighter") — always cite the seen/heard basis.
- "uncertain": what you cannot know — hidden grips, occluded limbs, action outside frame, identity doubts. NEVER invent hidden grips, hidden hand positions, or submissions you cannot see. If a limb or grip is obscured, it belongs here.

TIMESTAMPS: seconds from clip start, as numbers (e.g. 4.2). Never invent timestamps.

PHASES: segment the clip into fight phases (e.g. "range finding", "clinch on fence", "ground scramble").

COACHING WINDOWS: 1-4 windows with the highest coaching value (key exchanges, mistakes, transitions) and why.

OUTPUT: exactly the JSON schema you were given, schemaVersion "${VISION_EVIDENCE_SCHEMA_VERSION}". No markdown, no commentary.`
}

export type VisionEvidenceUsage = {
  model: string
  latencyMs: number
  promptTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
}

export type VisionEvidenceResult = {
  evidence: VisionEvidence
  usage: VisionEvidenceUsage
}

type GeminiResponse = {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  usageMetadata?: {
    promptTokenCount?: number
    candidatesTokenCount?: number
    totalTokenCount?: number
  }
  error?: { message?: string }
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/**
 * Sanitize a parsed evidence object: enforce evidence-class separation
 * defensively (drop HEARD-sounding entries from seen, clamp confidences) and
 * guarantee the referee/spectator/cameraman can never be a focus candidate.
 */
export function sanitizeVisionEvidence(raw: VisionEvidence): VisionEvidence {
  const clamp01 = (v: unknown) => Math.max(0, Math.min(1, num(v)))
  const people = (raw.people ?? []).map((p) => ({
    ...p,
    confidence: clamp01(p.confidence),
    // Non-fighters can never be focus candidates, whatever the model said.
    focusCandidate: p.role === 'fighter' ? Boolean(p.focusCandidate) : false,
  }))
  const fighterIds = new Set(people.filter((p) => p.role === 'fighter').map((p) => p.id))
  const fa = raw.fighterAssignment ?? {
    fighterA_personId: null,
    fighterB_personId: null,
    basis: '',
    confidence: 0,
    cornerColors: { A: 'unknown' as const, B: 'unknown' as const },
  }
  const fighterAssignment: VisionFighterAssignment = {
    ...fa,
    confidence: clamp01(fa.confidence),
    // A/B may only point at people the ledger itself classified as fighters.
    fighterA_personId:
      fa.fighterA_personId && fighterIds.has(fa.fighterA_personId) ? fa.fighterA_personId : null,
    fighterB_personId:
      fa.fighterB_personId && fighterIds.has(fa.fighterB_personId) ? fa.fighterB_personId : null,
    cornerColors: {
      A: fa.cornerColors?.A === 'blue' || fa.cornerColors?.A === 'red' ? fa.cornerColors.A : 'unknown',
      B: fa.cornerColors?.B === 'blue' || fa.cornerColors?.B === 'red' ? fa.cornerColors.B : 'unknown',
    },
  }
  return {
    ...raw,
    schemaVersion: VISION_EVIDENCE_SCHEMA_VERSION,
    people,
    fighterAssignment,
    seen: (raw.seen ?? []).map((s) => ({ ...s, confidence: clamp01(s.confidence) })),
    heard: (raw.heard ?? []).map((h) => ({ ...h, confidence: clamp01(h.confidence) })),
    inferred: (raw.inferred ?? []).map((i) => ({ ...i, confidence: clamp01(i.confidence) })),
    uncertain: Array.isArray(raw.uncertain) ? raw.uncertain.map(String) : [],
    phases: raw.phases ?? [],
    coachingWindows: raw.coachingWindows ?? [],
  }
}

/** True when the evidence pass produced something coaching can stand on. */
export function hasUsableVisionEvidence(e: VisionEvidence | null | undefined): boolean {
  if (!e) return false
  return (e.seen?.length ?? 0) > 0 || (e.people?.length ?? 0) > 0
}

/**
 * THE single full-video Gemini call of the normal pipeline (Pass 1).
 *
 * `allowVideo` exists so callers can prove intent: the coaching pass never
 * sets it — only the evidence pass, a controlled retry, or a Shogun
 * diagnostic sends tape.
 */
export async function buildVisionEvidence(args: {
  videoFileUri?: string | null
  videoInlineBase64?: string | null
  videoMimeType?: string | null
  sport?: string | null
  clipType?: string | null
  focusTarget?: string | null
  clipDurationSec?: number | null
  startSec?: number | null
  endSec?: number | null
  /** Explicit fps override (benchmarks); default = MUSASHI_GEMINI_VIDEO_FPS or 24. */
  fps?: number | null
  model?: string | null
  timeoutMs?: number
  apiKey?: string
}): Promise<VisionEvidenceResult> {
  if (!args.videoFileUri && !args.videoInlineBase64) {
    throw new Error('vision evidence pass requires a video (fileUri or inline bytes)')
  }
  const apiKey = args.apiKey || (await requireGeminiApiKey())
  const model = args.model || resolvedModels.vision()
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`

  const videoOpts = {
    window: { startSec: args.startSec, endSec: args.endSec },
    sport: args.sport,
    ...(args.fps ? { fps: args.fps } : {}),
  }
  const videoPart = args.videoInlineBase64
    ? buildGeminiVideoInlinePart(args.videoInlineBase64, args.videoMimeType || 'video/mp4', videoOpts)
    : buildGeminiVideoFilePart(args.videoFileUri!, args.videoMimeType || 'video/mp4', videoOpts)

  const prompt = buildVisionEvidencePrompt({
    sport: args.sport,
    clipType: args.clipType,
    focusTarget: args.focusTarget,
    clipDurationSec: args.clipDurationSec,
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs ?? 120_000)
  const t0 = Date.now()
  try {
    const resp = await fetch(url, {
      method: 'POST',
      // API key in header (never in the query string / server logs).
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [videoPart, { text: prompt }] }],
        generationConfig: {
          // Gemini 3.x: temperature/topP/topK stay at server defaults.
          responseMimeType: 'application/json',
          responseSchema: VISION_EVIDENCE_RESPONSE_SCHEMA,
          mediaResolution: GEMINI_MEDIA_RESOLUTION_LOW,
          maxOutputTokens: 16384,
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      }),
    })
    const latencyMs = Date.now() - t0
    const data = (await safeParseResponse(resp)) as GeminiResponse
    if (!resp.ok) {
      throw new Error(data?.error?.message || `Gemini evidence pass failed: ${resp.status}`)
    }
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
    if (!rawText.trim()) throw new Error('Gemini evidence pass returned an empty response')

    let parsed: VisionEvidence
    try {
      parsed = JSON.parse(rawText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')) as VisionEvidence
    } catch {
      throw new Error(`Gemini evidence pass returned invalid JSON: ${rawText.slice(0, 200)}`)
    }

    return {
      evidence: sanitizeVisionEvidence(parsed),
      usage: {
        model,
        latencyMs,
        promptTokens: data.usageMetadata?.promptTokenCount ?? null,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
        totalTokens: data.usageMetadata?.totalTokenCount ?? null,
      },
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Compact, prompt-ready rendering of the evidence for the coaching pass.
 * Caps each section so a noisy ledger cannot blow up the prompt.
 */
export function formatVisionEvidenceBlock(e: VisionEvidence): string {
  const cap = <T,>(arr: T[] | undefined, n: number): T[] => (arr ?? []).slice(0, n)
  const compact = {
    scene: e.scene,
    people: cap(e.people, 12),
    fighterAssignment: e.fighterAssignment,
    phases: cap(e.phases, 12),
    seen: cap(e.seen, 80),
    heard: cap(e.heard, 30),
    inferred: cap(e.inferred, 20),
    uncertain: cap(e.uncertain, 20),
    coachingWindows: cap(e.coachingWindows, 6),
  }
  return `VISION EVIDENCE LEDGER (PRIMARY SOURCE OF TRUTH — extracted from the actual tape, video + audio):
- "seen" entries are visual facts. "heard" entries are AUDIO ONLY — a shouted instruction is never proof the action happened. "inferred" entries are analyst reasoning. "uncertain" lists what nobody can know from this tape; never contradict it and never invent details it rules out (hidden grips, occluded limbs).
- Coach ONLY people whose role is "fighter". The referee, spectators, coaches, and the cameraman are context, never coaching subjects.

${JSON.stringify(compact, null, 1)}`
}
