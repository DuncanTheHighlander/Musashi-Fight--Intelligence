export const SENSEI_CUE_MAX_WORDS = 8

type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type Point1000 = Readonly<{
  x: number
  y: number
}>

export type FighterSpatialMap = Readonly<{
  center?: Point1000
  head?: Point1000
  leadHand?: Point1000
  rearHand?: Point1000
  leadFoot?: Point1000
  rearFoot?: Point1000
}>

export type ReflexFrameContext = {
  focusTarget?: string
  fighterProfile?: unknown
  fighterProfiles?: unknown
  gymRules?: unknown
  adminRules?: unknown
  kinematics?: unknown
  sessionId?: string
  [key: string]: unknown
}

export type ReflexFrameAnalysis = {
  cue: string
  focus: 'guard' | 'feet' | 'timing' | 'range' | 'defense' | 'offense' | 'clinching' | 'unknown'
  target: 'A' | 'B' | 'both' | 'unknown'
  urgency: 'low' | 'medium' | 'high'
  confidence: number
  spatialMap: {
    fighterA?: FighterSpatialMap
    fighterB?: FighterSpatialMap
    exchangeCenter?: Point1000
  }
  fighterA: {
    stance: string
    guard: string
    position: string
    technique: string
    openings: string[]
  }
  fighterB: {
    stance: string
    guard: string
    position: string
    technique: string
    openings: string[]
  }
  exchange: {
    range: string
    tempo: string
    advantage: string
  }
  coaching: {
    immediate: string[]
    strategic: string[]
    drills: string[]
  }
}

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } }

export type GeminiReflexFrameRequest = Readonly<{
  contents: Array<{ role: 'user'; parts: GeminiPart[] }>
  generationConfig: {
    temperature: number
    topP: number
    maxOutputTokens: number
    responseMimeType: 'application/json'
    responseJsonSchema: Record<string, JsonValue>
    thinkingConfig: { thinkingBudget: number }
  }
}>

const DEFAULT_CUE = 'HANDS UP. CHIN DOWN.'

const allowedFocus = new Set<ReflexFrameAnalysis['focus']>([
  'guard',
  'feet',
  'timing',
  'range',
  'defense',
  'offense',
  'clinching',
  'unknown',
])

const allowedTarget = new Set<ReflexFrameAnalysis['target']>(['A', 'B', 'both', 'unknown'])
const allowedUrgency = new Set<ReflexFrameAnalysis['urgency']>(['low', 'medium', 'high'])

const pointSchema = {
  type: 'object',
  properties: {
    x: { type: 'integer', description: '0-1000 normalized horizontal coordinate' },
    y: { type: 'integer', description: '0-1000 normalized vertical coordinate' },
  },
  required: ['x', 'y'],
}

const fighterMapSchema = {
  type: 'object',
  properties: {
    center: pointSchema,
    head: pointSchema,
    leadHand: pointSchema,
    rearHand: pointSchema,
    leadFoot: pointSchema,
    rearFoot: pointSchema,
  },
}

const fighterReadSchema = {
  type: 'object',
  properties: {
    stance: { type: 'string' },
    guard: { type: 'string' },
    position: { type: 'string' },
    technique: { type: 'string' },
    openings: { type: 'array', items: { type: 'string' } },
  },
  required: ['stance', 'guard', 'position', 'technique', 'openings'],
}

export const REFLEX_FRAME_RESPONSE_SCHEMA: Record<string, JsonValue> = {
  type: 'object',
  properties: {
    cue: {
      type: 'string',
      description: 'Ultra-short Voice of Sensei cue, maximum 8 words.',
    },
    focus: {
      type: 'string',
      enum: ['guard', 'feet', 'timing', 'range', 'defense', 'offense', 'clinching', 'unknown'],
    },
    target: {
      type: 'string',
      enum: ['A', 'B', 'both', 'unknown'],
    },
    urgency: {
      type: 'string',
      enum: ['low', 'medium', 'high'],
    },
    confidence: {
      type: 'number',
    },
    spatialMap: {
      type: 'object',
      properties: {
        fighterA: fighterMapSchema,
        fighterB: fighterMapSchema,
        exchangeCenter: pointSchema,
      },
    },
    fighterA: fighterReadSchema,
    fighterB: fighterReadSchema,
    exchange: {
      type: 'object',
      properties: {
        range: { type: 'string' },
        tempo: { type: 'string' },
        advantage: { type: 'string' },
      },
      required: ['range', 'tempo', 'advantage'],
    },
    coaching: {
      type: 'object',
      properties: {
        immediate: { type: 'array', items: { type: 'string' } },
        strategic: { type: 'array', items: { type: 'string' } },
        drills: { type: 'array', items: { type: 'string' } },
      },
      required: ['immediate', 'strategic', 'drills'],
    },
  },
  required: [
    'cue',
    'focus',
    'target',
    'urgency',
    'confidence',
    'spatialMap',
    'fighterA',
    'fighterB',
    'exchange',
    'coaching',
  ],
}

const normalizeFocusTarget = (value: unknown): 'A' | 'B' | 'both' => {
  if (value === 'A' || value === 'blue') return 'A'
  if (value === 'B' || value === 'red') return 'B'
  return 'both'
}

const stringifyForPrompt = (value: unknown, limit = 1800): string => {
  if (value === undefined || value === null || value === '') return 'None.'
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return text.slice(0, limit)
  } catch {
    return String(value).slice(0, limit)
  }
}

export function buildReflexFramePrompt(context: ReflexFrameContext = {}): string {
  const focusTarget = normalizeFocusTarget(context.focusTarget)
  const fighterMemory = context.fighterProfile ?? context.fighterProfiles
  const gymRuleMemory = context.gymRules ?? context.adminRules

  return [
    'You are Musashi Reflex, an elite real-time fight intelligence engine.',
    'RAW FRAME IS THE SOURCE OF TRUTH. Analyze the raw canvas frame end-to-end.',
    'Do not rely on MediaPipe-style heuristics when vision can decide directly.',
    'Map all visible fighter coordinates onto a 0-1000 coordinate plane.',
    'Return tactical semantics and spatial mapping in one JSON object.',
    '',
    'VOICE OF SENSEI CONTRACT:',
    `- cue must be ${SENSEI_CUE_MAX_WORDS} words or fewer.`,
    '- cue must be a command a fighter can execute immediately.',
    '- No disclaimers. No markdown. No prose outside JSON.',
    '- Prefer impact like: HANDS UP. CHIN DOWN.',
    '',
    `FOCUS TARGET: ${focusTarget}`,
    focusTarget === 'A'
      ? 'Prioritize Fighter A. Only cue Fighter B if A is not visible.'
      : focusTarget === 'B'
        ? 'Prioritize Fighter B. Only cue Fighter A if B is not visible.'
        : 'Read both fighters and cue the most urgent correction.',
    '',
    'FIGHTER PROFILE RAM:',
    stringifyForPrompt(fighterMemory),
    '',
    'CUSTOM GYM RULES RAM:',
    stringifyForPrompt(gymRuleMemory),
    '',
    'KINEMATICS RAM:',
    stringifyForPrompt(context.kinematics),
  ].join('\n')
}

export function buildGeminiReflexFrameRequest(args: {
  imageBase64: string
  mimeType: string
  context?: ReflexFrameContext
}): GeminiReflexFrameRequest {
  return {
    contents: [
      {
        role: 'user',
        parts: [
          { text: buildReflexFramePrompt(args.context) },
          { inlineData: { mimeType: args.mimeType || 'image/jpeg', data: args.imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.15,
      topP: 0.8,
      maxOutputTokens: 512,
      responseMimeType: 'application/json',
      responseJsonSchema: REFLEX_FRAME_RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: 0 },
    },
  }
}

const clamp01 = (value: unknown): number => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

const clamp1000 = (value: unknown): number => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.max(0, Math.min(1000, n)))
}

const sanitizePoint = (value: unknown): Point1000 | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const p = value as Record<string, unknown>
  return { x: clamp1000(p.x), y: clamp1000(p.y) }
}

const sanitizeFighterMap = (value: unknown): FighterSpatialMap | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const map = value as Record<string, unknown>
  return {
    center: sanitizePoint(map.center),
    head: sanitizePoint(map.head),
    leadHand: sanitizePoint(map.leadHand),
    rearHand: sanitizePoint(map.rearHand),
    leadFoot: sanitizePoint(map.leadFoot),
    rearFoot: sanitizePoint(map.rearFoot),
  }
}

const stringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
}

const sanitizeCue = (value: unknown): string => {
  const text = String(value || '').trim().replace(/\s+/g, ' ')
  const words = text ? text.split(' ').filter(Boolean) : DEFAULT_CUE.split(' ')
  return words.slice(0, SENSEI_CUE_MAX_WORDS).join(' ') || DEFAULT_CUE
}

const sanitizeFighterRead = (value: unknown): ReflexFrameAnalysis['fighterA'] => {
  const read = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  return {
    stance: String(read.stance || 'unknown'),
    guard: String(read.guard || 'unknown'),
    position: String(read.position || 'unknown'),
    technique: String(read.technique || 'unknown'),
    openings: stringArray(read.openings),
  }
}

export function sanitizeReflexFrameAnalysis(value: unknown): ReflexFrameAnalysis {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const cue = sanitizeCue(raw.cue)
  const focus = allowedFocus.has(raw.focus as ReflexFrameAnalysis['focus'])
    ? (raw.focus as ReflexFrameAnalysis['focus'])
    : 'unknown'
  const target = allowedTarget.has(raw.target as ReflexFrameAnalysis['target'])
    ? (raw.target as ReflexFrameAnalysis['target'])
    : 'unknown'
  const urgency = allowedUrgency.has(raw.urgency as ReflexFrameAnalysis['urgency'])
    ? (raw.urgency as ReflexFrameAnalysis['urgency'])
    : 'medium'

  const rawSpatial = raw.spatialMap && typeof raw.spatialMap === 'object'
    ? (raw.spatialMap as Record<string, unknown>)
    : {}
  const rawCoaching = raw.coaching && typeof raw.coaching === 'object'
    ? (raw.coaching as Record<string, unknown>)
    : {}

  return {
    cue,
    focus,
    target,
    urgency,
    confidence: clamp01(raw.confidence),
    spatialMap: {
      fighterA: sanitizeFighterMap(rawSpatial.fighterA),
      fighterB: sanitizeFighterMap(rawSpatial.fighterB),
      exchangeCenter: sanitizePoint(rawSpatial.exchangeCenter),
    },
    fighterA: sanitizeFighterRead(raw.fighterA),
    fighterB: sanitizeFighterRead(raw.fighterB),
    exchange: {
      range: String((raw.exchange as Record<string, unknown> | undefined)?.range || 'unknown'),
      tempo: String((raw.exchange as Record<string, unknown> | undefined)?.tempo || 'unknown'),
      advantage: String((raw.exchange as Record<string, unknown> | undefined)?.advantage || 'unknown'),
    },
    coaching: {
      immediate: [cue, ...stringArray(rawCoaching.immediate).filter((item) => item !== cue)].slice(0, 4),
      strategic: stringArray(rawCoaching.strategic),
      drills: stringArray(rawCoaching.drills),
    },
  }
}

export function extractGeminiText(data: unknown): string {
  const response = data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }
  return response?.candidates?.[0]?.content?.parts?.map((part) => part.text).filter(Boolean).join('\n') || ''
}

export function parseReflexFrameJson(text: string): ReflexFrameAnalysis {
  const trimmed = String(text || '').trim()
  const jsonText = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
  return sanitizeReflexFrameAnalysis(JSON.parse(jsonText))
}
