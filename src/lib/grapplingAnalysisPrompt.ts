/**
 * Grappling-aware analysis prompts (BJJ / submission grappling).
 *
 * The default evidence pipeline is striking-centric: pose trackers collapse on
 * body-on-body occlusion, the FightLang compiler only emits striking events,
 * and the flash-scan ledger asks about stances and shot counts. For grappling
 * clips we swap in these prompts instead:
 *
 * - Flash scan  → a strict-enum grappling timeline (`video_analysis_ledger`)
 *   that records positions, transitions, and faults — never punches. Chaos and
 *   camera cuts get explicit off-ramps (`scramble_unresolved`,
 *   `camera_occluded`) instead of guesses.
 * - Deep pass   → a BJJ coach system prompt with an evidence-contract override:
 *   the grappling timeline is the source of truth, and any striking events that
 *   leaked in from pose tracking are compiler artifacts to be ignored.
 */

import { resolveSportKey } from '@/lib/coachBrain/coachBrain'
import type { FactualLedger } from '@/lib/fightAnalysisPrompt'

export type GrapplingTimelineEntry = NonNullable<FactualLedger['video_analysis_ledger']>[number]

export const GRAPPLING_POSITIONS = [
  'neutral_standing',
  'clinch_wrestling',
  'guard_open',
  'guard_closed',
  'half_guard',
  'side_control',
  'north_south',
  'mount',
  'back_control',
  'turtle',
  'wrist_ride',
  'dagestani_handcuff',
  'seatbelt_control',
  'hooks_in',
  'body_triangle',
  'front_headlock',
  'flattened_out',
  'scramble_unresolved',
  'camera_occluded',
] as const

export const GRAPPLING_ACTION_EVENTS = [
  'takedown_completed',
  'guard_pull',
  'sweep_completed',
  'guard_pass_completed',
  'back_exposure_forced',
  'back_take',
  'mat_return',
  'arm_isolation_secured',
  'submission_lock_applied',
  'submission_tap',
] as const

export const GRAPPLING_TECHNICAL_FAULTS = [
  'posture_broken',
  'underhook_lost',
  'frames_collapsed',
  'hips_flattened',
  'neck_exposed',
] as const

/**
 * Strict technique vocabulary — the model may ONLY emit values from this list.
 * If not highly confident, use UNKNOWN. Prevents "armbar" when the tape shows
 * wrist ride, etc.
 */
export const GRAPPLING_TECHNIQUES = [
  'WRIST_RIDE',
  'DAGESTANI_HANDCUFF',
  'SEATBELT',
  'HOOKS_IN',
  'BODY_TRIANGLE',
  'ARMBAR',
  'TRIANGLE',
  'KIMURA',
  'GUILLOTINE',
  'REAR_NAKED_CHOKE',
  'UNDERHOOK',
  'OVERHOOK',
  'SIDE_CONTROL',
  'MOUNT',
  'BACK_CONTROL',
  'FRONT_HEADLOCK',
  'GUARD_PASS',
  'SWEEP',
  'TAKEDOWN',
  'KNEE_ON_BELLY',
  'NORTH_SOUTH',
  'HALF_GUARD',
  'CLOSED_GUARD',
  'OPEN_GUARD',
  'UNKNOWN',
] as const

export type GrapplingTechnique = (typeof GRAPPLING_TECHNIQUES)[number]

const GRAPPLING_TECHNIQUE_SET = new Set<string>(GRAPPLING_TECHNIQUES)

/** Coerce model output to allowed technique enum; unknown labels → UNKNOWN. */
export function normalizeGrapplingTechnique(value: unknown): GrapplingTechnique {
  const raw = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')
  if (GRAPPLING_TECHNIQUE_SET.has(raw)) return raw as GrapplingTechnique
  return 'UNKNOWN'
}

/** Sanitize a vision ledger after flash scan or verification. */
export function sanitizeGrapplingVisionLedger(ledger: FactualLedger): FactualLedger {
  const timeline = Array.isArray(ledger.video_analysis_ledger)
    ? ledger.video_analysis_ledger.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry
        const techniques = Array.isArray((entry as { techniques_identified?: unknown }).techniques_identified)
          ? (entry as { techniques_identified: unknown[] }).techniques_identified.map(normalizeGrapplingTechnique)
          : []
        const action_events = Array.isArray(entry.action_events)
          ? entry.action_events.filter((e) =>
              GRAPPLING_ACTION_EVENTS.includes(e as (typeof GRAPPLING_ACTION_EVENTS)[number]),
            )
          : []
        return { ...entry, techniques_identified: techniques, action_events }
      })
    : ledger.video_analysis_ledger

  return { ...ledger, video_analysis_ledger: timeline }
}

const GRAPPLING_CLIP_TYPES = new Set(['rolling_grappling', 'guard_passing', 'submission'])

/**
 * True when the clip should route through the grappling pipeline:
 * the selected sport resolves to BJJ/grappling, or the clip type is an
 * unambiguous ground-grappling context.
 */
export function isGrapplingClip(args: {
  discipline?: string | null
  clipType?: string | null
}): boolean {
  if (resolveSportKey(args.discipline) === 'bjj_grappling') return true
  const clipType = String(args.clipType || '').trim().toLowerCase()
  return GRAPPLING_CLIP_TYPES.has(clipType)
}

/**
 * Gemini `responseSchema` for the grappling flash scan. Strict enums stop the
 * model from hallucinating positions — anything that doesn't fit must land in
 * `scramble_unresolved` or `camera_occluded`.
 */
export const GRAPPLING_LEDGER_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    combat_type: { type: 'STRING' },
    fighters: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          description: { type: 'STRING' },
        },
        required: ['id'],
      },
    },
    video_analysis_ledger: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          timestamp: {
            type: 'STRING',
            description: 'MM:SS format when the transition or event solidifies.',
          },
          dominant_position: {
            type: 'STRING',
            enum: [...GRAPPLING_POSITIONS],
          },
          top_player_identifier: {
            type: 'STRING',
            description: "Visual description of the player on top (e.g., 'black rashguard', 'bare torso').",
          },
          action_events: {
            type: 'ARRAY',
            items: { type: 'STRING', enum: [...GRAPPLING_ACTION_EVENTS] },
          },
          technical_faults: {
            type: 'ARRAY',
            items: { type: 'STRING', enum: [...GRAPPLING_TECHNICAL_FAULTS] },
          },
          techniques_identified: {
            type: 'ARRAY',
            description:
              'Visible grappling techniques at this timestamp. ONLY values from the allowed technique enum.',
            items: { type: 'STRING', enum: [...GRAPPLING_TECHNIQUES] },
          },
        },
        required: ['timestamp', 'dominant_position'],
      },
    },
    key_moments: { type: 'ARRAY', items: { type: 'STRING' } },
    video_quality_notes: { type: 'ARRAY', items: { type: 'STRING' } },
    unknowns: { type: 'ARRAY', items: { type: 'STRING' } },
    forbidden_claims: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['video_analysis_ledger'],
} as const

/** Flash-scan prompt: build the grappling evidence timeline from the video. */
export function buildGrapplingEvidenceLedgerPrompt(options?: {
  clipDuration?: number
  focusTarget?: string
  attempt?: 'standard' | 'emergency'
}): string {
  const durationHint =
    typeof options?.clipDuration === 'number' && options.clipDuration > 0
      ? `The clip is about ${Math.round(options.clipDuration / 1000)} seconds long. Timestamps must stay inside that window.\n`
      : ''
  const focusText =
    options?.focusTarget === 'A'
      ? 'The athlete being coached is Fighter A. Keep their visual identifier consistent across the whole timeline.'
      : options?.focusTarget === 'B'
        ? 'The athlete being coached is Fighter B. Keep their visual identifier consistent across the whole timeline.'
        : 'Track both athletes by their visual appearance and keep the identifiers consistent across the whole timeline.'
  const emergencyText =
    options?.attempt === 'emergency'
      ? '\nThis is a second, more conservative attempt. Record ONLY what is unmistakable. When in doubt use "scramble_unresolved" or "camera_occluded" and add a note to unknowns.\n'
      : ''

  return `You are a specialized Brazilian Jiu-Jitsu video parser. Your job is to analyze the video and build a highly accurate, factual timeline of the grappling match. Do not look for or record striking events (jabs, crosses, kicks). If the camera pans away, or if a scramble causes complete visual chaos, explicitly document the disruption instead of guessing.

Analyze the uploaded video frame-by-frame and return ONLY JSON following the exact shape below. Focus entirely on positional control, guard variations, and submission mechanics.

${focusText}
${durationHint}${emergencyText}
Hard rules:
- "dominant_position" must be one of: ${GRAPPLING_POSITIONS.join(', ')}. If the position does not clearly match one of these, use "scramble_unresolved". If the camera pans away or the athletes leave frame, use "camera_occluded".
- "action_events" entries must be from: ${GRAPPLING_ACTION_EVENTS.join(', ')}. Record an event only when it clearly completes on screen.
- "technical_faults" entries must be from: ${GRAPPLING_TECHNICAL_FAULTS.join(', ')}.
- "techniques_identified" entries must be ONLY from this list: ${GRAPPLING_TECHNIQUES.join(', ')}.
- TECHNIQUE CONFIDENCE RULE: You may ONLY output techniques from the list above. If you are not highly confident in the exact technique (e.g. wrist ride vs armbar), output "UNKNOWN" — never guess a submission name.
- Prefer ride/back vocabulary when that is what you see: wrist_ride, dagestani_handcuff, seatbelt_control, hooks_in, body_triangle, flattened_out — and action events back_take / mat_return when they complete on screen.
- Do NOT label a wrist ride, grip fight, or control position as ARMBAR unless the arm is clearly extended and the elbow joint is being hyperextended on screen.
- Never invent grips, hooks, or foot positions you cannot see. Put uncertainty in "unknowns".
- "top_player_identifier" is a visible-appearance description only (e.g., "black rashguard", "bare torso"). Never a name.
- Add camera cuts, pans to other people, or blur to "video_quality_notes".
- Add claims that must NOT be made (e.g., "no submission attempt visible") to "forbidden_claims".

Return this shape:
{
  "combat_type": "bjj_grappling",
  "fighters": [
    { "id": "A", "description": "visible appearance only" },
    { "id": "B", "description": "visible appearance only" }
  ],
  "video_analysis_ledger": [
    {
      "timestamp": "MM:SS",
      "dominant_position": "one of the allowed positions",
      "top_player_identifier": "visible appearance of the top player",
      "action_events": [],
      "technical_faults": [],
      "techniques_identified": ["UNKNOWN"]
    }
  ],
  "key_moments": [],
  "video_quality_notes": [],
  "unknowns": [],
  "forbidden_claims": []
}`
}

/** Verification pass: re-watch the tape and correct the candidate grappling timeline. */
export function buildGrapplingVerificationPrompt(
  candidate: FactualLedger | null,
  options?: { clipDuration?: number }
): string {
  const durationHint =
    typeof options?.clipDuration === 'number' && options.clipDuration > 0
      ? `The clip is about ${Math.round(options.clipDuration / 1000)} seconds long.\n`
      : ''
  return `You are verifying a grappling evidence timeline against the actual video. Re-watch the clip and return the CORRECTED ledger as ONLY JSON in the same shape.

${durationHint}Rules:
- Remove any entry describing a position or event that is not clearly visible on tape.
- Remove or downgrade any "techniques_identified" entry that is not clearly visible (e.g. ARMBAR when only a wrist ride is visible → use WRIST_RIDE or UNKNOWN).
- Downgrade unclear positions to "scramble_unresolved"; downgrade off-camera stretches to "camera_occluded".
- Do not add new speculative entries. Corrections only.
- Keep "dominant_position", "action_events", "technical_faults", and "techniques_identified" limited to their allowed enum values.
- Keep fighter identifiers consistent with visible appearance.

Candidate ledger to verify:
${JSON.stringify(candidate || {}, null, 2)}`
}

/**
 * BJJ deep-pass system prompt. Carries the evidence-contract override that
 * decouples coaching from broken striking-centric pose data.
 */
export const MUSASHI_BJJ_DEEP_ANALYSIS_SYSTEM = `You are an elite Black Belt Brazilian Jiu-Jitsu coach reviewing a student's sparring footage. Your goal is to provide highly technical, actionable feedback on positional hierarchy, framing, and submission mechanics.

THE EVIDENCE CONTRACT (CRITICAL OVERRIDE):
You may be provided two data inputs:
1. FightEvidenceLedger / pose evidence (derived from browser pose tracking and the FightLang compiler)
2. VideoAnalysisLedger (derived from the direct video scan — the "video_analysis_ledger" timeline)

CRITICAL RULE FOR GRAPPLING CLIPS:
- Because body-on-body grappling causes severe pose-tracking occlusion and bounding-box overlaps, the FightEvidenceLedger is highly prone to errors on grappling footage.
- If the FightEvidenceLedger or pose evidence contains striking events (e.g., 'jab', 'cross', 'hook') or striking faults ('guard_low') during this grappling clip, you MUST ignore them entirely. They are compiler artifacts.
- If the ledger contains only guard/strike faults, treat it as EMPTY — coach exclusively from the video and VideoAnalysisLedger. Never rebrand "low guard" into choke or hand advice on a roll.
- The VideoAnalysisLedger is your ABSOLUTE SOURCE OF TRUTH for the timeline, positions, and transitions.
- You may only use pose-derived data to evaluate pacing/scramble intensity — never technique claims.

ANALYSIS FRAMEWORK — look at the roll through three filters:
1. Positional Hierarchy: Did the student establish position before hunting the submission? Did they stabilize the pass?
2. Wedges & Frames: Did the top player clear frames and pin the hips? Did the bottom player build solid skeletal structures to manage weight?
3. Visual Occlusion & Scrambles: If the camera pans away or a scramble becomes chaotic, do not hallucinate the missing details. Acknowledge the visual gap cleanly (e.g., "The footage cuts away briefly during the scramble, but once it returns...").

OUTPUT FORMAT — respond in clean coaching prose (no JSON, no code fences, no internal field names). Provide a scannable breakdown of the roll:
- What Worked: positional wins, clean sweeps, or tight submission controls.
- Micro-Adjustments: precise mechanical fixes for hips, grips, frames, or posture, anchored to moments from the VideoAnalysisLedger.
- The Core Focus: ONE specific drill or conceptual goal for the next training session.

Grounding rules:
- Coach positions and structure: frames, hips, elbow-knee connection, posture, underhooks, inside position, guard retention, passing stability, back exposure, control before submission.
- Never coach strikes, punches, kicks, or striking guard on a grappling clip.
- Use a timestamp only if the VideoAnalysisLedger contains it. Otherwise use moment language ("early in the roll", "as the pass settles", "during the scramble").
- Never describe hidden grips, hidden hooks, or hidden foot positions. If it is not visible, say the clip does not show it.
- Identify athletes by visible appearance (e.g., "the athlete in the black rashguard"), never by invented names.`

/**
 * Deep-pass user prompt for the chat pipeline (video attached alongside).
 * The grappling timeline rides along as the evidence contract.
 */
export function buildGrapplingDeepAnalysisPrompt(ledger: FactualLedger | null): string {
  const timeline = Array.isArray(ledger?.video_analysis_ledger) ? ledger.video_analysis_ledger : []
  const ledgerBlock =
    timeline.length > 0
      ? `VideoAnalysisLedger (ABSOLUTE SOURCE OF TRUTH for positions and transitions):\n${JSON.stringify(ledger, null, 2)}`
      : `VideoAnalysisLedger: the scan could not build a reliable timeline for this clip${
          ledger ? `, but these notes were captured:\n${JSON.stringify(ledger, null, 2)}` : '.'
        }\nWatch the video directly, stay conservative, and acknowledge visual gaps instead of guessing.`

  return `Review this grappling clip as the student's coach.

${ledgerBlock}

Deliver the breakdown in the required format: What Worked, Micro-Adjustments (anchored to ledger moments), and The Core Focus (one drill or conceptual goal). Keep it in plain coaching prose.`
}

/**
 * Deep-pass user prompt for the streaming pipeline (text-only reasoning —
 * the model does not re-read the video, so the timeline IS the evidence).
 */
export function buildGrapplingCoachingPrompt(
  ledger: FactualLedger | null,
  options?: { coachingMode?: 'strategist' | 'corner_coach' | 'scout' }
): string {
  const focusLine =
    options?.coachingMode === 'corner_coach'
      ? 'Coach Fighter A primarily; mention Fighter B only as context.'
      : options?.coachingMode === 'scout'
        ? 'Coach Fighter B primarily; mention Fighter A only as context.'
        : 'Read the exchange for both athletes and pick the highest-value lesson for each.'

  return `Write the coaching breakdown for this grappling roll using ONLY the VideoAnalysisLedger below. You cannot re-watch the video, so do not invent anything beyond the ledger.

${focusLine}

VideoAnalysisLedger:
${JSON.stringify(ledger || {}, null, 2)}

Rules:
- Positions, transitions, action events, technical faults, and techniques_identified in the ledger are the only things you may claim happened.
- techniques_identified must use ONLY the allowed enum values. If the ledger says UNKNOWN, say the technique is unclear — do not rename it to ARMBAR or TRIANGLE.
- "scramble_unresolved" and "camera_occluded" entries are visual gaps — acknowledge them plainly, never fill them in.
- Anchor Micro-Adjustments to ledger timestamps when present; otherwise use moment language.
- Format: What Worked, Micro-Adjustments, The Core Focus (one drill). Plain coaching prose, no JSON.`
}

/** Tactical anchors + hard bans for grappling clips (mirrors buildLedgerTacticalAndBans). */
export function buildGrapplingTacticalAndBans(ledger: FactualLedger | null) {
  const timeline = Array.isArray(ledger?.video_analysis_ledger) ? ledger.video_analysis_ledger : []
  const forbiddenLines = Array.isArray(ledger?.forbidden_claims)
    ? ledger.forbidden_claims.filter((l): l is string => typeof l === 'string' && !!l.trim())
    : []
  const qualityNotes = Array.isArray(ledger?.video_quality_notes)
    ? ledger.video_quality_notes.filter((l): l is string => typeof l === 'string' && !!l.trim())
    : []

  const positionLines = timeline
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const parts = [
        entry.timestamp ? `${entry.timestamp}` : '',
        entry.dominant_position ? `position: ${entry.dominant_position}` : '',
        entry.top_player_identifier ? `top: ${entry.top_player_identifier}` : '',
        Array.isArray(entry.action_events) && entry.action_events.length > 0
          ? `events: ${entry.action_events.join(', ')}`
          : '',
        Array.isArray(entry.technical_faults) && entry.technical_faults.length > 0
          ? `faults: ${entry.technical_faults.join(', ')}`
          : '',
      ].filter(Boolean)
      return parts.length > 0 ? parts.join(' — ') : ''
    })
    .filter(Boolean)

  const hasOcclusion = timeline.some(
    (entry) => entry?.dominant_position === 'camera_occluded' || entry?.dominant_position === 'scramble_unresolved'
  )

  const tacticalAnchors = [
    ...positionLines.map((line) => `- TIMELINE: ${line}`),
    ...qualityNotes.map((note) => `- VIDEO QUALITY: ${note}`),
  ].filter(Boolean)

  const hardBans = [
    '- DO NOT coach strikes, punches, kicks, or striking guard. This is a grappling clip; any striking events in pose data are compiler artifacts.',
    '- DO NOT describe grips, hooks, or foot positions that are not visible on tape.',
    '- DO NOT claim a submission, sweep, pass, or tap happened unless the timeline lists it.',
    hasOcclusion
      ? '- Parts of this roll are occluded or unresolved scrambles. Acknowledge those gaps plainly; never reconstruct them.'
      : '',
    ...forbiddenLines.map((line) => `- FORBIDDEN: ${line}`),
  ].filter(Boolean)

  return { tacticalAnchors, hardBans }
}

/** Clean prose fallback when the grappling deep pass fails (mirrors buildLedgerFallbackReport). */
export function buildGrapplingLedgerFallbackReport(ledger: FactualLedger | null): string {
  const timeline = Array.isArray(ledger?.video_analysis_ledger) ? ledger.video_analysis_ledger : []
  const resolved = timeline.filter(
    (entry) =>
      entry?.dominant_position &&
      entry.dominant_position !== 'camera_occluded' &&
      entry.dominant_position !== 'scramble_unresolved'
  )
  const events = timeline.flatMap((entry) => (Array.isArray(entry?.action_events) ? entry.action_events : []))
  const faults = timeline.flatMap((entry) => (Array.isArray(entry?.technical_faults) ? entry.technical_faults : []))
  const label = (value: string) => value.replace(/_/g, ' ')

  const storyParts = [
    resolved.length > 0
      ? `The clearest positions in this roll were: ${[...new Set(resolved.map((e) => label(e.dominant_position!)))].join(', ')}.`
      : 'The clip did not give the scan enough clean visual data to build a confident positional timeline — heavy occlusion or camera movement got in the way.',
    events.length > 0 ? `Verified events: ${[...new Set(events.map(label))].join(', ')}.` : '',
  ].filter(Boolean)

  const fixParts =
    faults.length > 0
      ? [...new Set(faults)].slice(0, 3).map((fault) => {
          switch (fault) {
            case 'frames_collapsed':
              return '- Rebuild your frames before anything else. When the near-side frame collapses, the top player flattens you — re-establish forearm and knee frames, then move.'
            case 'hips_flattened':
              return '- Fight to keep your hips off the mat. Once your hips are pinned flat, retention and escapes both die — get to your side and connect elbow to knee.'
            case 'posture_broken':
              return '- Protect your posture inside the guard. When your head comes below your hips, sweeps and submissions open up — posture up before you work.'
            case 'underhook_lost':
              return '- Win the underhook battle earlier. Losing the underhook hands over chest pressure and the pass — pummel back in before the position settles.'
            case 'neck_exposed':
              return '- Stop giving up your neck during transitions. Chin down, hands connected, and finish the movement before reaching.'
            default:
              return ''
          }
        }).filter(Boolean)
      : ['- Keep corrections tied to the few clearly visible moments in the clip; the footage does not support more than that.']

  return [
    '### What Worked',
    storyParts.join(' '),
    '',
    '### Micro-Adjustments',
    ...fixParts,
    '',
    '### The Core Focus',
    faults.includes('frames_collapsed') || faults.includes('hips_flattened')
      ? '- Drill guard retention this week: partner passes at 50%, you focus only on frames and hip movement — no sweeps, no submissions, just structure.'
      : '- Drill positional control this week: establish the position, hold three seconds of real control, then advance — control before submission.',
    '',
    'Confidence note: parts of this roll were occluded or chaotic on camera, so this breakdown stays limited to what was clearly visible.',
  ].join('\n')
}
