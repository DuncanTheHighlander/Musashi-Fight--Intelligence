/**
 * Coach feedback formatter — the single source of truth for turning the
 * internal coaching contract (CoachingPayload) into clean, athlete-facing
 * content.
 *
 * The app uses JSON internally (mainDiagnosis, suggestedCorrections,
 * quickCues, overlayAnnotations, audioScript) — normal users must NEVER see
 * that JSON, its field names, braces, code fences, or fake 00:00 timestamps.
 *
 * Two jobs:
 *   1. buildCoachFeedbackView  — structured view model for the result UI
 *      (Coach's Read / 3 Things to Fix / Drill / Quick Cues / Confidence Note
 *      / Why Musashi says this).
 *   2. sanitizeCoachText       — guard for chat/stream text: if a model reply
 *      leaks the JSON contract into prose, convert it to clean coaching text.
 *
 * Pure TypeScript — safe on both server (API routes) and client (React).
 */
import type { CoachingPayload } from '@/lib/validators/llm-output.validator'

export type CoachFix = Readonly<{
  title: string
  /** What to change, why it matters, what to do instead — readable prose. */
  body: string
  actorId?: string
}>

export type CoachEvidenceMoment = Readonly<{
  /** Human moment language ("Early in the exchange…") or a real timestamp. */
  when: string
  what: string
  actorId?: string
}>

export type CoachFeedbackView = Readonly<{
  coachRead: string
  fixes: CoachFix[]
  drill: { title: string | null; body: string } | null
  quickCues: string[]
  confidenceNote: string | null
  evidence: CoachEvidenceMoment[]
}>

/* ------------------------------------------------------------------ */
/* Confidence note extraction                                          */
/* ------------------------------------------------------------------ */

/**
 * Sentences in the Coach's Read that are really caution/limitation notes
 * (occlusion, cut-off feet, weak tracking, short clip…) get pulled out into
 * a dedicated Confidence Note so the read itself stays coaching-only.
 */
const CAUTION_SENTENCE_RE =
  /(feet[^.]*(cut\s*off|out of frame|not visible|obscured))|(hands?[^.]*(hidden|not visible|obscured))|occlu|camera angle|identity[^.]*(unclear|uncertain)|unclear which fighter|pose\s*(tracking|quality|fallback|confidence)|mediapipe fallback|tracking\s*(was|is)\s*(weak|limited|low)|clip\s*(is|was)?\s*too short|limited because|confidence\s*(note|is\s*(low|limited))|cannot\s*(fully\s*)?(see|read|verify)|can't\s*(fully\s*)?(see|read|verify)|does not show enough|hard to (see|read|verify)/i

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Render-time safety net: convert leaked millisecond tokens in AI prose to
 * human clip time. "2135ms" / "2135 ms" / "t=2135ms" → "2.1s". Never shows
 * raw milliseconds on screen even when the model slips.
 */
export function formatHumanTimes(text: string): string {
  if (typeof text !== 'string' || !text) return text
  return text.replace(
    /\b(?:t\s*=\s*)?(\d{2,})\s*m(?:illi)?s(?:ec(?:ond)?s?)?\b/gi,
    (_match, digits: string) => {
      const ms = Number(digits)
      if (!Number.isFinite(ms) || ms < 0) return _match
      // Whole seconds when clean; one decimal otherwise (e.g. 2135 → 2.1s).
      const sec = ms / 1000
      const rounded = Math.round(sec * 10) / 10
      const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
      return `${label}s`
    }
  )
}

/** Splits caution sentences out of a diagnosis. */
export function extractConfidenceNote(text: string): { read: string; note: string | null } {
  const sentences = splitSentences(text)
  if (sentences.length <= 1) return { read: text.trim(), note: null }
  const cautions = sentences.filter((s) => CAUTION_SENTENCE_RE.test(s))
  if (cautions.length === 0) return { read: text.trim(), note: null }
  const rest = sentences.filter((s) => !CAUTION_SENTENCE_RE.test(s))
  // Never strip the read down to nothing.
  if (rest.length === 0) return { read: text.trim(), note: null }
  return { read: rest.join(' '), note: cautions.join(' ') }
}

/* ------------------------------------------------------------------ */
/* View model                                                          */
/* ------------------------------------------------------------------ */

/** Strips machine prefixes like "Adjustment 1 - " / "Fix 2:" from titles. */
function cleanTitle(title: string): string {
  return title
    .replace(/^\s*(adjustment|fix|correction)\s*\d\s*[-–—:.]\s*/i, '')
    .replace(/^\s*\d+\s*[.)]\s*/, '')
    .trim()
}

function isDrillLike(text: string): boolean {
  return /\bdrill\b|\brounds?\s+of\b|\breps\b|\bshadowbox/i.test(text)
}

const MOMENT_FALLBACKS = [
  'Early in the exchange',
  'As the exchange develops',
  'Late in the exchange',
]

function formatTimestamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/**
 * Real timestamps only: 0ms is almost always a filler value from the model
 * (the fake "00:00" problem), so it gets moment language instead
 * ("Early in the exchange…").
 */
export function describeMoment(
  startMs: number | undefined,
  clipDurationMs: number | null | undefined,
  fallbackIndex: number
): string {
  if (typeof startMs === 'number' && Number.isFinite(startMs) && startMs > 0) {
    // A timestamp beyond the clip is invented — treat it as unavailable.
    if (typeof clipDurationMs === 'number' && clipDurationMs > 0 && startMs > clipDurationMs) {
      return MOMENT_FALLBACKS[fallbackIndex % MOMENT_FALLBACKS.length]
    }
    return `Around ${formatTimestamp(startMs)}`
  }
  return MOMENT_FALLBACKS[fallbackIndex % MOMENT_FALLBACKS.length]
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Tolerates both the full CoachingCue shape and looser `{ text }` mocks. */
function cueText(cue: unknown): string {
  if (!cue || typeof cue !== 'object') return ''
  const c = cue as Record<string, unknown>
  return asText(c.quickCue) || asText(c.text)
}

export function buildCoachFeedbackView(
  payload: CoachingPayload,
  opts?: { clipDurationMs?: number | null }
): CoachFeedbackView {
  const { read, note } = extractConfidenceNote(asText(payload.mainDiagnosis))

  const corrections = Array.isArray(payload.suggestedCorrections)
    ? payload.suggestedCorrections.filter((c) => asText(c?.title) || asText(c?.why) || asText(c?.doInstead))
    : []

  const fixes: CoachFix[] = corrections.slice(0, 3).map((c) => {
    const parts = [asText(c.why), asText(c.doInstead)].filter(Boolean)
    return {
      title: cleanTitle(asText(c.title)) || 'Adjustment',
      body: parts.join(' '),
      actorId: c.actorId,
    }
  })

  // Drill: one drill tied to the main issue. The third correction is the
  // training-habit fix by contract; prefer whichever correction actually
  // reads like a drill prescription.
  let drill: CoachFeedbackView['drill'] = null
  const drillSource =
    corrections.find((c) => isDrillLike(asText(c.title)) || isDrillLike(asText(c.doInstead))) ??
    (corrections.length >= 3 ? corrections[2] : null)
  if (drillSource) {
    const body = asText(drillSource.doInstead) || asText(drillSource.why)
    if (body) {
      drill = {
        title: isDrillLike(asText(drillSource.title)) ? cleanTitle(asText(drillSource.title)) : null,
        body,
      }
    }
  }

  const rawCues = Array.isArray(payload.quickCues) ? payload.quickCues : []
  const quickCues = Array.from(new Set(rawCues.map(cueText).filter(Boolean))).slice(0, 5)

  // "Why Musashi says this" — replay evidence in human moment language.
  const evidence: CoachEvidenceMoment[] = []
  const clipDurationMs = opts?.clipDurationMs ?? null
  let momentIdx = 0
  for (const cue of rawCues) {
    const what = asText((cue as Record<string, unknown>)?.keyMistake) || cueText(cue)
    if (!what) continue
    const startMs = (cue as { t?: { startMs?: number } })?.t?.startMs
    evidence.push({
      when: describeMoment(startMs, clipDurationMs, momentIdx++),
      what,
      actorId: (cue as { actorId?: string })?.actorId,
    })
    if (evidence.length >= 4) break
  }

  return {
    coachRead: formatHumanTimes(read),
    fixes: fixes.map((f) => ({
      ...f,
      title: formatHumanTimes(f.title),
      body: formatHumanTimes(f.body),
    })),
    drill: drill
      ? {
          title: drill.title ? formatHumanTimes(drill.title) : null,
          body: formatHumanTimes(drill.body),
        }
      : null,
    quickCues: quickCues.map(formatHumanTimes),
    confidenceNote: note ? formatHumanTimes(note) : null,
    evidence: evidence.map((ev) => ({
      ...ev,
      when: formatHumanTimes(ev.when),
      what: formatHumanTimes(ev.what),
    })),
  }
}

/* ------------------------------------------------------------------ */
/* Prose rendering + chat sanitization                                 */
/* ------------------------------------------------------------------ */

const FIGHTER_LABELS: Record<string, string> = { A: 'Fighter A', B: 'Fighter B' }

function fixLine(fix: CoachFix, index: number): string {
  const who = fix.actorId && FIGHTER_LABELS[fix.actorId] ? `${FIGHTER_LABELS[fix.actorId]} — ` : ''
  return `${index + 1}. ${who}${fix.title}\n   ${fix.body}`.trimEnd()
}

/** Renders a coaching payload as clean plain-text coaching (for chat/TTS). */
export function coachingPayloadToProse(
  payload: CoachingPayload,
  opts?: { clipDurationMs?: number | null }
): string {
  const view = buildCoachFeedbackView(payload, opts)
  const sections: string[] = []

  if (view.coachRead) sections.push(`Coach's Read\n${view.coachRead}`)

  if (view.fixes.length > 0) {
    const header = view.fixes.length === 3 ? '3 Things to Fix' : 'What to Fix'
    sections.push(`${header}\n${view.fixes.map(fixLine).join('\n\n')}`)
  }

  if (view.drill) {
    sections.push(`Drill${view.drill.title ? ` — ${view.drill.title}` : ''}\n${view.drill.body}`)
  }

  if (view.quickCues.length > 0) {
    sections.push(`Quick Cues\n${view.quickCues.map((c) => `- ${c}`).join('\n')}`)
  }

  if (view.confidenceNote) {
    sections.push(`Confidence note: ${view.confidenceNote}`)
  }

  return sections.join('\n\n').trim()
}

/** Internal contract keys — their presence marks a leaked machine payload. */
const COACHING_JSON_KEYS = [
  'mainDiagnosis',
  'suggestedCorrections',
  'quickCues',
  'overlayAnnotations',
  'audioScript',
  'styleNotes',
]

export function looksLikeCoachingJson(text: string): boolean {
  if (!text.includes('{')) return false
  return COACHING_JSON_KEYS.some((k) => text.includes(`"${k}"`))
}

function tryParseCoachingPayload(candidate: string): CoachingPayload | null {
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return null
    const hasKey = COACHING_JSON_KEYS.some((k) => k in parsed)
    if (!hasKey) return null
    return {
      quickCues: Array.isArray(parsed.quickCues) ? parsed.quickCues : [],
      mainDiagnosis: asText(parsed.mainDiagnosis),
      styleNotes: Array.isArray(parsed.styleNotes) ? parsed.styleNotes : [],
      suggestedCorrections: Array.isArray(parsed.suggestedCorrections)
        ? parsed.suggestedCorrections
        : [],
      overlayAnnotations: Array.isArray(parsed.overlayAnnotations) ? parsed.overlayAnnotations : [],
      audioScript: asText(parsed.audioScript) || undefined,
    } as CoachingPayload
  } catch {
    return null
  }
}

/**
 * Last-resort extraction when the JSON is truncated or malformed: pull the
 * known text fields out with regexes and rebuild readable coaching. Never
 * returns braces or field names.
 */
function scrapeCoachingText(text: string): string | null {
  const grab = (field: string): string[] => {
    const re = new RegExp(`"${field}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'g')
    const out: string[] = []
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const v = m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim()
      if (v) out.push(v)
    }
    return out
  }

  const diagnosis = grab('mainDiagnosis')[0]
  const cues = grab('quickCue')
  const titles = grab('title')
  const whys = grab('why')
  const doInsteads = grab('doInstead')

  const sections: string[] = []
  if (diagnosis) sections.push(`Coach's Read\n${diagnosis}`)
  if (titles.length > 0) {
    const items = titles.slice(0, 3).map((t, i) => {
      const detail = [whys[i], doInsteads[i]].filter(Boolean).join(' ')
      return `${i + 1}. ${cleanTitle(t)}${detail ? `\n   ${detail}` : ''}`
    })
    sections.push(`${titles.length >= 3 ? '3 Things to Fix' : 'What to Fix'}\n${items.join('\n\n')}`)
  }
  if (cues.length > 0) {
    sections.push(`Quick Cues\n${cues.slice(0, 5).map((c) => `- ${c}`).join('\n')}`)
  }

  return sections.length > 0 ? sections.join('\n\n') : null
}

/**
 * Chat/stream guard: if the text contains a leaked coaching-JSON payload
 * (whole message, or embedded in a code fence), replace it with clean
 * coaching prose. Plain prose passes through untouched.
 */
export function sanitizeCoachText(
  text: string,
  opts?: { clipDurationMs?: number | null }
): string {
  if (typeof text !== 'string' || !text.trim()) return ''
  if (!looksLikeCoachingJson(text)) {
    // Still strip stray code fences so users never see developer formatting.
    const cleaned = text.includes('```') ? text.replace(/```[a-z]*\n?/gi, '').trim() : text
    return formatHumanTimes(cleaned)
  }

  // Prefer a fenced block; otherwise take the outermost brace span.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  let candidate = fenced?.[1] ?? null
  if (!candidate) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start !== -1 && end > start) candidate = text.slice(start, end + 1)
  }

  const payload = candidate ? tryParseCoachingPayload(candidate) : null
  const prose = payload
    ? coachingPayloadToProse(payload, opts)
    : scrapeCoachingText(text)

  if (!prose) {
    // Could not recover anything readable — return a clean failure message
    // instead of ever showing raw JSON to the user.
    return 'The coach hit a formatting problem while writing this feedback. Please run the analysis again.'
  }

  // Keep any human-written prose around the leaked block.
  let before = ''
  let after = ''
  if (fenced) {
    const idx = text.indexOf(fenced[0])
    before = text.slice(0, idx).trim()
    after = text.slice(idx + fenced[0].length).trim()
  } else if (candidate) {
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    before = text.slice(0, start).trim()
    after = text.slice(end + 1).trim()
  }
  // Surrounding fragments that still look like JSON debris get dropped.
  if (/[{}[\]"]{2,}/.test(before) || looksLikeCoachingJson(before)) before = ''
  if (/[{}[\]"]{2,}/.test(after) || looksLikeCoachingJson(after)) after = ''

  return formatHumanTimes([before, prose, after].filter(Boolean).join('\n\n').trim())
}
