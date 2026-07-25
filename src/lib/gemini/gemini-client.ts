import { safeParseResponse } from '@/lib/safeJson'
import type { FightEvidenceLedger } from '@/lib/fightlang/fightlang.types'
import type { CoachingPayload } from '@/lib/validators/llm-output.validator'
import { GEMINI_MODEL_DEFAULT, GEMINI_EMBED_MODEL_DEFAULT, isGemini3Model, resolvedModels } from '@/lib/gemini/models'
import { formatVisionEvidenceBlock, type VisionEvidence } from '@/lib/evidence/visionEvidence'
import { formatFighterNamingBlock, resolveFighterNaming } from '@/lib/fight/fighterNaming'
import { getServerSecret, requireGeminiApiKey } from '@/lib/cloudflare/secrets'
import { getCoachingCache, sha256Hex } from '@/lib/ai/coachingCache'
import { buildCoachBrainBlock, type CoachBrainContext } from '@/lib/coachBrain/coachBrain'
import { isGrapplingClip } from '@/lib/grapplingAnalysisPrompt'
import type { FactualLedger } from '@/lib/fightAnalysisPrompt'
import type { TemporalEvidence } from '@/lib/evidence/sessionEvidenceExtensions'
import {
  buildGeminiVideoFilePart,
  buildGeminiVideoInlinePart,
  GEMINI_MEDIA_RESOLUTION_LOW,
} from '@/lib/gemini/videoFilePart'

class GeminiQuotaError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'GeminiQuotaError'
    this.status = status
  }
}

export type GeminiModelName = string & {}
export type CoachingFocusTarget = 'A' | 'B' | 'both' | 'unsure'

export type GeminiClientConfig = Readonly<{
  apiKey?: string
  embedModel?: GeminiModelName
  reasonModel?: GeminiModelName
}>

type GeminiGenerateResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> }
    /** 'STOP' | 'MAX_TOKENS' | 'SAFETY' | 'RECITATION' | … */
    finishReason?: string
  }>
  error?: { message?: string }
}

/**
 * First usable payload part. Gemini 3.x thinking models can return a thought /
 * thought-summary part BEFORE the answer, so `parts[0].text` is not safe —
 * reading it verbatim is how chain-of-thought ("Let's check position…") ended
 * up being parsed as the JSON payload.
 *
 * Returns the FIRST non-thought text part, never a concatenation: with
 * responseMimeType 'application/json' the payload is a single part, and
 * joining would corrupt it if a stray part appears alongside.
 */
export function firstPayloadText(candidate: NonNullable<GeminiGenerateResponse['candidates']>[number] | undefined): string {
  const parts = candidate?.content?.parts
  if (!Array.isArray(parts)) return ''
  for (const part of parts) {
    if (part?.thought === true) continue
    if (typeof part?.text === 'string' && part.text.trim()) return part.text
  }
  return ''
}

/** Non-STOP finish reasons that need their own user-facing message. */
function finishReasonError(finishReason: string | undefined): Error | null {
  switch (finishReason) {
    case 'MAX_TOKENS':
      return new Error(
        'Gemini response was cut off before it finished (MAX_TOKENS) — the model ran out of output budget.',
      )
    case 'SAFETY':
      return new Error('Gemini blocked this response (SAFETY).')
    case 'RECITATION':
      return new Error('Gemini blocked this response (RECITATION).')
    default:
      return null
  }
}

/** True when the failure is a truncation we can retry with a bigger budget. */
export function isMaxTokensError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('MAX_TOKENS')
}

const resolveKey = async (explicit?: string): Promise<string> => {
  if (explicit) return explicit
  return requireGeminiApiKey()
}

const defaultEmbedModel = (): GeminiModelName =>
  ((process.env.GEMINI_EMBED_MODEL || GEMINI_EMBED_MODEL_DEFAULT) as GeminiModelName)

const defaultReasonModel = (): GeminiModelName =>
  ((process.env.GEMINI_REASON_MODEL || process.env.GEMINI_MODEL || GEMINI_MODEL_DEFAULT) as GeminiModelName)

const normalizeCoachingFocus = (focus?: CoachingFocusTarget): CoachingFocusTarget =>
  focus === 'A' || focus === 'B' || focus === 'unsure' ? focus : 'both'

function buildCoachingFocusBlock(
  focus?: CoachingFocusTarget,
  opts?: { visionScreenMapping?: boolean },
): string {
  const screenMapping =
    opts?.visionScreenMapping
      ? [
          'SCREEN IDENTITY (no pose track): Fighter A is the fighter on the LEFT side of the screen; Fighter B is on the RIGHT. Coach accordingly.',
        ]
      : []
  const normalized = normalizeCoachingFocus(focus)
  if (normalized === 'A') {
    return [
      'FOCUS TARGET: Fighter A / blue corner',
      ...screenMapping,
      '- quickCues MUST use actorId "A".',
      '- suggestedCorrections MUST use actorId "A".',
      '- overlayAnnotations MUST use actorId "A".',
      '- You may mention Fighter B only as context for the opening, threat, or tactical consequence.',
    ].join('\n')
  }
  if (normalized === 'B') {
    return [
      'FOCUS TARGET: Fighter B / red corner',
      ...screenMapping,
      '- quickCues MUST use actorId "B".',
      '- suggestedCorrections MUST use actorId "B".',
      '- overlayAnnotations MUST use actorId "B".',
      '- You may mention Fighter A only as context for the opening, threat, or tactical consequence.',
    ].join('\n')
  }
  if (normalized === 'unsure') {
    return [
      'FOCUS TARGET: not sure which fighter (identity uncertain)',
      ...screenMapping,
      '- The user could not confidently identify which fighter is theirs. Handle identity cautiously.',
      '- If one athlete is clearly more visible and coachable in the footage, coach that athlete — but state which one you mean by visible traits ("the fighter in dark shorts / Fighter A per tracking") instead of assuming identity.',
      '- If identity stays unclear (similar gear, tracker swaps, heavy occlusion), coach the exchange as a whole: the pattern, the cause-and-effect, and corrections framed so either athlete can apply them.',
      '- Still use actorId "A" or "B" in JSON fields (best effort from the ledger tracking), but avoid strong identity-based claims in the coaching text.',
    ].join('\n')
  }
  return [
    'FOCUS TARGET: both fighters',
    ...screenMapping,
    '- Explain the exchange, then give concise, useful feedback for EACH fighter.',
    '- Structure the 3 suggestedCorrections as: (1) Fighter A — their main fix, (2) Fighter B — their main fix, (3) the shared lesson both fighters should take from the exchange.',
    '- Keep it tight: do not double the response length — pick the highest-value read per fighter.',
    '- Use actorId "A" or "B" on every cue, correction, and overlay annotation.',
  ].join('\n')
}

export function applyCoachingFocus(payload: CoachingPayload, focus?: CoachingFocusTarget): CoachingPayload {
  const normalized = normalizeCoachingFocus(focus)
  // 'both' and 'unsure' keep every cue: with uncertain identity, dropping one
  // actor's coaching risks deleting the feedback the user actually wanted.
  if (normalized === 'both' || normalized === 'unsure') return payload

  return {
    ...payload,
    quickCues: payload.quickCues.filter((cue) => cue.actorId === normalized),
    suggestedCorrections: payload.suggestedCorrections.filter((correction) => correction.actorId === normalized),
    overlayAnnotations: payload.overlayAnnotations.filter((annotation) => annotation.actorId === normalized),
  }
}

export function buildGroundedCoachingPrompt(args: {
  ledger: FightEvidenceLedger
  retrievedSnippets: Array<{ score: number; text: string; metadata?: Record<string, unknown> }>
  focusTarget?: CoachingFocusTarget
  /** Coach-brain context: selectedSport, clipType, userQuestion, poseEngine, poseQuality. */
  coachBrain?: CoachBrainContext
  /** Verified vision ledger from Flash scan + verification pass (Phase 2). */
  visionLedger?: FactualLedger | null
  /** Phase 3 temporal context: exchange windows + peak motion burst. */
  temporalEvidence?: TemporalEvidence | null
  /** When true (vision-first / no pose), map Fighter A=LEFT and B=RIGHT on screen. */
  visionScreenMapping?: boolean
  /**
   * Approved human corrections for THIS exact clip (same owner).
   * Attached beside retrieval — never inside coach-brain text.
   */
  approvedCorrectionsBlock?: string | null
  /**
   * Vision-first Pass 1 evidence (SEEN/HEARD/INFERRED/UNCERTAIN). When present
   * it is the PRIMARY source of truth and the FightLang ledger is demoted to
   * supporting evidence — the tape itself is NOT re-sent on this pass.
   */
  visionEvidence?: VisionEvidence | null
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

  // Coach brain: global coach rules always, plus the selected sport's brain
  // when it resolves. Appended context — never replaces the ledger contract.
  const coachBrainBlock = buildCoachBrainBlock({
    ...args.coachBrain,
    fighterFocus: args.coachBrain?.fighterFocus ?? normalizeCoachingFocus(args.focusTarget),
  })

  // Grappling clips: pose tracking collapses under body-on-body occlusion, so
  // the compiler's striking-classified events are artifacts, not evidence.
  // This override loosens the striking straitjacket without touching the
  // striking pipeline.
  const isGrappling = isGrapplingClip({
    discipline: args.coachBrain?.selectedSport,
    clipType: args.coachBrain?.clipType,
  })
  const grapplingOverrideBlock = isGrappling
    ? `
GRAPPLING EVIDENCE OVERRIDE (CRITICAL — this clip is BJJ/grappling):
- Body-on-body grappling causes severe pose-tracking occlusion, so the FightEvidenceLedger is highly prone to errors on this clip.
- If the ledger contains striking-classified events (jab, cross, hooks, kicks) or striking faults (guard_drop, guard_low), treat them as compiler artifacts and IGNORE them entirely. Do not coach punches on a grappling roll.
- On a grappling clip, if the ledger contains only guard/strike faults, treat the FightEvidenceLedger as EMPTY. Do not rebrand striking faults into grappling advice (never turn "low guard" into chokes or "keep your hands up" on a roll). Coach exclusively from the video (and VideoAnalysisLedger when present). Name the actual positions and transitions you see. Pose data may only inform pacing and scramble intensity — never technique claims.
${
  args.visionLedger?.video_analysis_ledger?.length
    ? `- The VideoAnalysisLedger below is your ABSOLUTE SOURCE OF TRUTH for positions, transitions, and techniques. Coach ONLY what appears in techniques_identified and action_events. If techniques_identified is "UNKNOWN", say you cannot name the technique confidently — never substitute ARMBAR or TRIANGLE for a wrist ride or grip fight.`
    : `- If a video file is attached, the video is your primary evidence for positions, transitions, frames, and submissions.`
}
- Coach positional hierarchy, wedges and frames: did the athlete establish position before hunting the submission? Did the top player clear frames and pin the hips? Did the bottom player build skeletal structures to manage weight?
- If the footage is occluded or a scramble is chaotic, say so plainly in the confidence note — never reconstruct hidden grips, hooks, or foot positions.
- The 3 suggestedCorrections must be grappling corrections (frames, hips, posture, underhooks, grip fight, guard retention, passing stability, control before submission, escape from ride/back) — never striking corrections.`
    : ''

  const visionLedgerBlock =
    isGrappling && args.visionLedger?.video_analysis_ledger?.length
      ? `

VIDEO ANALYSIS LEDGER (VERIFIED — ABSOLUTE SOURCE OF TRUTH for this grappling clip):
${JSON.stringify(
  {
    video_analysis_ledger: args.visionLedger.video_analysis_ledger,
    forbidden_claims: args.visionLedger.forbidden_claims ?? [],
    unknowns: args.visionLedger.unknowns ?? [],
    video_quality_notes: args.visionLedger.video_quality_notes ?? [],
  },
  null,
  2,
)}

`
      : ''

  const burst = args.temporalEvidence?.motionBurst
  const centerSec = burst ? (burst.centerMs / 1000).toFixed(1) : null
  const temporalBurstBlock = burst
    ? `

HIGH-RESOLUTION MOTION BURST (±500ms around peak scramble at ${centerSec}s):
- Peak motion score: ${burst.peakScore.toFixed(2)} (${burst.captureReason}).
- This burst is the highest-intensity window in the clip — prioritize coaching the transition visible here (back take, combo, scramble).
- Do not invent details absent from burst pose frames or the verified vision ledger.
- Burst frame count: ${burst.frames.length}; focus target: ${burst.focusTarget}.
${burst.eventKind ? `- Trigger: ${burst.eventKind}` : ''}
`
    : ''

  const exchangeWindowsBlock =
    args.temporalEvidence?.exchangeWindows?.length
      ? `

EXCHANGE WINDOWS (Phase 3 — strike/fault detections were gated to these intervals):
${JSON.stringify(args.temporalEvidence.exchangeWindows, null, 2)}
`
      : ''

  const visionFirstMode = Boolean(args.visionEvidence)
  const visionEvidenceMainBlock = args.visionEvidence
    ? `\n${formatVisionEvidenceBlock(args.visionEvidence)}\n\n${formatFighterNamingBlock(resolveFighterNaming(args.visionEvidence))}\n`
    : ''

  const criticalContract = visionFirstMode
    ? `CRITICAL CONTRACT (VISION-FIRST):
- The VISION EVIDENCE LEDGER above is the PRIMARY source of truth — it was extracted from the actual tape (video + audio).
- Coach ONLY the people it classifies as fighters. Never coach the referee, a spectator, a coach, or the cameraman.
- "heard" entries are audio only: a shouted instruction ("throw a knee!") is NEVER evidence the action happened — only a "seen" entry proves an action.
- Respect "uncertain": never describe hidden grips, occluded limbs, or anything the evidence marks unknowable.
- The FightEvidenceLedger below is SUPPORTING pose evidence only. Use it to corroborate stance, guard, posture, level changes, and movement direction. Where it conflicts with the vision evidence, the vision evidence wins.
- You MUST NOT invent strikes, stances, faults, or events absent from the vision evidence.
- But you MUST interpret the data tactically. Turn raw observations into fight analysis.`
    : `CRITICAL CONTRACT:
- The FightEvidenceLedger is the ONLY source of truth for what was detected.
- You MUST NOT invent strikes, stances, faults, or events not in the ledger.
- But you MUST interpret the data tactically. Turn raw detections into fight analysis.`

  const ledgerVocabularyBlock = visionFirstMode
    ? `- Name techniques with the specificity the vision evidence supports — say "jab" when a jab is seen, "level change to double-leg" when seen. Never upgrade an uncertain action into a named technique.
- Timestamps must come from the vision evidence (seen/heard entries, phases, coaching windows).`
    : `- Events now include CLASSIFIED STRIKES (jab, cross, lead_hook, rear_hook, lead_uppercut, rear_uppercut, teep, lead_kick, rear_kick). Use the specific strike type in your analysis — say "jab" not "strike."
- Patterns include: guard_drop_before_entry, linear_retreat (only moves straight back), one_beat_entry (same-timing entry, counterable), circling (fighter moving laterally around opponent — describe direction and tactical purpose), ring_cutting (fighter cutting off angles to trap opponent). Name these patterns specifically and explain the tactical consequence.
- MOVEMENT IS CRITICAL: If "circling" or "ring_cutting" patterns appear in the ledger, you MUST mention them prominently. Describe WHO is circling, in what direction, and whether the other fighter is cutting off the ring or retreating linearly. Do NOT say "both fighters moving in a straight line" if a circling pattern exists.`

  return `You are Musashi Fight Intelligence - an elite combat-sports coach and tactical fight analyst.

YOUR JOB: Analyze the fight evidence and produce serious, technical, useful coaching. The feedback must feel like a high-level coach reviewed the exchange: what happened, why it happened, what danger or opportunity it creates, and exactly what the selected fighter should fix next.
${shortClipBlock}

${buildCoachingFocusBlock(args.focusTarget, { visionScreenMapping: args.visionScreenMapping })}
${visionEvidenceMainBlock}
${criticalContract}
${ledgerVocabularyBlock}
- Example: Don't say "Guard low detected." Instead say "Fighter A is leaving the chin open after jab combinations — B has a clear counter-cross opportunity through the gap."
- Example: Don't say "Range is mid." Instead say "A is controlling distance with the jab and B can't get inside — B needs to use angles or level-change to close the gap."
- Example: Don't say "Strike detected." Instead say "A lands a cross — B's guard was low after the hook, creating a clean line."
- Cite evidence IDs when available.
- Output MUST be valid JSON. No markdown.
- Do not sound like generic ChatGPT, a hype commentator, a motivational coach, or a robotic timestamp summarizer.
- Do not structure the response as Moment 1 / Moment 2 / Moment 3. Timestamps are evidence, not the main structure.
- When evidence allows, return exactly 3 high-value adjustments: technical, tactical, and training/habit.
${grapplingOverrideBlock}
${visionLedgerBlock}
${temporalBurstBlock}
${exchangeWindowsBlock}
SOURCE INFLUENCE LIBRARY:
Use these as analytical lenses only. Do not copy any creator, do not cite paid instructionals, and do not imitate a living person's voice. Musashi must have its own original voice: direct, precise, serious, evidence-based, and coach-like.
- tactical pattern recognition: stance matchups, entries, exits, traps, feints, counters, range games, and why a technique works against this opponent.
- Disciplined reasoning: separate what looked good from what was repeatable, what was accidental, and what still creates danger.
- Striking dynamics: rhythm, pocket exchanges, pressure, who wins the first beat, who wins the second beat, and whether the fighter is safe after landing.
- Simplicity and interception: remove wasted movement, attack preparation, use the shortest effective answer.
- Timing and initiative: attack on the opponent's reset beat, break rhythm, control distance, and know when not to attack.
- Boxing fundamentals and power mechanics: stance, base, footwork, hand return, weight transfer, compact punching, pivots, counters, and aggressive defense.
- Wrestling systems: stance discipline, hand fighting, lead-foot exposure, level-change timing, angle, penetration, finishes, mat returns, and re-attacks.
- Grappling systems and systems thinking: frames, posture, hip line, shoulder control, passing stability, back control, positional hierarchy, and control before submission.
- MMA transitions: safe pressure across striking, clinch, takedown, cage/wall, and ground ranges; blend attacks without exposing the next range.
- Training design: turning corrections into drills, reps, constraints, and clear success conditions.

UNIVERSAL FEEDBACK FORMAT — every sport uses this same structure inside the existing JSON (the sport brain changes WHAT you coach, never this structure):
- mainDiagnosis = Coach's Read: MAX 2 sentences, ~35 words total. Tell the story of the exchange in two sentences like a fight reporter's lead line — then stop. Cause-and-effect, ringside voice, no third paragraph. Optional one-clause confidence caution only when needed (occlusion, cut-off feet, unclear identity).
- quickCues = 3-5 short corner commands when evidence allows (aim for exactly 3). Each cue must be direct, actor-specific, actionable, evidence-supported, and memorable mid-training.
- suggestedCorrections = exactly 3 punchy cards when evidence allows:
  1. Technical — highest-leverage mechanics fix.
  2. Tactical — decision, timing, range, or matchup fix.
  3. Training/habit — ONE named drill tied to the main issue.
  Card field budgets (HARD): title ≤8 words; why = 1 sentence ≤18 words; doInstead = 1 imperative sentence ≤20 words (a command or a named drill). Each card body should fit ≤3 short lines on a phone.
  NO REPETITION: each card must make a DIFFERENT observation — never restate the same fault in new words across cards.
  If the evidence only supports fewer, give fewer — never pad with generic filler.
- overlayAnnotations = Replay Evidence: short labels tied to real actorId/time/evidence IDs from the ledger. Never invent timestamps — never emit 0ms times for events that did not happen at the very start of the clip.
- styleNotes = broader tactical tendencies, not vague labels.
- audioScript = coach voiceover: short, human, direct, names the main read, the 3 adjustments, and one drill cue.
- Correction titles must be short, human coaching titles ("Recover your hand before exiting"), NOT machine labels like "Adjustment 1 - Technical".

TIME FORMAT (HARD): Write times as seconds into the clip — "at 0:04" or "4.2s in". NEVER raw milliseconds (no "2135ms", no "t=2135").

DO NOT OVERCLAIM:
- Banned unless measured kinematics back it: "massive power advantage", "explosive advantage", "raw power", "power output is exponentially higher", exact speed/force/angle/velocity numbers.
- Banned from one short clip: "late-round fade", round-by-round strategy, a full-fight win condition.
- Never describe hidden grips, hidden limbs, or hidden foot positions.
- Prefer cautious wording: "In this clip…", "The visible pattern suggests…", "If this pattern repeats…", "Based on the ledger…", "The clip does not show enough to say…".

SPORT-SPECIFIC LENS:
- If striking evidence dominates, prioritize stance, guard, hand return, head position, centerline, distance, timing, rhythm, feints, foot position, jab quality, entries, exits, counter windows, and defensive responsibility after offense.
- If wrestling evidence dominates, prioritize stance height, hand fighting, inside tie, head position, lead foot exposure, level-change timing, setup, angle, penetration, hips, finish, sprawl, re-attack, mat return, and chain wrestling.
- If grappling evidence dominates, prioritize frames, posture, base, hip line, inside position, underhooks, shoulder control, elbow-knee connection, guard retention, passing pressure, pinning, escapes, submission control, and connection before movement.
- If MMA evidence dominates, prioritize range transitions, striking into takedowns, takedown threat into striking, cage/wall pressure, clinch breaks, underhook battles, ground-and-pound posture, submission vs damage tradeoffs, and winning one range without losing the next.

${coachBrainBlock}

Retrieved fight knowledge (use to ground tactical concepts):
${retrievedBlock}
${args.approvedCorrectionsBlock ? `\n${args.approvedCorrectionsBlock}\n` : ''}
${visionFirstMode ? 'Supporting FightEvidenceLedger (pose-derived, corroboration only — vision evidence wins on conflict; truncated):' : 'Current FightEvidenceLedger (truncated):'}
${ledgerJson}

CONCISENESS RULE: Be dense and punchy like an elite corner coach / fight reporter, NOT a lecture. Every word must earn its spot. No filler, no generic advice.
- mainDiagnosis: max 2 sentences, ~35 words. Reporter lead line — then stop.
- suggestedCorrections.why: 1 sentence, ≤18 words.
- suggestedCorrections.doInstead: 1 imperative sentence, ≤20 words.
- quickCue ≤15 words. expanded ≤1–2 short sentences.
- No repetition across the 3 cards. If you can say it in fewer words, do.

PRODUCE exactly 3 quickCues when evidence allows. Each cue should:
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
      "whyItMatters": "string (1 sentence, ≤18 words — consequence in fight terms)",
      "whatToDoInstead": "string (1 imperative sentence, ≤20 words)",
      "evidence": [{"id":"string","source":"pose|track|geometry|kinematics|compiler|user|llm","actorId":"A|B","t":{"startMs":0,"endMs":0}}],
      "confidence": {"score": 0.0, "basis": "heuristic|model|user|mixed"},
      "expanded": "string (1-2 short sentences max)",
      "audioScript": "string (optional)"
    }
  ],
  "mainDiagnosis": "string (Coach's Read: max 2 sentences, ~35 words, fight-reporter lead)",
  "styleNotes": ["string (broader tactical tendencies, not vague labels like aggressive/defensive/needs work)"],
  "suggestedCorrections": [
    {"actorId":"A|B","title":"string (short human title, ≤8 words)","why":"string (1 sentence, ≤18 words)","doInstead":"string (1 imperative sentence, ≤20 words — command or named drill)","evidenceIds":["string"]}
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

IMPORTANT: Generate at least 2-4 overlayAnnotations with tactical messages like "Counter opportunity - cross is open" or "Pressing but overextending" - not just repeating fault names. Use timestamps from the ledger.

QUALITY EXAMPLES:
- Weak: "Keep your hands up and use better footwork."
- Strong: "A is entering with pressure, but the exit is unsafe. The right hand comes back low and A resets tall in front of B, giving B the same counter window after each attack."
- Weak: "Set up your takedowns better."
- Strong: "The shot is not too slow. It is too naked. Win the hands, move the lead foot, and have the second attack ready."
- Weak: "Pass harder and control better."
- Strong: "Clearing the legs is only step one. Stabilize the hips and shoulders before hunting the submission."
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
  /** Optional Gemini v1beta responseSchema for strict structured output. */
  responseSchema?: Record<string, unknown>
  /**
   * Thinking depth for Gemini 3.x models. Defaults to 'LOW' — thinking tokens
   * bill against maxOutputTokens, and at the server default (HIGH) a modest
   * budget is consumed before the answer starts, truncating the JSON.
   */
  thinkingLevel?: 'LOW' | 'HIGH'
  /** Internal: set on the single MAX_TOKENS retry so it cannot recurse. */
  _isRetry?: boolean
}): Promise<{ model: string; data: T; rawText: string }> {
  const apiKey = await resolveKey(args.apiKey)
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`

  const maxOutputTokens = args.maxOutputTokens ?? 2048
  // Gemini 3.x rejects thinkingBudget:0 ("only works in thinking mode"), so use
  // thinkingLevel there and keep thinkingBudget for 2.5-era models. Mirrors
  // attemptCoachingWithModel — generateJson was the only call site missing this.
  const thinkingConfig = isGemini3Model(args.model)
    ? { thinkingLevel: args.thinkingLevel ?? 'LOW' }
    : { thinkingBudget: 0 }

  const body = JSON.stringify({
    contents: [{ role: 'user', parts: args.parts }],
    generationConfig: {
      // Gemini 3.x: sampling params stay at server defaults per official docs.
      ...(isGemini3Model(args.model)
        ? {}
        : {
            temperature: args.temperature ?? 0.3,
            topP: args.topP ?? 0.95,
            topK: args.topK ?? 40,
          }),
      maxOutputTokens,
      responseMimeType: 'application/json',
      thinkingConfig,
      // Omit the key entirely when absent — v1beta 400s on some null config values.
      ...(args.responseSchema ? { responseSchema: args.responseSchema } : {}),
    },
  })

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body,
  })

  const json = (await safeParseResponse(resp)) as GeminiGenerateResponse
  if (!resp.ok) {
    throw new Error(json?.error?.message || `Gemini API error: ${resp.status}`)
  }

  const candidate = json?.candidates?.[0]
  const rawText = firstPayloadText(candidate)

  // A truncated or blocked response must not be reported as "invalid JSON" —
  // that sent users a raw fragment of the model's output with no way to act.
  const retryOnce = async (): Promise<{ model: string; data: T; rawText: string }> =>
    generateJson<T>({ ...args, maxOutputTokens: maxOutputTokens * 2, thinkingLevel: 'LOW', _isRetry: true })

  const finishError = finishReasonError(candidate?.finishReason)
  if (finishError) {
    if (candidate?.finishReason === 'MAX_TOKENS' && !args._isRetry) return retryOnce()
    throw finishError
  }

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
    // catch and degrade gracefully if they want a fallback. NOT retried:
    // fetchWithRetry already covers transient 429/503, and a parse retry
    // doubles Gemini spend on a deterministic failure.
    throw new Error(`Gemini returned invalid JSON: ${cleaned.slice(0, 200)}`)
  }

  return { model: args.model, data, rawText }
}

async function attemptCoachingWithModel(args: {
  model: string
  apiKey: string
  prompt: string
  videoFileUri?: string
  videoInlineBase64?: string
  videoMimeType?: string
  startSec?: number | null
  endSec?: number | null
  sport?: string | null
}): Promise<{ model: string; payload: CoachingPayload; rawText: string }> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(args.model)}:generateContent`

  const parts: Array<Record<string, unknown>> = []
  const videoOpts = {
    window: { startSec: args.startSec, endSec: args.endSec },
    sport: args.sport,
    mediaResolution: 'low' as const,
  }
  if (args.videoInlineBase64) {
    parts.push(
      buildGeminiVideoInlinePart(args.videoInlineBase64, args.videoMimeType || 'video/mp4', videoOpts),
    )
  } else if (args.videoFileUri) {
    parts.push(
      buildGeminiVideoFilePart(args.videoFileUri, args.videoMimeType || 'video/mp4', videoOpts),
    )
  }
  parts.push({ text: args.prompt })

  // Gemini 3.x Pro rejects thinkingBudget:0 ("only works in thinking mode").
  // Use thinkingLevel for 3.x; keep thinkingBudget for 2.5 Flash-style models.
  const isGemini3 = isGemini3Model(args.model)
  const thinkingConfig = isGemini3
    ? { thinkingLevel: 'LOW' as const }
    : { thinkingBudget: 0 }

  const body = JSON.stringify({
    contents: [{ role: 'user', parts }],
    generationConfig: {
      // Gemini 3.x official guidance: keep temperature/topP/topK at server
      // defaults (temperature 1.0). Legacy 2.x models keep the old tuning.
      ...(isGemini3 ? {} : { temperature: 0.25, topP: 0.9, topK: 40 }),
      maxOutputTokens: 8192,
      responseMimeType: 'application/json',
      thinkingConfig,
      // Global (v1beta-safe). Never put mediaResolution on Part — that 400s.
      ...(args.videoInlineBase64 || args.videoFileUri
        ? { mediaResolution: GEMINI_MEDIA_RESOLUTION_LOW }
        : {}),
    },
  })

  const resp = await fetchWithRetry(url, {
    method: 'POST',
    // API key travels in a header, never the query string (log hygiene).
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey },
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
  focusTarget?: CoachingFocusTarget
  /** Gemini Files API URI — lets Pro SEE the actual fight footage alongside the ledger */
  videoFileUri?: string
  /** Inline base64 when the normalized clip is < 20MB (skips Files ACTIVE wait). */
  videoInlineBase64?: string
  videoMimeType?: string
  /** Optional analysis window (server-side Gemini videoMetadata offsets). */
  startSec?: number | null
  endSec?: number | null
  /** Coach-brain context: selectedSport, clipType, userQuestion, poseEngine, poseQuality. */
  coachBrain?: CoachBrainContext
  /** Verified vision ledger (Phase 2 SessionEvidence merge output). */
  visionLedger?: FactualLedger | null
  /** Phase 3 temporal evidence (exchange windows + motion burst). */
  temporalEvidence?: TemporalEvidence | null
  /** When true (vision-first / no pose), map Fighter A=LEFT and B=RIGHT on screen. */
  visionScreenMapping?: boolean
  /** Exact-clip approved corrections block (beside retrieval). */
  approvedCorrectionsBlock?: string | null
  /**
   * Vision-first Pass 1 evidence. When present, coaching runs on the evidence
   * JSON and the video is NOT attached (CRITICAL COST RULE: the tape is sent
   * to Gemini exactly once, in the evidence pass). Set `resendVideoOverride`
   * for a controlled retry / Shogun diagnostic only.
   */
  visionEvidence?: VisionEvidence | null
  resendVideoOverride?: boolean
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
    const focusedPayload = applyCoachingFocus(mockPayload, args.focusTarget)
    return { model: 'dry-run-mock', payload: focusedPayload, rawText: JSON.stringify(focusedPayload) }
  }

  const apiKey = await resolveKey(args.config?.apiKey)
  const prompt = buildGroundedCoachingPrompt({
    ledger: args.ledger,
    retrievedSnippets: args.retrievedSnippets,
    focusTarget: args.focusTarget,
    coachBrain: args.coachBrain,
    visionLedger: args.visionLedger,
    temporalEvidence: args.temporalEvidence,
    visionScreenMapping: args.visionScreenMapping,
    approvedCorrectionsBlock: args.approvedCorrectionsBlock,
    visionEvidence: args.visionEvidence,
  })

  // CRITICAL COST RULE: when Pass-1 vision evidence is present, the coaching
  // pass runs on evidence JSON only — the tape was already sent once. Video is
  // re-attached only via the explicit override (controlled retry / Shogun).
  const attachVideo = !args.visionEvidence || args.resendVideoOverride === true
  const coachingVideoFileUri = attachVideo ? args.videoFileUri : undefined
  const coachingVideoInline = attachVideo ? args.videoInlineBase64 : undefined

  // Phase 2: dedupe + LRU result cache. Two callers with literally identical
  // Gemini inputs share one round-trip; repeated requests inside the TTL
  // window are served from memory. Toggle off with MUSASHI_COACHING_CACHE=0
  // if you ever need to force-bypass it (e.g., A/B'ing prompt changes).
  const cachingDisabled = process.env.MUSASHI_COACHING_CACHE === '0'
  const cacheKey = cachingDisabled
    ? null
    : await sha256Hex(
        `${prompt}\u0000${normalizeCoachingFocus(args.focusTarget)}\u0000${args.videoFileUri ?? ''}\u0000${args.videoInlineBase64 ? 'inline' : ''}\u0000${args.videoMimeType ?? ''}\u0000${args.startSec ?? ''}\u0000${args.endSec ?? ''}\u0000${args.coachBrain?.selectedSport ?? ''}\u0000${args.approvedCorrectionsBlock ?? ''}`,
      )

  const runGemini = async (): Promise<{ model: string; payload: CoachingPayload; rawText: string }> => {
    // Model cascade: try the configured Pro model first; on quota/rate errors
    // fall back to Flash; if Flash is also exhausted, return a demo payload
    // so the UI still lights up during a presentation. Non-quota errors are
    // NOT swallowed — they bubble up so we don't hide real failures.
    const proModel = args.config?.reasonModel || defaultReasonModel()
    const flashModel = resolvedModels.flash()
    const cascade = proModel === flashModel ? [proModel] : [proModel, flashModel]
    // Demo fallback is OPT-IN (GEMINI_DEMO_FALLBACK=1). By default a failed
    // analysis surfaces as an error instead of fake coaching — users must
    // never mistake a canned demo payload for a real read of their clip.
    const allowDemoFallback = process.env.GEMINI_DEMO_FALLBACK === '1'

    let lastQuotaError: GeminiQuotaError | null = null
    for (const model of cascade) {
      try {
        const result = await attemptCoachingWithModel({
          model,
          apiKey,
          prompt,
          videoFileUri: coachingVideoFileUri,
          videoInlineBase64: coachingVideoInline,
          videoMimeType: args.videoMimeType,
          startSec: args.startSec,
          endSec: args.endSec,
          sport: args.coachBrain?.selectedSport,
        })
        return { ...result, payload: applyCoachingFocus(result.payload, args.focusTarget) }
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
      const focusedPayload = applyCoachingFocus(payload, args.focusTarget)
      return { model: 'demo-fallback', payload: focusedPayload, rawText: JSON.stringify(focusedPayload) }
    }

    throw lastQuotaError ?? new Error('Gemini coaching generation failed')
  }

  if (!cacheKey) return runGemini()

  type CoachingResult = { model: string; payload: CoachingPayload; rawText: string }
  const cache = getCoachingCache<CoachingResult>()
  return cache.getOrCompute(cacheKey, runGemini)
}

