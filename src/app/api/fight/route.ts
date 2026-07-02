import { NextResponse } from 'next/server'
import { aiGuard, aiErrorResponse } from '@/lib/ai/aiGuard'
import {
  enforceVideoAnalysis,
  extractFightVideoQuotaContext,
  fightActionConsumesVideoQuota,
  fightActionToQuotaBucket,
  extractChatClipKey,
  enforceClipQuestionLimit,
} from '@/lib/musashiUsage'
import { requireUser, type MusashiUser } from '@/lib/musashiAuth'
import { composeSystemPrompt, DEFAULT_PROMPTS } from '@/lib/aiClient'
import { getDisciplinePrompt } from '@/lib/disciplinePrompts'
import { buildCoachBrainBlock } from '@/lib/coachBrain/coachBrain'
import {
  MUSASHI_DEEP_ANALYSIS_SYSTEM,
  COMET_STYLE_ANALYSIS_SYSTEM,
  FLASH_SCAN_PROMPT,
  COMET_FLASH_SCAN_PROMPT,
  buildEvidenceLedgerPrompt,
  buildEvidenceVerificationPrompt,
  buildEvidenceBackedCoachingPrompt,
  buildDeepAnalysisPrompt,
  buildCometDeepAnalysisPrompt,
  FOLLOW_UP_CHAT_APPEND,
  CONDENSED_FRAMEWORKS,
  ScanData,
  FactualLedger
} from '@/lib/fightAnalysisPrompt'
import { logger } from '@/lib/logger'
import { readSecretEnv } from '@/lib/env'
import { getKnowledgeContext, logActivity } from '@/lib/musashiLibrary'

const debugLog = (msg: string, ctx?: Record<string, unknown>) => {
  if (process.env.NODE_ENV === 'development') logger.debug(msg, ctx)
}
import { updateTechniquePerformance, getPersonalizedCoaching } from '@/lib/learningPipeline'
import { taxonomySearch } from '@/lib/taxonomyService'
import { safeParseResponse } from '@/lib/safeJson'
import { retrieveForLedger } from '@/lib/retrieval/orchestrate'
import { streamReasoning } from '@/lib/ai/gemini-reason'
import { embedAndStoreSegments } from '@/lib/retrieval/ingestVideoSegments'
import { upsertRetrievalDoc } from '@/lib/retrieval/d1Store'
import { embedText } from '@/lib/ai/gemini-embed'
import { resolvedModels } from '@/lib/gemini/models'
import { getDbOrNull } from '@/lib/db'
import {
  buildGeminiReflexFrameRequest,
  extractGeminiText,
  parseReflexFrameJson,
  type ReflexFrameContext,
} from '@/lib/gemini/reflex-frame'

export const maxDuration = 60

const summarizePatternEvidence = (patterns: unknown): string => {
  if (!patterns) return ''

  if (typeof patterns === 'string') {
    return patterns.trim().slice(0, 900)
  }

  if (Array.isArray(patterns)) {
    return patterns
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return ''
        const pattern = entry as Record<string, unknown>
        const title = String(pattern.title || pattern.pattern || pattern.id || 'pattern')
        const confidence = typeof pattern.confidence === 'number'
          ? ` (${Math.round(pattern.confidence * 100)}% confidence)`
          : ''
        const evidence = String(pattern.evidence || pattern.summary || pattern.description || '').trim()
        return [title + confidence, evidence].filter(Boolean).join(': ')
      })
      .filter(Boolean)
      .slice(0, 6)
      .join('\n')
      .slice(0, 900)
  }

  if (typeof patterns === 'object') {
    return JSON.stringify(patterns, null, 2).slice(0, 900)
  }

  return ''
}

const summarizeStructuredContext = (
  label: string,
  payload: unknown,
  limit = 2200
): string => {
  if (!payload) return ''

  try {
    if (typeof payload === 'string') {
      return `\n${label}:\n${payload.trim().slice(0, limit)}`
    }

    return `\n${label}:\n${JSON.stringify(payload, null, 2).slice(0, limit)}`
  } catch {
    return ''
  }
}

const buildFirstPassPriorityBlock = (
  coachingMode: string,
  focusDescription: string,
  fighterContext: string
): string => {
  const modeDirective =
    coachingMode === 'corner_coach'
      ? 'Prioritize coaching corrections for Fighter A, but still read the whole clip before judging what matters.'
      : coachingMode === 'scout'
        ? 'Prioritize exploitable patterns and strategic reads on Fighter B, but still account for how Fighter A creates those openings.'
        : 'Balance both fighters and explain the style matchup driving the exchange.'

  return [
    `INITIAL ANALYSIS PRIORITY: ${focusDescription}.`,
    fighterContext ? `FIGHTER LABELS: ${fighterContext.trim()}` : '',
    modeDirective,
    'For the first full video breakdown, sound like a real elite coach doing film study.',
    'Keep the Quick Scan factual, then give a dense, high-signal coaching breakdown.',
    'Name the style matchup plainly when it is visible on tape.',
  ]
    .filter(Boolean)
    .join('\n')
}

const dedupeStrings = (values: Array<string | null | undefined>): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const clean = typeof value === 'string' ? value.trim() : ''
    if (!clean) continue
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(clean)
  }
  return out
}

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []
  return dedupeStrings(value.map((entry) => (typeof entry === 'string' ? entry : '')))
}

const extractJsonObject = <T = Record<string, unknown>>(raw: string): T | null => {
  const text = raw.trim()
  if (!text) return null

  try {
    return JSON.parse(text) as T
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return null
    try {
      return JSON.parse(match[0]) as T
    } catch {
      return null
    }
  }
}

const summarizePoseEvidenceForPrompt = (poseEvidence: any): string => {
  if (!poseEvidence || typeof poseEvidence !== 'object') return ''

  const lines: string[] = []

  for (const line of normalizeStringArray(poseEvidence.summaryLines)) lines.push(line)

  if (Array.isArray(poseEvidence.fighters)) {
    for (const fighter of poseEvidence.fighters) {
      if (!fighter || typeof fighter !== 'object') continue
      const id = typeof fighter.id === 'string' ? fighter.id : 'unknown'
      const stance = typeof fighter.stanceCandidate === 'string' ? fighter.stanceCandidate : 'unknown'
      const confidence = typeof fighter.stanceConfidenceLabel === 'string'
        ? fighter.stanceConfidenceLabel
        : typeof fighter.stanceConfidence === 'number'
          ? fighter.stanceConfidence >= 0.75
            ? 'high'
            : fighter.stanceConfidence >= 0.45
              ? 'medium'
              : 'low'
          : 'unknown'
      if (stance && stance !== 'unknown') {
        lines.push(`Fighter ${id} pose stance candidate: ${stance} (${confidence} confidence).`)
      }
      for (const line of normalizeStringArray(fighter.stanceEvidence)) {
        lines.push(`Fighter ${id}: ${line}`)
      }
      for (const line of normalizeStringArray(fighter.movementEvidence)) {
        lines.push(`Fighter ${id}: ${line}`)
      }
    }
  }

  if (typeof poseEvidence.tempoControllerHint === 'string' && poseEvidence.tempoControllerHint !== 'unknown') {
    lines.push(`Pose hint: Fighter ${poseEvidence.tempoControllerHint} appears to set the forward pressure pattern in sampled moments.`)
  }
  if (typeof poseEvidence.spaceControllerHint === 'string' && poseEvidence.spaceControllerHint !== 'unknown') {
    lines.push(`Pose hint: Fighter ${poseEvidence.spaceControllerHint} appears to control space in sampled moments.`)
  }
  for (const line of normalizeStringArray(poseEvidence.matchupStyleHints)) lines.push(line)
  for (const line of normalizeStringArray(poseEvidence.pairEvidence)) lines.push(line)
  for (const line of normalizeStringArray(poseEvidence.samplingNotes)) lines.push(line)

  return dedupeStrings(lines).join('\n')
}

const hasMeaningfulLedgerData = (ledger: FactualLedger | null): boolean => {
  if (!ledger || typeof ledger !== 'object') return false

  const listFields = [
    normalizeStringArray(ledger.observed_facts),
    normalizeStringArray(ledger.techniques_observed),
    normalizeStringArray(ledger.pace_and_positioning),
    normalizeStringArray(ledger.range_and_distance),
    normalizeStringArray(ledger.key_moments),
    normalizeStringArray(ledger.cv_evidence),
    normalizeStringArray(ledger.power_hand_read),
  ]

  if (listFields.some((list) => list.length > 0)) return true
  if (Array.isArray(ledger.fighters) && ledger.fighters.length > 0) return true
  if (Array.isArray(ledger.movement_map) && ledger.movement_map.length > 0) return true
  if (typeof ledger.shot_count_total === 'number' && ledger.shot_count_total > 0) return true
  if (typeof ledger.tempo_controller === 'string' && ledger.tempo_controller.trim()) return true
  if (typeof ledger.space_controller === 'string' && ledger.space_controller.trim()) return true
  if (typeof ledger.matchup_style === 'string' && ledger.matchup_style.trim()) return true
  return false
}

const buildMinimalLedgerFromPoseEvidence = (poseEvidence: any): FactualLedger | null => {
  if (!poseEvidence || typeof poseEvidence !== 'object') return null

  const fighters = Array.isArray(poseEvidence.fighters)
    ? poseEvidence.fighters
        .filter((fighter: unknown): fighter is {
          id: string
          stanceCandidate?: string
          stanceConfidenceLabel?: string
          stanceEvidence?: string[]
          movementEvidence?: string[]
          pressurePathStyle?: string
          orbitDirection?: string
        } => !!fighter && typeof fighter === 'object' && typeof (fighter as { id?: unknown }).id === 'string')
        .map((fighter: { id: string; stanceCandidate?: string; stanceConfidenceLabel?: string; stanceEvidence?: string[]; movementEvidence?: string[] }) => ({
          id: fighter.id,
          stance: typeof fighter.stanceCandidate === 'string' ? fighter.stanceCandidate : 'unknown',
          stance_confidence: typeof fighter.stanceConfidenceLabel === 'string' ? fighter.stanceConfidenceLabel : 'low',
          stance_evidence: dedupeStrings([
            ...normalizeStringArray(fighter.stanceEvidence),
            ...normalizeStringArray(fighter.movementEvidence),
          ]),
        }))
    : []

  const summaryLines = normalizeStringArray(poseEvidence.summaryLines)
  const matchupHints = normalizeStringArray(poseEvidence.matchupStyleHints)
  const pairEvidence = normalizeStringArray(poseEvidence.pairEvidence)
  const samplingNotes = normalizeStringArray(poseEvidence.samplingNotes)

  const movementMap = Array.isArray(poseEvidence.fighters)
    ? poseEvidence.fighters
        .filter((fighter: unknown): fighter is {
          id: string
          movementEvidence?: string[]
          lateralDirection?: string
          pressureTrend?: string
          pressurePathStyle?: string
          orbitDirection?: string
        } => !!fighter && typeof fighter === 'object' && typeof (fighter as { id?: unknown }).id === 'string')
        .map((fighter: { id: string; movementEvidence?: string[]; lateralDirection?: string; pressureTrend?: string; pressurePathStyle?: string; orbitDirection?: string }) => ({
          id: fighter.id,
          lateral_direction: typeof fighter.lateralDirection === 'string' ? fighter.lateralDirection : undefined,
          pressure_role: typeof fighter.pressureTrend === 'string' ? fighter.pressureTrend : undefined,
          pressure_path_style: typeof fighter.pressurePathStyle === 'string' ? fighter.pressurePathStyle : undefined,
          orbit_direction: typeof fighter.orbitDirection === 'string' ? fighter.orbitDirection : undefined,
          notes: normalizeStringArray(fighter.movementEvidence),
        }))
    : []

  const stanceEntries = fighters
    .filter((fighter: { stance?: string; stance_confidence?: string }) =>
      (fighter.stance === 'orthodox' || fighter.stance === 'southpaw') &&
      (fighter.stance_confidence === 'high' || fighter.stance_confidence === 'medium')
    )
    .map((fighter: { stance?: string }) => fighter.stance)

  const stanceMatchup =
    stanceEntries.length >= 2
      ? new Set(stanceEntries).size === 1
        ? 'closed stance'
        : 'open stance'
      : undefined

  const observedFacts = dedupeStrings([
    ...summaryLines.map((line) => line.replace(/^Pose hint:\s*/i, '')),
    ...pairEvidence,
    typeof poseEvidence.tempoControllerHint === 'string' && poseEvidence.tempoControllerHint !== 'unknown'
      ? `Fighter ${poseEvidence.tempoControllerHint} appears to set the tempo in sampled moments`
      : '',
    typeof poseEvidence.spaceControllerHint === 'string' && poseEvidence.spaceControllerHint !== 'unknown'
      ? `Fighter ${poseEvidence.spaceControllerHint} appears to control space in sampled moments`
      : '',
  ])

  const paceAndPositioning = dedupeStrings([
    ...summaryLines,
    ...matchupHints,
    ...movementMap.flatMap((entry: { id: string; pressure_role?: string; pressure_path_style?: string; notes?: string[] }) => [
      entry.pressure_role ? `Fighter ${entry.id}: ${entry.pressure_role}` : '',
      entry.pressure_path_style ? `Fighter ${entry.id}: ${entry.pressure_path_style}` : '',
      ...normalizeStringArray(entry.notes),
    ]),
  ])

  const powerHandRead = dedupeStrings([
    pairEvidence.some((line) => /outside range/i.test(line))
      ? 'Outside range appears to keep the exchange on lead-hand terms for much of the clip.'
      : '',
    stanceMatchup === 'closed stance'
      ? 'Closed-stance geometry means rear-hand lanes should only be claimed when a plant-and-throw is actually visible.'
      : '',
  ])

  const forbiddenClaims = dedupeStrings([
    'do not say the clip was empty',
    'do not say no fighters were seen',
    'do not invent combinations from pose-only fallback evidence',
  ])

  const ledger: FactualLedger = {
    fighters,
    movement_map: movementMap,
    observed_facts: observedFacts,
    pace_and_positioning: paceAndPositioning,
    range_and_distance: pairEvidence,
    video_quality_notes: samplingNotes,
    cv_evidence: normalizeStringArray(summarizePoseEvidenceForPrompt(poseEvidence).split('\n')),
    tempo_controller:
      typeof poseEvidence.tempoControllerHint === 'string' && poseEvidence.tempoControllerHint !== 'unknown'
        ? `Fighter ${poseEvidence.tempoControllerHint}`
        : undefined,
    space_controller:
      typeof poseEvidence.spaceControllerHint === 'string' && poseEvidence.spaceControllerHint !== 'unknown'
        ? `Fighter ${poseEvidence.spaceControllerHint}`
        : undefined,
    stance_matchup: stanceMatchup,
    matchup_style: matchupHints[0] || 'movement-first sparring sequence',
    power_hand_read: powerHandRead,
    exchange_volume: 'low-volume movement-first clip',
    style_read_confidence: 'low',
    forbidden_claims: forbiddenClaims,
    unknowns: ['pose-backed fallback ledger used because the primary evidence ledger came back empty'],
  }

  return hasMeaningfulLedgerData(ledger) ? ledger : null
}

const buildEmergencyLedgerPrompt = (options?: {
  clipDuration?: number
  focusTarget?: 'both' | 'blue' | 'red' | 'A' | 'B'
  poseEvidenceText?: string
}): string => {
  const focusText =
    options?.focusTarget === 'blue' || options?.focusTarget === 'A'
      ? 'Pay extra attention to Fighter A.'
      : options?.focusTarget === 'red' || options?.focusTarget === 'B'
        ? 'Pay extra attention to Fighter B.'
        : 'Log both fighters.'

  const durationHint = options?.clipDuration
    ? `Clip duration is about ${options.clipDuration.toFixed(1)} seconds.`
    : ''

  const poseBlock = options?.poseEvidenceText
    ? `\nPose/CV hints:\n${options.poseEvidenceText}`
    : ''

  return `Return ONLY JSON for a combat clip evidence ledger.

${focusText}
${durationHint}${poseBlock}

Be conservative. Do not guess. If something is unclear, leave it empty or put it in unknowns.

Return this shape:
{
  "fighters": [
    { "id": "A", "description": "visible appearance only", "stance": "orthodox | southpaw | unknown", "stance_confidence": "high | medium | low", "stance_evidence": [] },
    { "id": "B", "description": "visible appearance only", "stance": "orthodox | southpaw | unknown", "stance_confidence": "high | medium | low", "stance_evidence": [] }
  ],
  "observed_facts": [],
  "techniques_observed": [],
  "techniques_not_seen": [],
  "pace_and_positioning": [],
  "range_and_distance": [],
  "movement_map": [],
  "tempo_controller": "",
  "space_controller": "",
  "matchup_style": "",
  "power_hand_read": [],
  "exchange_volume": "",
  "key_moments": [],
  "unknowns": []
}`
}

const mergePoseEvidenceIntoLedger = (ledger: FactualLedger | null, poseEvidence: any): FactualLedger | null => {
  if (!ledger && (!poseEvidence || typeof poseEvidence !== 'object')) return ledger

  const merged: FactualLedger = ledger ? { ...ledger } : {}
  const poseSummary = summarizePoseEvidenceForPrompt(poseEvidence)

  merged.observed_facts = normalizeStringArray(merged.observed_facts)
  merged.weapons_actually_used = normalizeStringArray(merged.weapons_actually_used)
  merged.techniques_observed = normalizeStringArray(merged.techniques_observed)
  merged.combos_observed = normalizeStringArray(merged.combos_observed)
  merged.techniques_not_seen = normalizeStringArray(merged.techniques_not_seen)
  merged.uncertain_actions = normalizeStringArray(merged.uncertain_actions)
  merged.pace_and_positioning = normalizeStringArray(merged.pace_and_positioning)
  merged.range_and_distance = normalizeStringArray(merged.range_and_distance)
  merged.key_moments = normalizeStringArray(merged.key_moments)
  merged.video_quality_notes = normalizeStringArray(merged.video_quality_notes)
  merged.unknowns = normalizeStringArray(merged.unknowns)
  merged.forbidden_claims = normalizeStringArray(merged.forbidden_claims)
  merged.cv_evidence = normalizeStringArray(merged.cv_evidence)
  merged.power_hand_read = normalizeStringArray(merged.power_hand_read)

  if (!poseEvidence || typeof poseEvidence !== 'object') {
    return merged
  }

  if (!Array.isArray(merged.fighters)) merged.fighters = []
  if (!Array.isArray(merged.movement_map)) merged.movement_map = []

  const fightersById = new Map<string, any>()
  for (const fighter of merged.fighters) {
    if (fighter?.id) fightersById.set(String(fighter.id), fighter)
  }
  const movementById = new Map<string, any>()
  for (const movement of merged.movement_map) {
    if (movement?.id) movementById.set(String(movement.id), movement)
  }

  if (Array.isArray(poseEvidence.fighters)) {
    for (const poseFighter of poseEvidence.fighters) {
      if (!poseFighter || typeof poseFighter !== 'object' || typeof poseFighter.id !== 'string') continue

      const existing = fightersById.get(poseFighter.id) || { id: poseFighter.id }
      const existingEvidence = normalizeStringArray(existing.stance_evidence)
      const poseEvidenceLines = [
        ...normalizeStringArray(poseFighter.stanceEvidence),
        ...normalizeStringArray(poseFighter.movementEvidence),
      ]

      const poseStance = typeof poseFighter.stanceCandidate === 'string' ? poseFighter.stanceCandidate : 'unknown'
      const poseConfidenceLabel = typeof poseFighter.stanceConfidenceLabel === 'string'
        ? poseFighter.stanceConfidenceLabel
        : typeof poseFighter.stanceConfidence === 'number'
          ? poseFighter.stanceConfidence >= 0.75
            ? 'high'
            : poseFighter.stanceConfidence >= 0.45
              ? 'medium'
              : 'low'
          : existing.stance_confidence || 'low'

      if ((!existing.stance || existing.stance === 'unknown' || existing.stance_confidence === 'low') && poseStance && poseStance !== 'unknown') {
        existing.stance = poseStance
        existing.stance_confidence = poseConfidenceLabel
      }

      existing.stance_evidence = dedupeStrings([...existingEvidence, ...poseEvidenceLines])
      fightersById.set(poseFighter.id, existing)

      const existingMovement = movementById.get(poseFighter.id) || { id: poseFighter.id }
      existingMovement.lateral_direction =
        existingMovement.lateral_direction ||
        (poseFighter.lateralDirection === 'leftward_in_frame'
          ? 'sampled drift leftward in frame'
          : poseFighter.lateralDirection === 'rightward_in_frame'
            ? 'sampled drift rightward in frame'
            : 'sampled drift stays fairly centered in frame')
      existingMovement.pressure_role =
        existingMovement.pressure_role ||
        (poseFighter.pressureTrend === 'advancing'
          ? 'advancing more often in sampled moments'
          : poseFighter.pressureTrend === 'yielding'
            ? 'yielding more often in sampled moments'
            : 'mixed pressure pattern in sampled moments')
      existingMovement.pressure_path_style =
        existingMovement.pressure_path_style ||
        (poseFighter.pressurePathStyle === 'arcing_left'
          ? 'leftward pressure arc'
          : poseFighter.pressurePathStyle === 'arcing_right'
            ? 'rightward pressure arc'
            : poseFighter.pressurePathStyle)
      existingMovement.orbit_direction =
        existingMovement.orbit_direction ||
        (poseFighter.orbitDirection === 'mixed' ? 'mixed' : poseFighter.orbitDirection)
      existingMovement.notes = dedupeStrings([
        ...normalizeStringArray(existingMovement.notes),
        ...normalizeStringArray(poseFighter.movementEvidence),
      ])
      movementById.set(poseFighter.id, existingMovement)
    }
  }

  merged.fighters = Array.from(fightersById.values())
  merged.movement_map = Array.from(movementById.values())
  merged.cv_evidence = dedupeStrings([...merged.cv_evidence, ...normalizeStringArray(poseSummary.split('\n'))])
  merged.pace_and_positioning = dedupeStrings([
    ...merged.pace_and_positioning,
    ...normalizeStringArray(poseEvidence.summaryLines),
    ...normalizeStringArray(poseEvidence.matchupStyleHints),
    ...normalizeStringArray(poseEvidence.pairEvidence),
  ])
  merged.video_quality_notes = dedupeStrings([
    ...merged.video_quality_notes,
    ...normalizeStringArray(poseEvidence.samplingNotes),
  ])

  if ((!merged.tempo_controller || /unknown/i.test(merged.tempo_controller)) && typeof poseEvidence.tempoControllerHint === 'string' && poseEvidence.tempoControllerHint !== 'unknown') {
    merged.tempo_controller = `Fighter ${poseEvidence.tempoControllerHint}`
  }
  if ((!merged.space_controller || /unknown/i.test(merged.space_controller)) && typeof poseEvidence.spaceControllerHint === 'string' && poseEvidence.spaceControllerHint !== 'unknown') {
    merged.space_controller = `Fighter ${poseEvidence.spaceControllerHint}`
  }
  if ((!merged.matchup_style || /unknown/i.test(merged.matchup_style)) && Array.isArray(poseEvidence.matchupStyleHints) && poseEvidence.matchupStyleHints.length > 0) {
    merged.matchup_style = normalizeStringArray(poseEvidence.matchupStyleHints)[0]
  }
  if (merged.power_hand_read.length === 0 && normalizeStringArray(poseEvidence.pairEvidence).some((line) => /outside range/i.test(line))) {
    merged.power_hand_read = dedupeStrings([
      ...merged.power_hand_read,
      'Sampled spacing suggests lead-hand probes matter more than full rear-hand commitments in many moments.',
    ])
  }

  const stanceEntries = Array.isArray(merged.fighters)
    ? merged.fighters
        .filter((fighter: unknown): fighter is { id: string; stance?: string; stance_confidence?: string } =>
          !!fighter && typeof (fighter as { id?: unknown }).id === 'string'
        )
        .map((fighter) => ({
          id: fighter.id,
          stance: typeof fighter.stance === 'string' ? fighter.stance : 'unknown',
          confidence: typeof fighter.stance_confidence === 'string' ? fighter.stance_confidence : 'unknown',
        }))
    : []

  const reliableStances = stanceEntries.filter((fighter) =>
    (fighter.stance === 'orthodox' || fighter.stance === 'southpaw') &&
    (fighter.confidence === 'high' || fighter.confidence === 'medium')
  )

  if (reliableStances.length >= 2) {
    const uniqueStances = Array.from(new Set(reliableStances.map((fighter) => fighter.stance)))
    if (uniqueStances.length === 1) {
      merged.stance_matchup = 'closed stance'
      merged.forbidden_claims = dedupeStrings([
        ...merged.forbidden_claims,
        'do not describe this clip as open stance',
      ])
      for (const fighter of reliableStances) {
        merged.forbidden_claims = dedupeStrings([
          ...merged.forbidden_claims,
          `do not describe Fighter ${fighter.id} as ${fighter.stance === 'orthodox' ? 'southpaw' : 'orthodox'}`,
        ])
      }
    } else if (uniqueStances.length === 2) {
      merged.stance_matchup = 'open stance'
    }
  }

  if (merged.combos_observed.length === 0) {
    merged.forbidden_claims = dedupeStrings([
      ...merged.forbidden_claims,
      'do not describe this clip as combination-heavy',
    ])
  }

  if (
    merged.techniques_not_seen.some((item) => /kick|teep|knee|elbow/i.test(item)) &&
    !merged.weapons_actually_used.some((item) => /kick/i.test(item))
  ) {
    merged.forbidden_claims = dedupeStrings([
      ...merged.forbidden_claims,
      'do not say kicks were thrown',
    ])
  }

  return merged
}

const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number
) => {
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timeout)
  }
}

const extractAppearanceColor = (description?: string): string | null => {
  if (!description) return null
  const match = description.match(/\b(black|green|blue|red|white|gray|grey|yellow|orange|purple)\b/i)
  return match ? match[1].toLowerCase() : null
}

const detectCoachingContradictions = (text: string, ledger: FactualLedger | null): string[] => {
  if (!text || !ledger) return []
  const issues: string[] = []
  const normalized = text.toLowerCase()

  if (
    ledger.stance_matchup === 'closed stance' &&
    /(open-stance|open stance|orthodox vs\.?\s*southpaw|southpaw vs\.?\s*orthodox)/i.test(text)
  ) {
    issues.push('The response describes an open-stance matchup even though the ledger says closed stance.')
  }

  if (Array.isArray(ledger.fighters)) {
    for (const fighter of ledger.fighters) {
      if (!fighter?.id) continue
      const stance = typeof fighter.stance === 'string' ? fighter.stance.toLowerCase() : 'unknown'
      const stanceConfidence = typeof fighter.stance_confidence === 'string' ? fighter.stance_confidence.toLowerCase() : 'unknown'
      if ((stance === 'orthodox' || stance === 'southpaw') && /high|medium/.test(stanceConfidence)) {
        const wrongStance = stance === 'orthodox' ? 'southpaw' : 'orthodox'
        const fighterStanceRegex = new RegExp(`fighter\\s+${fighter.id}[^\\n\\.]{0,80}\\b${wrongStance}\\b`, 'i')
        if (fighterStanceRegex.test(text)) {
          issues.push(`The response describes Fighter ${fighter.id} as ${wrongStance} even though the ledger says ${stance}.`)
        }
      }

      const color = extractAppearanceColor(fighter.description)
      if (color) {
        const mention = text.match(new RegExp(`fighter\\s+${fighter.id}[^\\n\\.]{0,100}`, 'i'))
        const mentionText = mention?.[0]?.toLowerCase() || ''
        const colorWords = ['black', 'green', 'blue', 'red', 'white', 'gray', 'grey', 'yellow', 'orange', 'purple']
        const mentionedOtherColor = colorWords.find((candidate) => candidate !== color && mentionText.includes(candidate))
        if (mentionedOtherColor) {
          issues.push(`The response appears to swap Fighter ${fighter.id}'s appearance cue from ${color} to ${mentionedOtherColor}.`)
        }
      }
    }
  }

  if (Array.isArray(ledger.movement_map)) {
    for (const movement of ledger.movement_map) {
      if (!movement?.id) continue
      const pathStyle = typeof movement.pressure_path_style === 'string' ? movement.pressure_path_style.toLowerCase() : ''
      if (/arc/.test(pathStyle)) {
        const linearRegex = new RegExp(`fighter\\s+${movement.id}[\\s\\S]{0,220}(linear tracking|advancing straight forward|walking straight forward|walking straight in|marching straight in)`, 'i')
        if (linearRegex.test(text)) {
          issues.push(`The response flattens Fighter ${movement.id}'s pressure into straight-line tracking even though the ledger says the path is arcing.`)
        }
      }
    }
  }

  if (
    Array.isArray(ledger.power_hand_read) &&
    ledger.power_hand_read.some((line) => /rear hands mostly holstered/i.test(line)) &&
    /(rear hand.*primary weapon|power hand.*main weapon)/i.test(normalized)
  ) {
    issues.push('The response overstates rear-hand access against the ledger power-hand read.')
  }

  return issues
}

const rewriteCoachingToMatchLedger = async (
  fullText: string,
  ledger: FactualLedger | null,
  geminiKey: string,
  modelId: string
): Promise<string> => {
  const issues = detectCoachingContradictions(fullText, ledger)
  if (issues.length === 0) return fullText

  const repairUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${geminiKey}`
  try {
    const repairResp = await fetchWithTimeout(repairUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: [
              'Rewrite the coaching report so it is fully consistent with the factual ledger.',
              'Keep the same markdown section structure and high-level coaching tone.',
              'Correct only factual contradictions around fighter identity, stance geometry, movement direction, and path shape.',
              '',
              'Detected contradictions:',
              ...issues.map((issue) => `- ${issue}`),
              '',
              'Factual ledger:',
              JSON.stringify(ledger || {}, null, 2),
              '',
              'Original report to repair:',
              fullText,
            ].join('\n'),
          }],
        }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      }),
    }, 10000)

    if (!repairResp.ok) return fullText
    const repairData: any = await repairResp.json()
    const repairedText: string = repairData?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') || ''
    return repairedText.trim() || fullText
  } catch {
    return fullText
  }
}

/** Tactical anchors + hard bans derived from a factual ledger (shared by streaming + standard chat deep video). */
const buildLedgerTacticalAndBans = (factualLedger: FactualLedger | null) => {
  const forbiddenLines = normalizeStringArray(factualLedger?.forbidden_claims)
  const notSeenLines = normalizeStringArray(factualLedger?.techniques_not_seen)
  const weaponsUsed = normalizeStringArray(factualLedger?.weapons_actually_used)
  const powerHandRead = normalizeStringArray(factualLedger?.power_hand_read)
  const stanceMatchup = factualLedger?.stance_matchup || ''
  const stanceLines = Array.isArray(factualLedger?.fighters)
    ? factualLedger.fighters
        .filter((fighter: unknown): fighter is { id: string; stance?: string; stance_confidence?: string } =>
          !!fighter && typeof (fighter as { id?: unknown }).id === 'string'
        )
        .map((fighter) =>
          `Fighter ${fighter.id}: stance ${fighter.stance || 'unknown'} (${fighter.stance_confidence || 'unknown'} confidence)`
        )
    : []
  const appearanceLines = Array.isArray(factualLedger?.fighters)
    ? factualLedger.fighters
        .filter((fighter: unknown): fighter is { id: string; description?: string } =>
          !!fighter && typeof (fighter as { id?: unknown }).id === 'string' && typeof (fighter as { description?: unknown }).description === 'string'
        )
        .map((fighter) => `Fighter ${fighter.id}: appearance ${fighter.description}`)
    : []
  const shotCount = typeof factualLedger?.shot_count_total === 'number' ? factualLedger.shot_count_total : null
  const shotCountByFighter = Array.isArray(factualLedger?.shot_count_by_fighter)
    ? factualLedger.shot_count_by_fighter
        .filter((entry): entry is { id: string; count: number; weapons?: string[] } =>
          !!entry &&
          typeof entry === 'object' &&
          typeof entry.id === 'string' &&
          typeof entry.count === 'number'
        )
        .map((entry) => `Fighter ${entry.id}: ${entry.count} clear shots${Array.isArray(entry.weapons) && entry.weapons.length > 0 ? ` (${entry.weapons.join(', ')})` : ''}`)
    : []
  const movementMapLines = Array.isArray(factualLedger?.movement_map)
    ? factualLedger.movement_map
        .filter((entry): entry is { id: string; lateral_direction?: string; circling_direction?: string; orbit_direction?: string; pressure_role?: string; tempo_role?: string; pressure_path_style?: string; notes?: string[] } =>
          !!entry && typeof entry === 'object' && typeof entry.id === 'string'
        )
        .map((entry) => {
          const parts = [
            entry.lateral_direction,
            entry.circling_direction ? `circling: ${entry.circling_direction}` : '',
            entry.orbit_direction ? `orbit: ${entry.orbit_direction}` : '',
            entry.pressure_role,
            entry.tempo_role,
            entry.pressure_path_style ? `path: ${entry.pressure_path_style}` : '',
            ...normalizeStringArray(entry.notes),
          ].filter(Boolean)
          return parts.length > 0 ? `Fighter ${entry.id}: ${parts.join('; ')}` : ''
        })
        .filter(Boolean)
    : []
  const tempoController = factualLedger?.tempo_controller || ''
  const spaceController = factualLedger?.space_controller || ''
  const matchupStyle = factualLedger?.matchup_style || ''
  const noCombos = !factualLedger?.combos_observed || factualLedger.combos_observed.length === 0
  const volume = factualLedger?.exchange_volume || ''

  const tacticalAnchors = [
    stanceMatchup ? `- STANCE MATCHUP: ${stanceMatchup}. Keep the stance geometry consistent with this.` : '',
    ...stanceLines.map((line) => `- ${line}`),
    ...appearanceLines.map((line) => `- ${line}. Do not swap these appearance cues.`),
    shotCount != null ? `- VERIFIED SHOT COUNT: ${shotCount} total clear shots.` : '',
    ...shotCountByFighter.map((line) => `- ${line}`),
    tempoController ? `- TEMPO CONTROLLER: ${tempoController}. Do not credit that role to the other fighter.` : '',
    spaceController ? `- SPACE CONTROLLER: ${spaceController}. Do not invert who dictated the geography.` : '',
    matchupStyle ? `- MATCHUP STYLE: ${matchupStyle}. Keep the whole read aligned with this archetype.` : '',
    ...movementMapLines.map((line) => `- MOVEMENT MAP: ${line}`),
    ...powerHandRead.map((line) => `- POWER-HAND READ: ${line}`),
  ].filter(Boolean)

  const hardBans = [
    ...forbiddenLines.map((line) => `- FORBIDDEN: ${line}`),
    ...notSeenLines.map((item) => `- DO NOT say "${item}" happened. It was not seen.`),
    noCombos ? '- DO NOT use the words "combination", "flurry", "strings together", or "chain". There were no clear combos.' : '',
    weaponsUsed.length > 0 && weaponsUsed.every((w) => /punch|hand|box/i.test(w))
      ? '- DO NOT describe kicks, knees, teeps, elbows, or clinch as things that happened. Only punches were used.'
      : '',
    volume && /low|sparse|single/i.test(volume)
      ? '- This was a LOW-VOLUME clip. Keep tactical claims narrow and clip-specific. Do not inflate the exchange.'
      : '',
  ].filter(Boolean)

  return { tacticalAnchors, hardBans }
}

const buildLedgerFallbackReport = (ledger: FactualLedger | null): string => {
  const facts = ledger?.observed_facts?.slice(0, 3) || []
  const techniques = ledger?.techniques_observed?.slice(0, 5) || []
  const pace = ledger?.pace_and_positioning?.slice(0, 3) || []
  const range = ledger?.range_and_distance?.slice(0, 2) || []
  const powerHand = ledger?.power_hand_read?.slice(0, 2) || []
  const unknowns = ledger?.unknowns?.slice(0, 2) || []
  const notSeen = ledger?.techniques_not_seen?.slice(0, 5) || []
  const noCombos = !ledger?.combos_observed || ledger.combos_observed.length === 0
  const volume = ledger?.exchange_volume || 'low-volume actions'
  const stanceMatchup = ledger?.stance_matchup || ''
  const shotCount = typeof ledger?.shot_count_total === 'number' ? ledger.shot_count_total : null
  const tempoController = ledger?.tempo_controller || ''
  const spaceController = ledger?.space_controller || ''
  const matchupStyle = ledger?.matchup_style || ''

  const storyLines = [
    matchupStyle ? `The matchup reads as ${matchupStyle}.` : '',
    stanceMatchup ? `Stance geometry reads as ${stanceMatchup}.` : '',
    facts[0],
    shotCount != null ? `${shotCount} clear shots were logged in the clip.` : '',
    tempoController ? `${tempoController} appears to set the tempo.` : '',
    pace[0],
    range[0],
    noCombos ? 'The clip reads as isolated shots and movement rather than a sustained combination exchange.' : '',
  ].filter(Boolean)

  const rightLines = [
    spaceController ? `- Space control read: ${spaceController}.` : '',
    pace[0] ? `- ${pace[0]}.` : '',
    range[0] ? `- ${range[0]}.` : '',
    techniques[0] ? `- Clearly verified action: ${techniques[0]}.` : '',
  ].filter(Boolean)

  const fixLines = [
    noCombos ? '- Keep the read narrow. This clip does not justify a big combination narrative.' : '',
    unknowns[0] ? `- One key uncertainty remains: ${unknowns[0]}.` : '- Any clip-specific correction should stay tied to the few verified actions, not inferred sequences.',
    notSeen.length > 0 ? `- Do not build clip-specific advice around unshown weapons: ${notSeen.join(', ')}.` : '',
    powerHand[0] ? `- Keep the range read tied to the ledger: ${powerHand[0]}` : '',
  ].filter(Boolean)

  const drillLines = [
    noCombos
      ? '- Drill single-shot entries and exits: one clean jab or lead-hand touch, then angle out before resetting.'
      : '- Drill the exact verified sequence rather than imagined follow-ups.',
    pace[0]
      ? `- Drill around the main pace pattern from the clip: ${pace[0].toLowerCase()}.`
      : '- Drill footwork around the verified movement pattern in the clip.',
  ].filter(Boolean)

  const strategicLines = [
    `This fallback report is grounded only in the verified ledger from a ${volume} clip.`,
    matchupStyle ? `Style read: ${matchupStyle}.` : '',
    shotCount != null ? `Verified volume: ${shotCount} clear shots.` : '',
    storyLines[0] ? `The main read is simple: ${storyLines.join(' ')}` : 'The main read is simple: there are only a few verified actions, so the strategy claim has to stay narrow.',
  ]

  return [
    '### The Story of the Exchange',
    storyLines.join(' ') || 'This clip contains only a small number of verified actions, so the honest read is a sparse exchange shaped more by positioning and timing than by volume.',
    '',
    '### What Went Right',
    ...(rightLines.length > 0 ? rightLines : ['- The verified actions are too sparse for a broader claim.']),
    '',
    '### What to Fix',
    ...(fixLines.length > 0 ? fixLines : ['- Keep all corrections tied to the few visible actions in the clip.']),
    '',
    '### The Drill',
    ...(drillLines.length > 0 ? drillLines : ['- Recreate the few verified moments and build from those.']),
    '',
    '### Strategic Read',
    strategicLines.join(' '),
  ].join('\n')
}

// Import handlers from existing endpoints (we'll consolidate them)
const handleAnalyzeFrame = async (formData: FormData, user: any) => {
  // Defense-in-depth OFFLINE_MODE gate.
  if (process.env.OFFLINE_MODE === '1' || process.env.GEMINI_DRY_RUN === '1') {
    return {
      mocked: true,
      analysis: '[OFFLINE MODE] Frame analysis is disabled for zero-cost testing.',
      provider: 'offline-mock',
    }
  }

  // Consolidated analyze-frame logic with kinematics persistence
  const file = formData.get('image') as File
  const kinRaw = formData.get('kinematics') as string
  const contextRaw = formData.get('context') as string
  const sessionId = formData.get('sessionId') as string

  if (!(file instanceof File)) {
    throw new Error('Missing image')
  }

  const parseContextField = (raw: FormDataEntryValue | null, fieldName: string): unknown => {
    if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
    try {
      return JSON.parse(raw)
    } catch {
      logger.warn(`Failed to parse ${fieldName}; injecting raw text`, { fieldName })
      return raw
    }
  }

  const parsedContext = parseContextField(contextRaw, 'context')
  const frameContext: ReflexFrameContext =
    parsedContext && typeof parsedContext === 'object'
      ? { ...(parsedContext as Record<string, unknown>) }
      : parsedContext
        ? { userContext: parsedContext }
        : {}

  const fighterProfile = parseContextField(
    formData.get('fighterProfile') ?? formData.get('fighterProfiles'),
    'fighterProfile'
  )
  if (fighterProfile !== undefined) {
    frameContext.fighterProfile = fighterProfile
  }

  const gymRules = parseContextField(
    formData.get('gymRules') ?? formData.get('adminRules'),
    'gymRules'
  )
  if (gymRules !== undefined) {
    frameContext.gymRules = gymRules
  }

  if (sessionId) {
    frameContext.sessionId = sessionId
  }

  let kinematics = null
  if (kinRaw) {
    try {
      kinematics = JSON.parse(kinRaw)
    } catch (e) {
      logger.warn('Failed to parse kinematics', { error: e instanceof Error ? e.message : String(e) })
    }
  }
  if (kinematics && frameContext.kinematics === undefined) {
    frameContext.kinematics = kinematics
  }

  // Store kinematics snapshot if provided (skip when DB not available, e.g. local dev)
  const dbForKinematics = getDbOrNull()
  if (kinematics && sessionId && dbForKinematics) {
    await dbForKinematics.prepare(`
      INSERT INTO kinematics_snapshots (
        id, session_id, timestamp, frame_number,
        hand_speed_bwps, hand_burst_bwps, foot_speed_bwps, hip_speed_bwps,
        power_index, range_distance_bw, range_closing_bwps, range_state,
        technique_type, technique_confidence, raw_kinematics
      ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      sessionId,
      kinematics.frameNumber || 0,
      kinematics.handSpeedBwps || 0,
      kinematics.handBurstBwps || 0,
      kinematics.footSpeedBwps || 0,
      kinematics.hipSpeedBwps || 0,
      kinematics.powerIndex || 0,
      kinematics.range?.distanceBw || 0,
      kinematics.range?.closingBwps || 0,
      kinematics.range?.band || 'unknown',
      kinematics.technique?.type || null,
      kinematics.technique?.confidence || 0,
      JSON.stringify(kinematics)
    ).run()
  }

  const openaiKey = readSecretEnv('OPENAI_API_KEY')
  const geminiKey = readSecretEnv('GEMINI_API_KEY')
  const provider = (process.env.FIGHT_LLM_PROVIDER || '').toLowerCase()

  if (!openaiKey && !geminiKey) {
    throw new Error('No LLM provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY to enable frame analysis.')
  }

  const arrayBufferToBase64 = (ab: ArrayBuffer): string => {
    const bytes = new Uint8Array(ab)
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize)
      binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
  }

  const b64 = arrayBufferToBase64(await file.arrayBuffer())
  const mime = file.type || 'image/jpeg'

  const system =
    'You are Musashi Fight Coach: elite corner, analyst, and strategist.\n' +
    'Analyze this frame with high-signal, practical coaching.\n' +
    'Focus on: stance, guard, positioning, technique execution, openings.\n' +
    'Be concise and actionable.\n'

  const prompt =
    system +
    'Return JSON with this schema:\n' +
    '{\n' +
    '  "fighterA": {\n' +
    '    "stance": string,\n' +
    '    "guard": string,\n' +
    '    "position": string,\n' +
    '    "technique": string,\n' +
    '    "openings": array<string>\n' +
    '  },\n' +
    '  "fighterB": {\n' +
    '    "stance": string,\n' +
    '    "guard": string,\n' +
    '    "position": string,\n' +
    '    "technique": string,\n' +
    '    "openings": array<string>\n' +
    '  },\n' +
    '  "exchange": {\n' +
    '    "range": string,\n' +
    '    "tempo": string,\n' +
    '    "advantage": string\n' +
    '  },\n' +
    '  "coaching": {\n' +
    '    "immediate": array<string>,\n' +
    '    "strategic": array<string>\n' +
    '    "drills": array<string>\n' +
    '  }\n' +
    '}\n' +
    (kinematics ? `\nKinematics: ${JSON.stringify(kinematics, null, 2)}\n` : '')

  try {
    if (provider === 'gemini' || (!provider && geminiKey)) {
      if (!geminiKey) {
        throw new Error('GEMINI_API_KEY not set')
      }

      const model = resolvedModels.reflex()
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`
      const requestBody = buildGeminiReflexFrameRequest({
        imageBase64: b64,
        mimeType: mime,
        context: frameContext,
      })

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })

      const data: any = await safeParseResponse(resp)
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Gemini request failed')
      }

      const text = extractGeminiText(data)
      return parseReflexFrameJson(text)
    }

    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not set')
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
            ]
          }
        ]
      })
    })

    const data: any = await safeParseResponse(resp)
    if (!resp.ok) {
      throw new Error(data?.error?.message || 'OpenAI request failed')
    }

    const text = data?.choices?.[0]?.message?.content || ''
    const parsed = JSON.parse(text)
    return parsed
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    throw new Error(`Frame analysis failed: ${msg}`)
  }
}

const handleChat = async (body: any, user: any) => {
  // Enhanced chat with real-time biometric context
  const { messages, context, sessionId } = body
  debugLog('handleChat:entry', { messageCount: messages?.length, isFollowUp: (messages?.length || 0) > 1, hasVideo: !!context?.nativeVideo, hasVideoFileUri: !!context?.videoFileUri })
  logger.debug('Chat request received', { messageCount: messages?.length, contextType: context?.nativeVideo ? 'video' : 'text' })

  // Defense-in-depth OFFLINE_MODE gate: prevents Gemini calls even if this
  // handler is invoked via a non-POST entry point or streaming route that
  // bypasses the top-level POST gate. With OFFLINE_MODE=1 or GEMINI_DRY_RUN=1
  // we return a canned coaching response so the UX is testable without spend.
  if (process.env.OFFLINE_MODE === '1' || process.env.GEMINI_DRY_RUN === '1') {
    return {
      message:
        '[OFFLINE MODE] Coaching is disabled for zero-cost testing. Set OFFLINE_MODE=0 and provide GEMINI_API_KEY to re-enable real coaching.',
      provider: 'offline-mock',
    }
  }

  if (!messages?.length) {
    throw new Error('Missing messages')
  }

  const userMessages = messages.map((m: any) => ({ role: m.role, content: m.content }))
  const isInitialVideoAnalysisRequest = Boolean(body?.context?.nativeVideo) &&
    userMessages.length === 1 &&
    userMessages[0]?.role === 'user'

  const openaiKey = readSecretEnv('OPENAI_API_KEY')
  const geminiKey = readSecretEnv('GEMINI_API_KEY')
  const provider = (process.env.FIGHT_LLM_PROVIDER || '').toLowerCase()

  logger.debug('API configuration', { hasOpenAI: !!openaiKey, hasGemini: !!geminiKey, provider })

  if (!openaiKey && !geminiKey) {
    return { message: 'No LLM provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY to enable real coaching responses.' }
  }

  // Get latest kinematics if session provided (skip when DB not available)
  let latestKinematics = null
  if (sessionId) {
    try {
      const db = getDbOrNull()
      if (db) {
        const result = await db.prepare(`
          SELECT raw_kinematics 
          FROM kinematics_snapshots 
          WHERE session_id = ? 
          ORDER BY timestamp DESC 
          LIMIT 1
        `).bind(sessionId).first()
        latestKinematics = result?.raw_kinematics
      }
    } catch (e) {
      console.error('Failed to get latest kinematics:', e)
    }
  }

  // Determine coaching mode based on focus context
  let coachingMode = 'strategist' // default
  let focusDescription = 'both fighters and their interplay'

  if (context?.focusTarget === 'A') {
    coachingMode = 'corner_coach'
    focusDescription = 'Fighter A (your corner) - focus on form, technique, and biomechanical corrections'
  } else if (context?.focusTarget === 'B') {
    coachingMode = 'scout'
    focusDescription = 'Fighter B (opponent) - focus on habits, weaknesses, and exploitable patterns'
  } else if (context?.focusTarget === 'both') {
    coachingMode = 'strategist'
    focusDescription = 'both fighters - focus on interplay, range management, and strategic positioning'
  }

  // Extract fighter information for consistent referencing
  let fighterContext = ''
  if (context?.fighterLabels) {
    const labels = context.fighterLabels
    if (labels.A) {
      fighterContext += `Fighter A: ${labels.A.label}${labels.A.description ? ` (${labels.A.description})` : ''}. `
    }
    if (labels.B) {
      fighterContext += `Fighter B: ${labels.B.label}${labels.B.description ? ` (${labels.B.description})` : ''}. `
    }
  }

  // Build detailed kinematics context for data-driven coaching
  let kinematicsDetails = ''
  if (context?.kinematics?.fighters) {
    const fighters = context.kinematics.fighters
    const range = context.kinematics.range

    kinematicsDetails = '=== MEASURED KINEMATICS (cite ONLY these exact numbers) ===\n'
    if (fighters.A) {
      kinematicsDetails += `Fighter A: Hand Speed ${fighters.A.handSpeedBwps?.toFixed(2)} bw/s, Burst ${fighters.A.handBurstBwps?.toFixed(2)}, Power Index ${fighters.A.powerIndex?.toFixed(2)}, Hip Speed ${fighters.A.hipSpeedBwps?.toFixed(2)} bw/s.\n`
    }
    if (fighters.B) {
      kinematicsDetails += `Fighter B: Hand Speed ${fighters.B.handSpeedBwps?.toFixed(2)} bw/s, Burst ${fighters.B.handBurstBwps?.toFixed(2)}, Power Index ${fighters.B.powerIndex?.toFixed(2)}, Hip Speed ${fighters.B.hipSpeedBwps?.toFixed(2)} bw/s.\n`
    }
    if (range) {
      kinematicsDetails += `Range: ${range.distanceBw?.toFixed(2)} bw (${range.band}), Closing Speed ${range.closingBwps?.toFixed(2)} bw/s.\n`
    }
    kinematicsDetails += '=== END MEASURED KINEMATICS ==='
  }

  // Build discipline-specific coaching context
  const disciplineBlock = context?.discipline && context.discipline !== 'unknown'
    ? '\n' + getDisciplinePrompt(context.discipline)
    : ''
  const disciplineSection = disciplineBlock ? `${disciplineBlock}\n` : ''

  // Coach brain: global coach rules + the selected sport's brain markdown.
  // Appended alongside the existing discipline block — never replaces it.
  const coachBrainSection = '\n' + buildCoachBrainBlock({
    selectedSport: context?.discipline,
    clipType: context?.clipType,
    fighterFocus: context?.focusTarget,
    poseEngine: context?.poseEvidence?.engine ?? context?.poseEngine,
    poseQuality: context?.poseEvidence?.quality ?? context?.poseQuality,
  }) + '\n'

  const focusAwareSystemBase =
    'You are Musashi, an elite fight coach. Your lineage traces through Cus D\'Amato, Freddie Roach, and Firas Zahabi.\n' +
    'You speak with authority — brief, direct, high-signal. No fluff, no disclaimers, no generic motivation.\n' +
    'Blend tactics + strategy in the SAME answer.\n' +
    '\n' +

    'GROUNDING RULES (MANDATORY — NEVER VIOLATE THESE):\n' +
    '- ONLY describe actions, techniques, and events you can ACTUALLY SEE in the video/image.\n' +
    '- ONLY cite kinematics numbers from the MEASURED KINEMATICS section below. If no kinematics data is provided, describe qualitatively ("fast", "slow", "heavy") — NEVER invent bw/s or power index numbers.\n' +
    '- ONLY use timestamps (MM:SS) if you are analyzing a video with temporal access. For single images, say "in this frame".\n' +
    '- If fighters are mostly using footwork, feints, and range management with few exchanges, SAY THAT. Do not invent exchanges that did not happen.\n' +
    '- If you cannot determine something from the footage, say so briefly. Do not guess or fabricate.\n' +
    '- Fewer accurate observations beat many hallucinated ones.\n' +
    '- NEVER reference specific bw/s numbers, power indices, or timestamps unless they appear in the data provided to you.\n' +
    '\n' +

    `COACHING MODE: ${coachingMode.toUpperCase()}\n` +
    `FOCUS: ${focusDescription}\n` +

    (fighterContext ? `FIGHTERS IDENTIFIED: ${fighterContext.trim()}\n` : '') +
    (kinematicsDetails ? `\n${kinematicsDetails}\n` : '') +

    (coachingMode === 'corner_coach' ?
      'ACT AS CORNER COACH: Focus on Fighter A\'s form and technique. If measured kinematics data is provided above, reference those exact numbers. Look for biomechanical leaks, timing issues, and technical corrections that are VISIBLE in the footage.' :
      coachingMode === 'scout' ?
      'ACT AS SCOUT: Focus on Fighter B\'s patterns and weaknesses. If measured kinematics data is provided above, use those exact numbers to identify exploitable tendencies. Look for habits, tells, and openings VISIBLE in the footage.' :
      'ACT AS STRATEGIST: Analyze both fighters\' interplay. If measured kinematics data is provided above, compare their exact numbers. Otherwise describe what you OBSERVE qualitatively.'
    ) + '\n' +

    '\nRESPONSE STRUCTURE — adapt based on what you ACTUALLY observe:\n' +
    '- Lead with the single most important observation or correction from the footage.\n' +
    '- Include only sections you have REAL EVIDENCE for. Possible sections: Immediate fixes, Plan, Counters/setups, Drill.\n' +
    '- Skip any section where you would have to guess or invent details.\n' +
    '- For non-coaching questions (colors, objects, scene details), answer directly without redirecting to coaching.\n' +
    '\n' +

    'VOICE RULES:\n' +
    '- Sound like a real corner coach between rounds, not an AI writing an essay.\n' +
    '- Use second person ("you") when coaching the focused fighter, third person for the opponent.\n' +
    '- Use commands: "do X", "stop Y", "when Z happens, hit W" — not "consider", "perhaps", "you might want to".\n' +
    '- No motivational filler: no "great work", "keep it up" — only corrections and tactics.\n' +
    '- Reference what you SEE, not abstractions.\n'

  const focusAwareSystem = focusAwareSystemBase + disciplineSection + coachBrainSection + CONDENSED_FRAMEWORKS

  const ctx = context ? JSON.stringify(context) : ''
  const kinematicsBlock = latestKinematics
    ? `\nLatest kinematics: ${JSON.stringify(latestKinematics)}`
    : ''

  let knowledgeBlock = ''
  if (!isInitialVideoAnalysisRequest) {
    try {
      const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop()
      if (lastUserMsg?.content) {
        const knowledgeCtx = await getKnowledgeContext(lastUserMsg.content, 1500)
        if (knowledgeCtx) {
          knowledgeBlock = '\n' + knowledgeCtx
        }
      }
    } catch (e) {
      logger.warn('Failed to fetch knowledge context for chat', { error: e instanceof Error ? e.message : String(e) })
    }
  }

  let taxonomyBlock = ''
  if (!isInitialVideoAnalysisRequest) {
    try {
      const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop()
      if (lastUserMsg?.content) {
        const discipline = context?.discipline || undefined
        const taxonomyCtx = await taxonomySearch(lastUserMsg.content, discipline)
        if (taxonomyCtx) {
          taxonomyBlock = '\n' + taxonomyCtx
        }
      }
    } catch (e) {
      logger.warn('Failed to fetch taxonomy context', { error: e instanceof Error ? e.message : String(e) })
    }
  }

  const safePatternEvidence = summarizePatternEvidence(context?.patterns)
  const analysisBlock = summarizeStructuredContext(
    'APP ANALYSIS CONTEXT (reference only — compare it against the video, do not treat it as proof)',
    context?.analysis
  )
  const factualLedgerBlock = summarizeStructuredContext(
    'FACTUAL LEDGER (primary source of truth for visible events)',
    context?.analysis?.factualLedger,
    2600
  )
  const strategyBlock = summarizeStructuredContext(
    'CURRENT GAMEPLAN CONTEXT (planning reference only — do not claim it happened unless visible on tape)',
    context?.strategy,
    1600
  )
  const patternBlock = safePatternEvidence
    ? `\nDETECTED PATTERNS (validated pose summary):\n${safePatternEvidence}\nUse these only when they agree with what you can see in the clip.`
    : ''

  let personalizedBlock = ''
  // Only attempt personalized coaching when D1 DB is available (not local dev without Cloudflare binding).
  const dbAvailable = Boolean((process.env.DB as unknown as { prepare?: unknown } | undefined)?.prepare)
  if (!isInitialVideoAnalysisRequest && dbAvailable) {
    try {
      const userId = user.id
      if (userId && userId !== 'dev-user') {
        const coaching = await getPersonalizedCoaching(userId, context)
        if (coaching.personalizedFeedback) {
          personalizedBlock = `\nPERSONALIZED COACHING (based on training history):\n${coaching.personalizedFeedback}`
          if (coaching.focus.length > 0) {
            personalizedBlock += `\nFocus areas: ${coaching.focus.join(', ')}`
          }
        }
      }
    } catch (e) {
      logger.warn('Failed to fetch personalized coaching', { error: e instanceof Error ? e.message : String(e) })
    }
  }

  const focusSystem = focusAwareSystem + '\n' + kinematicsBlock + factualLedgerBlock + analysisBlock + strategyBlock + knowledgeBlock + taxonomyBlock + patternBlock + personalizedBlock
  const system = focusSystem

  try {
    if (provider === 'gemini' || (!provider && geminiKey)) {
      if (!geminiKey) {
        throw new Error('GEMINI_API_KEY not set')
      }

      const model = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview'
      const isValidFileUri = (uri: string) => {
        if (!uri) return false
        return uri.startsWith('https://generativelanguage.googleapis.com/') ||
               uri.startsWith('gs://') ||
               uri.startsWith('https://www.youtube.com/') ||
               uri.startsWith('https://')
      }

      const isNativeVideo = context?.nativeVideo && ((context.videoFileUri && isValidFileUri(context.videoFileUri)) || context.videoData)
      const isFirstMessage = userMessages.length === 1 && userMessages[0].role === 'user'
      const isVideoFollowUp = isNativeVideo && !isFirstMessage
      const useCometStyle = context?.analysisStyle === 'comet'

      // ==========================================
      // PASS 1 & 2: DEEP VIDEO ANALYSIS PIPELINE
      // ==========================================
      if (isNativeVideo && isFirstMessage) {
        logger.info('Triggering two-pass deep video analysis pipeline')
        
        // PASS 1: Flash Scan
        const flashModel = useCometStyle
          ? (process.env.GEMINI_COMET_FLASH_MODEL || 'gemini-2.5-flash')
          : (process.env.GEMINI_FLASH_MODEL || 'gemini-2.5-flash')
        const flashUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(flashModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`
        
        const flashParts: any[] = []
        if (context.videoFileUri && isValidFileUri(context.videoFileUri)) {
          flashParts.push({ fileData: { fileUri: context.videoFileUri, mimeType: context.videoMimeType || 'video/mp4' } })
        } else if (context.videoData) {
          flashParts.push({ inlineData: { mimeType: context.videoMimeType || 'video/mp4', data: context.videoData } })
        }
        flashParts.push({ text: useCometStyle ? COMET_FLASH_SCAN_PROMPT : FLASH_SCAN_PROMPT })

        let scanData: ScanData | null = null
        try {
          const flashResp = await fetch(flashUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: flashParts }],
              generationConfig: { temperature: 0.3, responseMimeType: 'application/json' }
            })
          })
          const flashData = await safeParseResponse(flashResp) as any
          if (flashResp.ok && flashData?.candidates?.[0]?.content?.parts?.[0]?.text) {
             const text = flashData.candidates[0].content.parts[0].text
             // Extract JSON block if surrounded by markdown
             const jsonMatch = text.match(/\{[\s\S]*\}/)
             if (jsonMatch) {
               scanData = JSON.parse(jsonMatch[0]) as ScanData
             } else {
               scanData = JSON.parse(text) as ScanData
             }
             logger.info('Flash scan successful', { numFighters: scanData.num_fighters })
          } else {
             logger.warn('Flash scan failed to return valid data')
          }
        } catch (e) {
           logger.warn('Flash scan exception, falling back to deep analysis without context', { error: e instanceof Error ? e.message : String(e) })
        }

        // Evidence ledger (same contract as streaming): Flash JSON + pose merge + emergency/minimal fallback.
        let factualLedgerChat: FactualLedger | null = null
        const ledgerVideoParts: any[] = []
        if (context.videoFileUri && isValidFileUri(context.videoFileUri)) {
          ledgerVideoParts.push({ fileData: { fileUri: context.videoFileUri, mimeType: context.videoMimeType || 'video/mp4' } })
        } else if (context.videoData) {
          ledgerVideoParts.push({ inlineData: { mimeType: context.videoMimeType || 'video/mp4', data: context.videoData } })
        }
        if (ledgerVideoParts.length > 0) {
          const poseEvidenceText = summarizePoseEvidenceForPrompt(context?.poseEvidence)
          const ledgerFocus =
            context?.focusTarget === 'A' ? 'A' : context?.focusTarget === 'B' ? 'B' : 'both'
          const ledgerFlashUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(flashModel)}:generateContent?key=${encodeURIComponent(geminiKey)}`
          try {
            const lp = [
              ...ledgerVideoParts,
              {
                text: buildEvidenceLedgerPrompt({
                  clipDuration: context?.clipDuration,
                  focusTarget: ledgerFocus,
                  poseEvidenceText,
                }),
              },
            ]
            const ledgerResp = await fetchWithTimeout(ledgerFlashUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: lp }],
                generationConfig: { temperature: 0.15, responseMimeType: 'application/json' },
              }),
            }, 30000)
            if (ledgerResp.ok) {
              const ledgerData: any = await ledgerResp.json()
              const rawText: string = ledgerData?.candidates?.[0]?.content?.parts?.[0]?.text || ''
              factualLedgerChat = extractJsonObject<FactualLedger>(rawText)
            }
          } catch {
            /* non-fatal */
          }
          factualLedgerChat = mergePoseEvidenceIntoLedger(factualLedgerChat, context?.poseEvidence)
          if (!hasMeaningfulLedgerData(factualLedgerChat)) {
            try {
              const ep = [
                ...ledgerVideoParts,
                {
                  text: buildEmergencyLedgerPrompt({
                    clipDuration: context?.clipDuration,
                    focusTarget: ledgerFocus,
                    poseEvidenceText,
                  }),
                },
              ]
              const recoveryResp = await fetchWithTimeout(ledgerFlashUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ role: 'user', parts: ep }],
                  generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
                }),
              }, 20000)
              if (recoveryResp.ok) {
                const recoveryData: any = await recoveryResp.json()
                const rawText: string = recoveryData?.candidates?.[0]?.content?.parts?.[0]?.text || ''
                const recoveredLedger = extractJsonObject<FactualLedger>(rawText)
                if (hasMeaningfulLedgerData(recoveredLedger)) {
                  factualLedgerChat = recoveredLedger
                }
              }
            } catch {
              /* non-fatal */
            }
          }
          factualLedgerChat = mergePoseEvidenceIntoLedger(factualLedgerChat, context?.poseEvidence)
          if (!hasMeaningfulLedgerData(factualLedgerChat)) {
            factualLedgerChat = buildMinimalLedgerFromPoseEvidence(context?.poseEvidence)
          }
        }

        // PASS 2: Deep Analysis
        const poseData = safePatternEvidence || undefined
        const deepPromptText = useCometStyle
          ? buildCometDeepAnalysisPrompt(scanData, kinematicsDetails)
          : buildDeepAnalysisPrompt(scanData, kinematicsDetails, poseData)

        const deepParts: any[] = []
        if (context.videoFileUri && isValidFileUri(context.videoFileUri)) {
          deepParts.push({ fileData: { fileUri: context.videoFileUri, mimeType: context.videoMimeType || 'video/mp4' } })
        } else if (context.videoData) {
          deepParts.push({ inlineData: { mimeType: context.videoMimeType || 'video/mp4', data: context.videoData } })
        }
        deepParts.push({ text: deepPromptText })

        const reqContents = [{ role: 'user', parts: deepParts }]

        const fullSystemPromptBase = useCometStyle
          ? [
              COMET_STYLE_ANALYSIS_SYSTEM.trim(),
              `GROUNDING RULES:
- ONLY describe actions, techniques, and events you can actually see in the video.
- If the scan conflicts with the video, trust the video.
- Treat the scan's techniques_observed / techniques_not_seen / uncertain_actions fields as an evidence contract unless the video clearly contradicts them.
- Only name a strike or action if it is visible on tape or listed in techniques_observed.
- If a technique appears in techniques_not_seen, do not say it happened unless the video clearly proves otherwise.
- If an action is unclear, say it is unclear. Do not upgrade an uncertain action into a named technique.
- Shin guards, MMA rules, stance, or distance do not prove kicks were thrown.
- If the fighters spend most of the clip feinting, circling, or range-finding, say that plainly instead of inventing combinations.
- If you cannot clearly identify a strike, do not name it.
- Tactical insight is required, but it must be built from real visible evidence.`
            ].join('\n\n')
          : [
              MUSASHI_DEEP_ANALYSIS_SYSTEM.trim(),
              disciplineSection.trim(),
              buildFirstPassPriorityBlock(coachingMode, focusDescription, fighterContext),
            ].filter(Boolean).join('\n\n')

        const { tacticalAnchors, hardBans } = buildLedgerTacticalAndBans(factualLedgerChat)
        const ledgerSystemAddon = factualLedgerChat
          ? `\n\nFACTUAL LEDGER (source of truth — align Quick Scan and technique claims with this JSON):\n${JSON.stringify(factualLedgerChat, null, 2)}\n\nTACTICAL ANCHORS:\n${tacticalAnchors.join('\n')}\n\nHARD BANS:\n${hardBans.join('\n')}`
          : ''
        const fullSystemPrompt = fullSystemPromptBase + ledgerSystemAddon

        const doDeepChat = async (modelId: string, useSystemInstruction: boolean) => {
           const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(geminiKey)}`
           logger.aiRequest(modelId, 'deep-video-analysis')
           const body: Record<string, unknown> = useSystemInstruction 
             ? { systemInstruction: { parts: [{ text: fullSystemPrompt }] }, contents: reqContents, generationConfig: { temperature: 0.55, maxOutputTokens: 4096 } }
             : { contents: [{ role: 'user', parts: [{ text: fullSystemPrompt }, ...deepParts] }], generationConfig: { temperature: 0.55, maxOutputTokens: 4096 } }
             
           const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
           let data: any
           try {
             data = await safeParseResponse(resp)
           } catch (parseErr) {
             data = { error: { message: String(parseErr), code: resp.status } }
           }
           return { resp, data }
        }

        const initialModel = useCometStyle
          ? (process.env.GEMINI_COMET_MODEL || 'gemini-2.5-pro')
          : model

        let { resp, data } = await doDeepChat(initialModel, true)
        const fallbackModels = ['gemini-2.5-flash', 'gemini-2.0-flash']

        if (!resp.ok && resp.status === 400 && (data?.error?.message || '').toLowerCase().includes('system')) {
          const fallback = await doDeepChat(model, false)
          resp = fallback.resp
          data = fallback.data
        }
        
        if (!resp.ok && (resp.status === 404 || resp.status === 500)) {
          for (const fallbackModel of fallbackModels) {
            const fallback = await doDeepChat(fallbackModel, true)
            resp = fallback.resp
            data = fallback.data
            if (resp.ok) break
          }
        }

        if (!resp.ok) {
          throw new Error(data?.error?.message || `Gemini request failed: ${resp.status}`)
        }

        let finalMessage =
          data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') || 'No response.'
        finalMessage = await rewriteCoachingToMatchLedger(finalMessage, factualLedgerChat, geminiKey, initialModel)
        return { message: finalMessage }
      }

      // ==========================================
      // STANDARD / FOLLOW-UP CHAT LOGIC
      // ==========================================
      let systemInstructionText = system
      let generationTemperature = 0.4
      if (isVideoFollowUp) {
        systemInstructionText = (useCometStyle
          ? [
              COMET_STYLE_ANALYSIS_SYSTEM.trim(),
              factualLedgerBlock,
              analysisBlock,
              strategyBlock,
              patternBlock,
              `FOLLOW-UP GROUNDING:
- Answer only from what is visible in the clip.
- If a factual ledger is provided, treat it as the source of truth for what happened.
- Use prior analysis and gameplan only as reference context.
- If the user says a claimed event did not happen, correct the record plainly.
- For verification questions, answer in 1-2 short sentences max and start with "Yes." or "No."
- Do not apologize, use self-referential language, or explain your own mistake history.
- Do not name kicks, knees, teeps, elbows, clinch actions, or takedowns unless they are clearly visible in the clip.
- If the factual ledger has no combos_observed, do not describe the clip as combination-heavy.
- If the factual ledger says punches only, do not drift into kick-based reads.`
            ].filter(Boolean).join('\n\n')
          : focusSystem) + FOLLOW_UP_CHAT_APPEND
        generationTemperature = 0.35
      }

      // Build first user turn: video/image context only (system goes in systemInstruction per Gemini API)
      const toInlineBase64 = (raw: unknown): string | null => {
        if (typeof raw !== 'string') return null
        const trimmed = raw.trim()
        const stripped = trimmed.startsWith('data:') && trimmed.includes(',')
          ? trimmed.slice(trimmed.indexOf(',') + 1).trim()
          : trimmed
        return stripped.length > 0 ? stripped : null
      }
      const sanitizeParts = (parts: any[]): any[] =>
        parts.filter((part) => {
          const inline = part?.inlineData || part?.inline_data
          if (!inline) return true
          return typeof inline.data === 'string' && inline.data.length > 0
        })
      const firstUserParts: any[] = []

      if (context?.nativeVideo && context?.videoFileUri && isValidFileUri(context.videoFileUri)) {
        const fps = context.requestedFPS || 5
        firstUserParts.push({
          fileData: {
            fileUri: context.videoFileUri,
            mimeType: context.videoMimeType || 'video/mp4',
          },
        })
        firstUserParts.push({
          text: `\n🎬 NATIVE VIDEO ANALYSIS MODE:\n` +
            `- Processing ${context.clipDuration?.toFixed(1)}s video clip with Gemini's native multimodal understanding\n` +
            `- Sample the video at approximately ${fps} frames per second for detailed motion capture\n` +
            `- You are analyzing the COMPLETE video with full temporal understanding\n` +
            `- Analyze: Every frame, complete motion sequences, technique execution, footwork, hand positioning, body mechanics, tactical flow, timing, rhythm, and fighting patterns\n` +
            `- Track movement frame-by-frame to understand the complete exchange\n` +
            `- Identify specific moments, transitions, and technical details throughout the video\n` +
            `- Use timestamps (MM:SS format) when referencing specific moments`
        })
      } else if (context?.nativeVideo && context?.videoData) {
        const fps = context.requestedFPS || 5
        const videoB64 = toInlineBase64(context.videoData)
        if (videoB64) {
          firstUserParts.push({
            inlineData: {
              mimeType: context.videoMimeType || 'video/mp4',
              data: videoB64,
            },
          })
        }
        firstUserParts.push({
          text: `\n🎬 NATIVE VIDEO (INLINE) MODE:\n` +
            `- Processing ${context.clipDuration?.toFixed(1)}s video clip\n` +
            `- Sample the video at approximately ${fps} frames per second for detailed motion capture\n` +
            `- Use timestamps (MM:SS format) when referencing specific moments`
        })
      } else if (context?.frames && Array.isArray(context.frames)) {
        const fps = context.frames.length / (context.clipDuration || 1)
        firstUserParts.push({
          text: `\n📹 FRAME-BY-FRAME ANALYSIS:\n` +
            `- Analyzing ${context.frames.length} frames from ${context.clipDuration?.toFixed(1)}s clip at ${fps.toFixed(1)} FPS`
        })
        for (let i = 0; i < context.frames.length; i++) {
          const base64Data = toInlineBase64(context.frames[i])
          if (base64Data) {
            firstUserParts.push({
              inlineData: { mimeType: 'image/jpeg', data: base64Data }
            })
          }
        }
      } else if (context?.image) {
        const base64Data = toInlineBase64(context.image)
        if (base64Data) {
          firstUserParts.push({
            inlineData: { mimeType: 'image/jpeg', data: base64Data }
          })
        }
      }

      // Build contents with alternating user/model turns (required for multi-turn chat)
      let remainingMessages = userMessages
      if (userMessages.length > 0 && userMessages[0].role === 'user') {
        firstUserParts.push({ text: firstUserParts.length > 0 ? `\n\n${userMessages[0].content}` : userMessages[0].content })
        remainingMessages = userMessages.slice(1)
      }
      const safeFirstUserParts = sanitizeParts(firstUserParts)
      const hasTextPart = safeFirstUserParts.some((part) => typeof part?.text === 'string' && part.text.length > 0)
      if (!hasTextPart) {
        safeFirstUserParts.push({ text: userMessages[0]?.content || 'Continue.' })
      }
      type ContentPart = { text: string } | Record<string, unknown>
      const contents: Array<{ role: 'user' | 'model'; parts: Array<ContentPart> }> = [
        { role: 'user', parts: safeFirstUserParts }
      ]
      for (const msg of remainingMessages) {
        const role = msg.role === 'assistant' ? 'model' : 'user'
        contents.push({ role, parts: [{ text: msg.content }] })
      }
      const contentsWithSystemInFirst: typeof contents = [
        { role: 'user', parts: [{ text: systemInstructionText }, ...safeFirstUserParts] }
      ]
      for (const msg of remainingMessages) {
        const role = msg.role === 'assistant' ? 'model' : 'user'
        contentsWithSystemInFirst.push({ role, parts: [{ text: msg.content }] })
      }

      const doGeminiChat = async (modelId: string, useSystemInstruction: boolean) => {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent?key=${encodeURIComponent(geminiKey)}`
        logger.aiRequest(modelId, 'chat', { hasVideo: !!context?.nativeVideo })
        const reqContents = useSystemInstruction ? contents : contentsWithSystemInFirst
        const body: Record<string, unknown> = useSystemInstruction
          ? { systemInstruction: { parts: [{ text: systemInstructionText }] }, contents: reqContents, generationConfig: { temperature: generationTemperature } }
          : { contents: reqContents, generationConfig: { temperature: generationTemperature } }
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
        let data: any
        try {
          data = await safeParseResponse(resp)
        } catch (parseErr) {
          const msg = parseErr instanceof Error ? parseErr.message : String(parseErr)
          data = { error: { message: msg, code: resp.status } }
        }
        return { resp, data }
      }

      let { resp, data } = await doGeminiChat(model, true)
      const fallbackModels = ['gemini-2.5-flash', 'gemini-2.0-flash']

      if (!resp.ok && resp.status === 400) {
        const errMsg = (data?.error?.message || '').toLowerCase()
        if (errMsg.includes('system') || errMsg.includes('instruction')) {
          logger.warn('systemInstruction not supported, retrying with system in first turn', { model })
          const fallback = await doGeminiChat(model, false)
          resp = fallback.resp
          data = fallback.data
        }
      }
      if (!resp.ok && (resp.status === 404 || resp.status === 500)) {
        for (const fallbackModel of fallbackModels) {
          if (model === fallbackModel) continue
          logger.warn('Gemini model failed, retrying with fallback', { model, status: resp.status, fallback: fallbackModel })
          const fallback = await doGeminiChat(fallbackModel, true)
          resp = fallback.resp
          data = fallback.data
          if (resp.ok) break
        }
      }

      logger.debug('Gemini response received', { status: resp.status, ok: resp.ok })
      if (!resp.ok) {
        logger.error('Gemini API error', { status: resp.status, error: data?.error })
        throw new Error(data?.error?.message || `Gemini request failed: ${resp.status}`)
      }

      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') || 'No response.'
      return { message: text }
    }

    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not set')
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: system },
          ...userMessages
        ]
      })
    })

    const data: any = await safeParseResponse(resp)
    if (!resp.ok) {
      throw new Error(data?.error?.message || 'OpenAI request failed')
    }

    const text = data?.choices?.[0]?.message?.content || 'No response.'
    return { message: text }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    throw new Error(`Chat failed: ${msg}`)
  }
}

const handleReflex = async (formData: FormData, user: any) => {
  // Defense-in-depth OFFLINE_MODE gate — same rationale as handleChat.
  if (process.env.OFFLINE_MODE === '1' || process.env.GEMINI_DRY_RUN === '1') {
    return {
      cues: ['[OFFLINE] Keep hands up.', '[OFFLINE] Rotate hips on cross.'],
      message: '[OFFLINE MODE] Reflex cues mocked for zero-cost testing.',
      provider: 'offline-mock',
    }
  }

  // Reflex coaching with immediate kinematics feedback
  const file = formData.get('image') as File
  const context = formData.get('context') as string
  const sessionId = formData.get('sessionId') as string

  if (!(file instanceof File)) {
    throw new Error('Missing image')
  }

  const openaiKey = readSecretEnv('OPENAI_API_KEY')
  const geminiKey = readSecretEnv('GEMINI_API_KEY')
  const provider = (process.env.FIGHT_LLM_PROVIDER || '').toLowerCase()

  if (!openaiKey && !geminiKey) {
    throw new Error('No LLM provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY to enable reflex cues.')
  }

  const arrayBufferToBase64 = (ab: ArrayBuffer): string => {
    const bytes = new Uint8Array(ab)
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize)
      binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
  }

  const jsonFromText = (text: string): any => {
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    if (first === -1 || last === -1 || last <= first) return null
    const slice = text.slice(first, last + 1)
    try {
      return JSON.parse(slice)
    } catch {
      return null
    }
  }

  const b64 = arrayBufferToBase64(await file.arrayBuffer())
  const mime = file.type || 'image/jpeg'

  let focusTarget: 'blue' | 'red' | 'both' = 'both'
  if (context) {
    try {
      const ctx = JSON.parse(context)
      const ft = ctx.focusTarget
      if (ft === 'blue' || ft === 'A') focusTarget = 'blue'
      else if (ft === 'red' || ft === 'B') focusTarget = 'red'
      else if (ft === 'both') focusTarget = 'both'
    } catch { /* ignore */ }
  }

  const focusInstruction =
    focusTarget === 'blue'
      ? 'Focus your cues ONLY on the fighter in the BLUE corner (Fighter A). Ignore the red corner.\n'
      : focusTarget === 'red'
        ? 'Focus your cues ONLY on the fighter in the RED corner (Fighter B). Ignore the blue corner.\n'
        : 'Focus on BOTH fighters. Give cues for whoever needs correction most.\n'

  const system =
    'You are Musashi Reflex Coach: stoic, brief, intense.\n' +
    'Your job is micro-corrections only. No essays. No disclaimers.\n' +
    'Output STRICT JSON only.\n' +
    focusInstruction

  const prompt =
    system +
    'Return STRICT JSON only with schema:\n' +
    '{"cue": string, "focus": string}\n' +
    'Rules:\n' +
    '- cue must be <= 8 words.\n' +
    '- focus is one of: "guard", "feet", "timing", "range", "defense", "offense", "clinching", "unknown".\n' +
    '- If uncertain, still give a best-effort cue and set focus="unknown".\n' +
    (context ? `Context JSON:\n${context}\n` : '')

  try {
    if (provider === 'gemini' || (!provider && geminiKey)) {
      if (!geminiKey) {
        throw new Error('GEMINI_API_KEY not set')
      }

      const model = process.env.GEMINI_REFLEX_MODEL || process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview'
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                { inlineData: { mimeType: mime, data: b64 } }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json'
          }
        })
      })

      const data: any = await safeParseResponse(resp)
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Gemini request failed')
      }

      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') || ''
      const parsed = jsonFromText(text)
      
      if (!parsed || typeof parsed.cue !== 'string') {
        throw new Error('Failed to parse model response')
      }

      return {
        cue: String(parsed.cue || '').trim() || 'Hands up.',
        focus: typeof parsed.focus === 'string' ? parsed.focus : undefined
      }
    }

    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not set')
    }

    const model = process.env.OPENAI_REFLEX_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
            ]
          }
        ]
      })
    })

    const data: any = await safeParseResponse(resp)
    if (!resp.ok) {
      throw new Error(data?.error?.message || 'OpenAI request failed')
    }

    const text = data?.choices?.[0]?.message?.content || ''
    const parsed = jsonFromText(text)
    
    if (!parsed || typeof parsed.cue !== 'string') {
      throw new Error('Failed to parse model response')
    }

    return {
      cue: String(parsed.cue || '').trim() || 'Hands up.',
      focus: typeof parsed.focus === 'string' ? parsed.focus : undefined
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    throw new Error(`Reflex failed: ${msg}`)
  }
}

const handleTrack = async (formData: FormData, user: any) => {
  // Defense-in-depth OFFLINE_MODE gate.
  if (process.env.OFFLINE_MODE === '1' || process.env.GEMINI_DRY_RUN === '1') {
    return {
      mocked: true,
      bbox: { x: 0.4, y: 0.3, w: 0.2, h: 0.5 },
      message: '[OFFLINE MODE] Neural tracking is disabled for zero-cost testing.',
      provider: 'offline-mock',
    }
  }

  // Enhanced tracking with kinematics correlation
  const file = formData.get('image') as File
  const target = formData.get('target') as string
  const sessionId = formData.get('sessionId') as string

  if (!(file instanceof File)) {
    throw new Error('Missing image')
  }

  if (!target) {
    throw new Error('Missing target')
  }

  const openaiKey = readSecretEnv('OPENAI_API_KEY')
  const geminiKey = readSecretEnv('GEMINI_API_KEY')
  const provider = (process.env.FIGHT_LLM_PROVIDER || '').toLowerCase()

  if (!openaiKey && !geminiKey) {
    throw new Error('No LLM provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY to enable neural tracking bbox detection.')
  }

  const arrayBufferToBase64 = (ab: ArrayBuffer): string => {
    const bytes = new Uint8Array(ab)
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize)
      binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
  }

  const jsonFromText = (text: string): any => {
    const first = text.indexOf('{')
    const last = text.lastIndexOf('}')
    if (first === -1 || last === -1 || last <= first) return null
    const slice = text.slice(first, last + 1)
    try {
      return JSON.parse(slice)
    } catch {
      return null
    }
  }

  const clamp = (n: number): number => {
    if (!Number.isFinite(n)) return 0
    return Math.max(0, Math.min(1000, Math.round(n)))
  }

  const b64 = arrayBufferToBase64(await file.arrayBuffer())
  const mime = file.type || 'image/jpeg'

  const prompt =
    'You are a computer vision coordinate mapper. Locate the target in the image as a tight bounding box.\n' +
    `Target: ${target}\n` +
    'Return STRICT JSON only with this schema (values are integers 0..1000 relative to full image):\n' +
    '{"ymin": number, "xmin": number, "ymax": number, "xmax": number, "confidence": number, "label": string, "notes": string}\n' +
    'If the target is not visible, return a best-effort guess with very low confidence and explain in notes.\n'

  try {
    if (provider === 'gemini' || (!provider && geminiKey)) {
      if (!geminiKey) {
        throw new Error('GEMINI_API_KEY not set')
      }

      const model = process.env.GEMINI_TRACK_MODEL || process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview'
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: prompt },
                { inlineData: { mimeType: mime, data: b64 } }
              ]
            }
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: 'application/json'
          }
        })
      })

      const data: any = await safeParseResponse(resp)
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Gemini request failed')
      }

      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') || ''
      const parsed = jsonFromText(text)
      
      if (!parsed) {
        throw new Error('Failed to parse model response')
      }

      return {
        ymin: clamp(parsed.ymin),
        xmin: clamp(parsed.xmin),
        ymax: clamp(parsed.ymax),
        xmax: clamp(parsed.xmax),
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
        label: typeof parsed.label === 'string' ? parsed.label : target,
        notes: typeof parsed.notes === 'string' ? parsed.notes : undefined
      }
    }

    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not set')
    }

    const model = process.env.OPENAI_TRACK_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini'

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }
            ]
          }
        ]
      })
    })

    const data: any = await safeParseResponse(resp)
    if (!resp.ok) {
      throw new Error(data?.error?.message || 'OpenAI request failed')
    }

    const text = data?.choices?.[0]?.message?.content || ''
    const parsed = jsonFromText(text)
    
    if (!parsed) {
      throw new Error('Failed to parse model response')
    }

    return {
      ymin: clamp(parsed.ymin),
      xmin: clamp(parsed.xmin),
      ymax: clamp(parsed.ymax),
      xmax: clamp(parsed.xmax),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
      label: typeof parsed.label === 'string' ? parsed.label : target,
      notes: typeof parsed.notes === 'string' ? parsed.notes : undefined
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    throw new Error(`Track failed: ${msg}`)
  }
}

const handleStrategy = async (body: any, user: any) => {
  // Defense-in-depth OFFLINE_MODE gate.
  if (process.env.OFFLINE_MODE === '1' || process.env.GEMINI_DRY_RUN === '1') {
    return {
      strategy: '[OFFLINE MODE] Strategy generation is disabled for zero-cost testing.',
      provider: 'offline-mock',
    }
  }

  // Strategy with comprehensive performance analysis
  const { messages, context, sessionId } = body

  if (!messages?.length) {
    throw new Error('Missing messages')
  }

  const geminiKey = readSecretEnv('GEMINI_API_KEY')
  if (!geminiKey) {
    throw new Error('GEMINI_API_KEY not set')
  }

  try {
    const modelName = process.env.GEMINI_STRATEGY_MODEL || 'gemini-3.1-pro-preview'
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(geminiKey)}`
    
    // Pull relevant knowledge from the library for strategy context
    let knowledgeBlock = ''
    try {
      const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop()
      if (lastUserMsg?.content) {
        const knowledgeCtx = await getKnowledgeContext(lastUserMsg.content, 1500)
        if (knowledgeCtx) {
          knowledgeBlock = knowledgeCtx
        }
      }
    } catch (e) {
      logger.warn('Failed to fetch knowledge context for strategy', { error: e instanceof Error ? e.message : String(e) })
    }

    // Pull structured technique knowledge from taxonomy for strategy
    let taxonomyBlock = ''
    try {
      const lastUserMsg = messages.filter((m: any) => m.role === 'user').pop()
      if (lastUserMsg?.content) {
        const discipline = context?.discipline || undefined
        const taxonomyCtx = await taxonomySearch(lastUserMsg.content, discipline)
        if (taxonomyCtx) {
          taxonomyBlock = taxonomyCtx
        }
      }
    } catch (e) {
      logger.warn('Failed to fetch taxonomy context for strategy', { error: e instanceof Error ? e.message : String(e) })
    }

    // Build discipline-specific context for strategy
    const disciplineBlock = context?.discipline && context.discipline !== 'unknown'
      ? '\n' + getDisciplinePrompt(context.discipline)
      : ''
    const disciplineSection = disciplineBlock ? `${disciplineBlock}\n` : ''

    // Coach brain: global rules + sport brain for the selected discipline.
    const coachBrainSection = '\n' + buildCoachBrainBlock({
      selectedSport: context?.discipline,
      fighterFocus: context?.focusTarget,
      poseEngine: context?.poseEvidence?.engine ?? context?.poseEngine,
      poseQuality: context?.poseEvidence?.quality ?? context?.poseQuality,
    }) + '\n'

    // Determine focus
    let focusDescription = 'both fighters'
    if (context?.focusTarget === 'A') focusDescription = 'Fighter A (your corner)'
    else if (context?.focusTarget === 'B') focusDescription = 'Fighter B (opponent)'

    // Build strategy system prompt with grounding
    const strategySystem =
      'You are Musashi, an elite fight strategist. Your lineage traces through Cus D\'Amato, Freddie Roach, and Firas Zahabi.\n' +
      'You build gameplans based on what you ACTUALLY observe in the footage.\n' +
      '\n' +
      'GROUNDING RULES (MANDATORY):\n' +
      '- ONLY reference techniques, tendencies, and events you can ACTUALLY SEE in the video/image.\n' +
      '- ONLY cite kinematics numbers if they are provided in the data below. Never invent measurements.\n' +
      '- If the fighters are mostly using footwork and feints with few exchanges, base your strategy on THAT reality.\n' +
      '- Do not fabricate fight events, timestamps, or statistics.\n' +
      '- If you lack information to fill a field, say "insufficient footage" rather than guessing.\n' +
      '\n' +
      `FOCUS: ${focusDescription}\n` +
      disciplineSection +
      coachBrainSection +
      CONDENSED_FRAMEWORKS

    // Build user prompt with available context
    let prompt = 'Based on the footage provided, build a strategy.\n\n'

    if (knowledgeBlock) {
      prompt += `KNOWLEDGE BASE CONTEXT:\n${knowledgeBlock}\n\n`
    }

    if (taxonomyBlock) {
      prompt += `TECHNIQUE TAXONOMY:\n${taxonomyBlock}\n\n`
    }

    if (context?.kinematics) {
      prompt += `=== MEASURED KINEMATICS (cite ONLY these numbers) ===\n${JSON.stringify(context.kinematics, null, 2)}\n=== END MEASURED KINEMATICS ===\n\n`
    }

    if (context?.analysis) {
      prompt += `PREVIOUS ANALYSIS:\n${JSON.stringify(context.analysis, null, 2)}\n\n`
    }

    // Add conversation history
    prompt += 'CONVERSATION:\n'
    messages.forEach((msg: any) => {
      prompt += `${msg.role}: ${msg.content}\n`
    })

    prompt += '\nReturn a JSON object with these fields (skip or write "insufficient footage" for any field you cannot ground in the actual footage):\n'
    prompt += '- gameplan: string (overall strategic approach based on what you observe)\n'
    prompt += '- counters: array of strings (specific counters to techniques you actually saw)\n'
    prompt += '- weaknesses: array of strings (weaknesses visible in the footage)\n'
    prompt += '- opportunities: array of strings (opportunities visible in the footage)\n'

    // Build parts array
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: prompt }
    ]

    // Add image if present
    if (context?.image) {
      const imageData = context.image
      const base64Data = imageData.split(',')[1] || imageData
      parts.push({
        inlineData: {
          mimeType: "image/jpeg",
          data: base64Data
        }
      })
    }

    // Generate response with system instruction
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: strategySystem }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0.5,
          responseMimeType: 'application/json'
        }
      })
    })
    
    const data: any = await safeParseResponse(resp)
    if (!resp.ok) {
      throw new Error(data?.error?.message || 'Gemini request failed')
    }
    
    const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') || ''
    const strategy = JSON.parse(text)
    return strategy
  } catch (error) {
    console.error('Strategy generation failed:', error)
    throw new Error(`Strategy generation failed: ${String(error)}`)
  }
}

const handleAnalyzeFrames = async (formData: FormData, user: any) => {
  // Defense-in-depth OFFLINE_MODE gate.
  if (process.env.OFFLINE_MODE === '1' || process.env.GEMINI_DRY_RUN === '1') {
    return {
      mocked: true,
      analysis: '[OFFLINE MODE] Multi-frame analysis is disabled for zero-cost testing.',
      provider: 'offline-mock',
    }
  }

  // Multi-frame analysis with temporal kinematics
  const files = formData.getAll('images').filter(f => f instanceof File) as File[]
  const kinRaw = formData.get('kinematics') as string
  const sessionId = formData.get('sessionId') as string

  if (!files.length) {
    throw new Error('Missing images')
  }

  let kinematicsSequence = null
  if (kinRaw) {
    try {
      kinematicsSequence = JSON.parse(kinRaw)
    } catch (e) {
      console.error('Failed to parse kinematics sequence:', e)
    }
  }

  // Store temporal kinematics data (skip when DB not available)
  const dbForFrames = getDbOrNull()
  if (kinematicsSequence && sessionId && dbForFrames) {
    for (const kinematics of kinematicsSequence) {
      await dbForFrames.prepare(`
        INSERT INTO kinematics_snapshots (
          id, session_id, timestamp, frame_number,
          hand_speed_bwps, hand_burst_bwps, foot_speed_bwps, hip_speed_bwps,
          power_index, range_distance_bw, range_closing_bwps, range_state,
          technique_type, technique_confidence, raw_kinematics
        ) VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        crypto.randomUUID(),
        sessionId,
        kinematics.frameNumber || 0,
        kinematics.handSpeedBwps || 0,
        kinematics.handBurstBwps || 0,
        kinematics.footSpeedBwps || 0,
        kinematics.hipSpeedBwps || 0,
        kinematics.powerIndex || 0,
        kinematics.range?.distanceBw || 0,
        kinematics.range?.closingBwps || 0,
        kinematics.range?.band || 'unknown',
        kinematics.technique?.type || null,
        kinematics.technique?.confidence || 0,
        JSON.stringify(kinematics)
      ).run()
    }
  }

  const openaiKey = readSecretEnv('OPENAI_API_KEY')
  const geminiKey = readSecretEnv('GEMINI_API_KEY')
  const provider = (process.env.FIGHT_LLM_PROVIDER || '').toLowerCase()

  if (!openaiKey && !geminiKey) {
    throw new Error('No LLM provider configured. Set OPENAI_API_KEY or GEMINI_API_KEY to enable multi-frame analysis.')
  }

  const arrayBufferToBase64 = (ab: ArrayBuffer): string => {
    const bytes = new Uint8Array(ab)
    let binary = ''
    const chunkSize = 0x8000
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize)
      binary += String.fromCharCode(...chunk)
    }
    return btoa(binary)
  }

  // Convert all images to base64
  const imageData = await Promise.all(
    files.map(async (file) => {
      const b64 = arrayBufferToBase64(await file.arrayBuffer())
      const mime = file.type || 'image/jpeg'
      return { data: b64, mime, name: file.name }
    })
  )

  const system =
    'You are Musashi Fight Coach: elite corner, analyst, and strategist.\n' +
    'Analyze this sequence of frames to understand the fight dynamics.\n' +
    'Focus on: movement patterns, technique progression, tactical evolution.\n' +
    'Synthesize information across all frames for comprehensive analysis.\n'

  const prompt =
    system +
    `Analyzing ${imageData.length} frames.\n` +
    'Return JSON with this schema:\n' +
    '{\n' +
    '  "sequence": {\n' +
    '    "frameCount": number,\n' +
    '    "timeRange": string,\n' +
    '    "tempo": string,\n' +
    '    "intensity": string\n' +
    '  },\n' +
    '  "fighterA": {\n' +
    '    "movementPattern": string,\n' +
    '    "techniqueProgression": array<string>,\n' +
    '    "tacticalEvolution": string,\n' +
    '    "adaptations": array<string>\n' +
    '  },\n' +
    '  "fighterB": {\n' +
    '    "movementPattern": string,\n' +
    '    "techniqueProgression": array<string>,\n' +
    '    "tacticalEvolution": string,\n' +
    '    "adaptations": array<string>\n' +
    '  },\n' +
    '  "exchange": {\n' +
    '    "keyMoments": array<string>,\n' +
    '    "momentumShifts": array<string>,\n' +
    '    "rangeControl": string\n' +
    '  },\n' +
    '  "coaching": {\n' +
    '    "immediate": array<string>,\n' +
    '    "strategic": array<string>,\n' +
    '    "drills": array<string>\n' +
    '  }\n' +
    '}\n' +
    (kinematicsSequence ? `\nKinematics sequence: ${JSON.stringify(kinematicsSequence, null, 2)}\n` : '')

  try {
    if (provider === 'gemini' || (!provider && geminiKey)) {
      if (!geminiKey) {
        throw new Error('GEMINI_API_KEY not set')
      }

      const model = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview'
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(geminiKey)}`

      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: prompt }]
      
      // Add all images
      imageData.forEach((img, index) => {
        parts.push({
          text: `Frame ${index + 1}/${imageData.length}: ${img.name}`
        })
        parts.push({
          inlineData: {
            mimeType: img.mime,
            data: img.data
          }
        })
      })

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            temperature: 0.6,
            responseMimeType: 'application/json'
          }
        })
      })

      const data: any = await safeParseResponse(resp)
      if (!resp.ok) {
        throw new Error(data?.error?.message || 'Gemini request failed')
      }

      const text = data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).filter(Boolean).join('\n') || ''
      const parsed = JSON.parse(text)
      return parsed
    }

    if (!openaiKey) {
      throw new Error('OPENAI_API_KEY not set')
    }

    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

    const content: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: 'text', text: prompt }
    ]
    
    // Add all images
    imageData.forEach((img, index) => {
      content.push({
        type: 'text',
        text: `Frame ${index + 1}/${imageData.length}: ${img.name}`
      })
      content.push({
        type: 'image_url',
        image_url: { url: `data:${img.mime};base64,${img.data}` }
      })
    })

    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openaiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.6,
        messages: [{ role: 'user', content }]
      })
    })

    const data: any = await safeParseResponse(resp)
    if (!resp.ok) {
      throw new Error(data?.error?.message || 'OpenAI request failed')
    }

    const text = data?.choices?.[0]?.message?.content || ''
    const parsed = JSON.parse(text)
    return parsed
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    throw new Error(`Multi-frame analysis failed: ${msg}`)
  }
}

const handlePresets = async (user: any) => {
  // Get system presets
  try {
    const gameplan = await composeSystemPrompt('fight_preset_gameplan', DEFAULT_PROMPTS.fight_preset_gameplan)
    const counters = await composeSystemPrompt('fight_preset_counters', DEFAULT_PROMPTS.fight_preset_counters)
    const corner = await composeSystemPrompt('fight_preset_corner', DEFAULT_PROMPTS.fight_preset_corner)

    return { gameplan, counters, corner }
  } catch (error) {
    console.error('Failed to get presets:', error)
    throw new Error(`Failed to get presets: ${String(error)}`)
  }
}

// Option B: Handle video file upload to Gemini Files API
const handleVideoUpload = async (formData: FormData, user: any) => {
  const videoFile = formData.get('video') as File
  const geminiKey = readSecretEnv('GEMINI_API_KEY')
  
  logger.info('Video upload request', { fileName: videoFile?.name, fileSize: videoFile?.size, hasGeminiKey: !!geminiKey })
  
  if (!videoFile) {
    throw new Error('No video file provided')
  }
  
  if (!geminiKey || geminiKey === 'your-gemini-api-key-here') {
    throw new Error('GEMINI_API_KEY is not configured. Set a valid key in .env.local (get one at https://aistudio.google.com/app/apikey)')
  }
  
  try {
    // Step 1: Initiate file upload
    const fileSize = videoFile.size
    const mimeType = videoFile.type
    const displayName = `fight-video-${Date.now()}`
    
    console.log('[Upload] File size:', fileSize, 'mimeType:', mimeType)
    
    const initResponse = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiKey}`, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': fileSize.toString(),
        'X-Goog-Upload-Header-Content-Type': mimeType,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        file: {
          display_name: displayName
        }
      })
    })
    

    if (!initResponse.ok) {
      const errorText = await initResponse.text()
      console.error('[Upload] Init failed:', initResponse.status, errorText)
      if (errorText.includes('API_KEY_INVALID') || errorText.includes('API key not valid')) {
        throw new Error('Gemini API key is invalid or expired. Update GEMINI_API_KEY in .env.local and restart the dev server.')
      }
      throw new Error(`Failed to initiate file upload: ${initResponse.status} ${errorText}`)
    }
    
    const uploadUrl = initResponse.headers.get('X-Goog-Upload-URL')
    if (!uploadUrl) {
      throw new Error('No upload URL received')
    }
    
    // Step 2: Upload the video file
    const uploadBody = videoFile.stream()
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length': fileSize.toString(),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize'
      },
      // Stream the file instead of buffering it (prevents ArrayBuffer allocation failures)
      body: uploadBody as any,
      // Node/undici requires duplex for streamed request bodies
      duplex: 'half' as any,
    } as any)
    
    if (!uploadResponse.ok) {
      const errorBody = await uploadResponse.text().catch(() => '')
      console.error('[Upload] Upload failed:', uploadResponse.status, errorBody)
      throw new Error(`Failed to upload video file: ${uploadResponse.status} ${errorBody.slice(0, 200)}`)
    }
    
    const uploadData = (await safeParseResponse(uploadResponse)) as { file?: { uri?: string; name?: string; state?: string } }
    console.log('[Upload] Upload response:', JSON.stringify(uploadData, null, 2))
    const fileUri = uploadData.file?.uri
    const fileName = uploadData.file?.name
    
    if (!fileUri) {
      throw new Error('No file URI received')
    }
    
    console.log('[Upload] Success! fileUri:', fileUri)
    
    // Poll for file processing completion (Gemini needs time to process videos)
    if (fileName) {
      let fileState = uploadData.file?.state || 'PROCESSING'
      let attempts = 0
      const maxAttempts = 30 // Max 30 seconds wait
      
      while (fileState === 'PROCESSING' && attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        attempts++
        
        try {
          const statusResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/${fileName}?key=${geminiKey}`
          )
          if (statusResponse.ok) {
            const statusData = (await safeParseResponse(statusResponse)) as { state?: string }
            fileState = statusData.state || 'ACTIVE'
          }
        } catch {
          // Continue polling on error
        }
      }
      
      if (fileState === 'FAILED') {
        throw new Error('Video processing failed on Gemini servers')
      }
    }
    
    return {
      fileUri,
      displayName,
      mimeType,
      fileSize,
      ready: true
    }
    
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error'
    throw new Error(`Video upload failed: ${msg}`)
  }
}

/**
 * COMET-style streaming video analysis.
 * Runs Flash scan → deep analysis, emitting SSE events throughout.
 * Returns a streaming Response (bypasses NextResponse.json wrapper).
 */
const handleAnalyzeVideoStream = (body: any): Response => {
  const { videoFileUri, videoMimeType, clipDuration, focusTarget, poseEvidence, discipline, clipType, poseEngine } = body
  const geminiKey = readSecretEnv('GEMINI_API_KEY')

  const encoder = new TextEncoder()
  const sse = (event: string, data: object) =>
    encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const pipelineStartedAt = Date.now()
        const pipelineBudgetMs = 60000

        if (!geminiKey) {
          controller.enqueue(sse('error', { message: 'GEMINI_API_KEY not configured on the server.' }))
          controller.close()
          return
        }

        if (!videoFileUri) {
          controller.enqueue(sse('error', { message: 'No video file URI provided. Please re-upload the video.' }))
          controller.close()
          return
        }

        // Determine coaching mode
        let coachingMode = 'strategist'
        if (focusTarget === 'blue' || focusTarget === 'A') coachingMode = 'corner_coach'
        else if (focusTarget === 'red' || focusTarget === 'B') coachingMode = 'scout'

        const poseEvidenceText = summarizePoseEvidenceForPrompt(poseEvidence)

        // ── SINGLE PASS: Evidence Ledger (fast, ~10s) ───────────────────────
        controller.enqueue(sse('status', { phase: 'analyzing', message: 'Analyzing...' }))

        const flashModel = process.env.GEMINI_FLASH_MODEL || 'gemini-2.5-flash'
        const flashUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(flashModel)}:generateContent?key=${geminiKey}`

        let factualLedger: FactualLedger | null = null
        try {
          const flashResp = await fetchWithTimeout(flashUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                role: 'user',
                parts: [
                  { fileData: { fileUri: videoFileUri, mimeType: videoMimeType || 'video/mp4' } },
                  { text: buildEvidenceLedgerPrompt({ clipDuration, focusTarget, poseEvidenceText }) }
                ]
              }],
              generationConfig: { temperature: 0.15, responseMimeType: 'application/json' }
            })
          }, 30000)

          if (flashResp.ok) {
            const flashData: any = await flashResp.json()
            const rawText: string = flashData?.candidates?.[0]?.content?.parts?.[0]?.text || ''
            factualLedger = extractJsonObject<FactualLedger>(rawText)
          }
        } catch {
          /* ledger failure is non-fatal */
        }

        factualLedger = mergePoseEvidenceIntoLedger(factualLedger, poseEvidence)

        if (!hasMeaningfulLedgerData(factualLedger)) {
          try {
            const recoveryResp = await fetchWithTimeout(flashUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{
                  role: 'user',
                  parts: [
                    { fileData: { fileUri: videoFileUri, mimeType: videoMimeType || 'video/mp4' } },
                    { text: buildEmergencyLedgerPrompt({ clipDuration, focusTarget, poseEvidenceText }) }
                  ]
                }],
                generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
              })
            }, 20000)

            if (recoveryResp.ok) {
              const recoveryData: any = await recoveryResp.json()
              const rawText: string = recoveryData?.candidates?.[0]?.content?.parts?.[0]?.text || ''
              const recoveredLedger = extractJsonObject<FactualLedger>(rawText)
              if (hasMeaningfulLedgerData(recoveredLedger)) {
                factualLedger = recoveredLedger
              }
            }
          } catch {
            /* emergency ledger failure is non-fatal */
          }
        }

        factualLedger = mergePoseEvidenceIntoLedger(factualLedger, poseEvidence)

        if (!hasMeaningfulLedgerData(factualLedger)) {
          factualLedger = buildMinimalLedgerFromPoseEvidence(poseEvidence)
        }

        // Verification pass: re-watch tape and correct the candidate ledger before coaching + retrieval.
        try {
          const verifyParts: Array<{ fileData?: { fileUri: string; mimeType: string }; text?: string }> = [
            { fileData: { fileUri: videoFileUri, mimeType: videoMimeType || 'video/mp4' } },
            {
              text: buildEvidenceVerificationPrompt(factualLedger, {
                clipDuration,
                poseEvidenceText,
              }),
            },
          ]
          const verifyResp = await fetchWithTimeout(flashUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: verifyParts }],
              generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
            }),
          }, 35000)
          if (verifyResp.ok) {
            const verifyData: any = await verifyResp.json()
            const vraw: string = verifyData?.candidates?.[0]?.content?.parts?.[0]?.text || ''
            const verified = extractJsonObject<FactualLedger>(vraw)
            if (hasMeaningfulLedgerData(verified)) {
              factualLedger = mergePoseEvidenceIntoLedger(verified, poseEvidence)
            }
          }
        } catch {
          /* verification failure is non-fatal */
        }

        controller.enqueue(sse('facts_complete', factualLedger || {}))
        controller.enqueue(sse('scan_complete', factualLedger || {}))

        // ── Video segment ingestion (non-blocking) ──────────────────────────
        const dbForIngestion = getDbOrNull()
        if (dbForIngestion && videoFileUri && typeof clipDuration === 'number' && clipDuration > 0) {
          embedAndStoreSegments({
            db: dbForIngestion,
            userId: 'dev-user',
            sessionId: typeof body?.sessionId === 'string' ? body.sessionId : 'unknown',
            clipId: typeof body?.clipId === 'string' ? body.clipId : videoFileUri,
            fileUri: videoFileUri,
            mimeType: videoMimeType || 'video/mp4',
            totalDurationMs: clipDuration,
          }).catch((e) => {
            console.warn('[fight] segment ingestion failed (non-fatal):', e instanceof Error ? e.message : e)
          })
        }

        // ── Step A: Embed + Retrieve (NO reasoning) ────────────────────────
        const dbForRetrieval = getDbOrNull()
        const retrieved = await retrieveForLedger({
          db: dbForRetrieval,
          userId: 'dev-user',
          ledger: factualLedger,
          userIntent: typeof body?.userMessage === 'string' ? body.userMessage : '',
          topK: 6,
        }).catch(() => ({
          queryText: '',
          queryEmbeddingModel: process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-2-preview',
          topK: 6,
          snippets: [],
        }))

        controller.enqueue(sse('retrieval_complete', retrieved))

        // ── Step B: Reason over ledger + retrieved context ─────────────────
        // Stream from ledger only (text, no video re-read).
        const deepModel =
          process.env.GEMINI_REASON_MODEL ||
          process.env.GEMINI_MODEL ||
          'gemini-3.1-pro-preview'

        const deepPromptText = buildEvidenceBackedCoachingPrompt(factualLedger, {
          coachingMode: coachingMode as 'strategist' | 'corner_coach' | 'scout',
          poseEvidenceText,
        })

        const coachingDirective =
          coachingMode === 'corner_coach'
            ? 'Focus your analysis primarily on Fighter A (blue corner) — identify their technical errors, timing, and what they should fix immediately.'
            : coachingMode === 'scout'
            ? 'Focus your analysis primarily on Fighter B (red corner) — identify their patterns, tendencies, and exploitable habits.'
            : 'Analyze both fighters equally and explain the strategic interplay between their styles.'

        const { tacticalAnchors, hardBans } = buildLedgerTacticalAndBans(factualLedger)

        const textSnippets = (retrieved?.snippets || []).filter((s) => s.namespace !== 'video_segment')
        const videoSnippets = (retrieved?.snippets || []).filter((s) => s.namespace === 'video_segment')

        const textContextLines = textSnippets.length > 0
          ? [
              'RETRIEVED TEXT CONTEXT (supporting only; ledger is source of truth):',
              ...textSnippets.map((s, i) => {
                const title = s.title ? ` — ${s.title}` : ''
                return `(${i + 1}) [${s.namespace}] score=${s.score.toFixed(3)}${title}\n${s.text}`
              }),
            ].join('\n\n')
          : 'RETRIEVED TEXT CONTEXT: (none)'

        const videoContextLines = videoSnippets.length > 0
          ? [
              'VIDEO SEGMENT MATCHES (analogous context -- NOT proof of current clip):',
              ...videoSnippets.map((s, i) => {
                const startSec = typeof s.segmentStartMs === 'number' ? (s.segmentStartMs / 1000).toFixed(1) : '?'
                const endSec = typeof s.segmentEndMs === 'number' ? (s.segmentEndMs / 1000).toFixed(1) : '?'
                const sessionHint = (s.metadata as any)?.sessionId ? `session=${(s.metadata as any).sessionId}, ` : ''
                return `(${i + 1}) [video_segment] ${sessionHint}${startSec}–${endSec}s, score=${s.score.toFixed(3)}\n    displayText: "${s.text}"`
              }),
            ].join('\n\n')
          : ''

        const systemPrompt = [
          MUSASHI_DEEP_ANALYSIS_SYSTEM.trim(),
          `COACHING MODE: ${coachingMode.toUpperCase()}\n${coachingDirective}`,
          // Coach brain: global rules + selected sport brain (alias-aware).
          buildCoachBrainBlock({
            selectedSport: typeof discipline === 'string' ? discipline : undefined,
            clipType: typeof clipType === 'string' ? clipType : undefined,
            fighterFocus: typeof focusTarget === 'string' ? focusTarget : undefined,
            poseEngine: typeof poseEngine === 'string' ? poseEngine : undefined,
          }),
          `ABSOLUTE CONSTRAINTS (violating ANY of these is a critical failure):
- The factual ledger is your ONLY source of truth for what happened.
- Do not add a Quick Scan section.
- Do not mention any strike, kick, knee, clinch, takedown, or exchange unless the factual ledger explicitly lists it.
- If the ledger says something was NOT SEEN, you must not claim it happened. Period.
- If a punch type is unclear, call it "lead-hand punch" or "rear-hand punch" instead of guessing jab/hook/cross.
${tacticalAnchors.join('\n')}
${hardBans.join('\n')}

${textContextLines}

${videoContextLines}

Rules for retrieved context:
- You may use retrieved TEXT context to suggest drills, style comparisons, or reminders.
- You must NOT claim retrieved context events happened in THIS clip unless the factual ledger explicitly supports it.
- If retrieved context conflicts with the ledger, the ledger wins.

Rules for retrieved VIDEO SEGMENTS:
- RETRIEVED VIDEO SEGMENTS are analogous motion patterns from PAST clips.
  They are NOT observations about THIS tape.
  You may cite them for style comparison, drill recall, or pattern analogy.
  You must NOT claim they prove anything happened in the current clip
  unless the FightEvidenceLedger independently confirms it.`,
        ].join('\n\n')

        const modelsToTry = [deepModel, 'gemini-2.5-flash', 'gemini-2.0-flash']
        let deepResp: globalThis.Response | null = null
        let usedModel = deepModel

        for (const modelId of modelsToTry) {
          try {
            const { resp } = await streamReasoning({
              apiKey: geminiKey,
              model: modelId,
              system: systemPrompt,
              userText: deepPromptText,
              temperature: 0.35,
              maxOutputTokens: 4096,
              timeoutMs: 45000,
            })
            deepResp = resp
            usedModel = modelId
            break
          } catch { /* try next model */ }
        }

        if (!deepResp || !deepResp.ok || !deepResp.body) {
          const fallbackText = buildLedgerFallbackReport(factualLedger)
          controller.enqueue(sse('chunk', { text: fallbackText }))
          controller.enqueue(sse('complete', { full_text: fallbackText, model: 'ledger-fallback' }))
          controller.close()
          return
        }

        // Read SSE stream from Gemini and forward chunks to client
        const reader = deepResp.body.getReader()
        const dec = new TextDecoder()
        let buf = ''
        let fullText = ''

        while (true) {
          if (Date.now() - pipelineStartedAt > pipelineBudgetMs) {
            break
          }
          const readResult = await Promise.race([
            reader.read(),
            new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) =>
              setTimeout(() => resolve({ done: true, value: undefined }), 15000)
            ),
          ])
          const { done, value } = readResult
          if (done) break
          buf += dec.decode(value, { stream: true })

          const lines = buf.split('\n')
          buf = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const jsonStr = line.slice(6).trim()
            if (!jsonStr || jsonStr === '[DONE]') continue
            try {
              const chunk = JSON.parse(jsonStr)
              const text: string = (chunk?.candidates?.[0]?.content?.parts ?? [])
                .map((p: any) => p.text ?? '')
                .filter(Boolean)
                .join('')
              if (text) {
                fullText += text
                controller.enqueue(sse('chunk', { text }))
              }
            } catch { /* incomplete JSON chunk */ }
          }
        }

        // Finalize
        if (!fullText.trim()) {
          fullText = buildLedgerFallbackReport(factualLedger)
        }
        fullText = await rewriteCoachingToMatchLedger(fullText, factualLedger, geminiKey, usedModel)

        const dbUpsert = getDbOrNull()
        if (dbUpsert && fullText.trim() && factualLedger) {
          try {
            const userId = typeof body?.userId === 'string' && body.userId ? body.userId : 'dev-user'
            const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : 'unknown'
            const clipKey = typeof body?.clipId === 'string' ? body.clipId : String(videoFileUri).slice(-48)
            const embedModel = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-2-preview'
            const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)

            const ledgerSummaryText = JSON.stringify(factualLedger).slice(0, 8000)
            const ledgerVec = (await embedText(ledgerSummaryText, { taskType: 'RETRIEVAL_DOCUMENT' })) as number[]
            await upsertRetrievalDoc(dbUpsert, {
              id: safeId(`ledger_summary_${userId}_${sessionId}_${clipKey}`),
              userId,
              namespace: 'ledger_summary',
              sessionId,
              clipId: clipKey,
              title: 'Ledger summary',
              text: ledgerSummaryText,
              embedding: ledgerVec,
              embeddingModel: embedModel,
            })

            const coachText = fullText.slice(0, 8000)
            const coachVec = (await embedText(coachText, { taskType: 'RETRIEVAL_DOCUMENT' })) as number[]
            await upsertRetrievalDoc(dbUpsert, {
              id: safeId(`prior_coaching_${userId}_${sessionId}_${clipKey}`),
              userId,
              namespace: 'prior_coaching',
              sessionId,
              clipId: clipKey,
              title: 'Prior coaching',
              text: coachText,
              embedding: coachVec,
              embeddingModel: embedModel,
            })
          } catch {
            /* retrieval upsert is best-effort */
          }
        }

        controller.enqueue(sse('complete', { full_text: fullText, model: usedModel }))
        controller.close()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        try {
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ message: msg })}\n\n`))
          controller.close()
        } catch { /* controller already closed */ }
      }
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'X-Accel-Buffering': 'no',
    }
  })
}

/** Guaranteed JSON error response - prevents empty 500 body that breaks parseApiResponse */
function jsonError(status: number, error: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    { error, details: details ?? {}, timestamp: new Date().toISOString() },
    { status }
  )
}

// Main unified endpoint
export async function POST(req: Request) {
  try {
    // OFFLINE MODE — bypasses every Gemini/fal call in this entire route.
    // Useful for demos and for testing skeleton rendering without API spend.
    if (process.env.GEMINI_DRY_RUN === '1' || process.env.OFFLINE_MODE === '1') {
      return NextResponse.json({
        success: true,
        mocked: true,
        message: '[OFFLINE] fight route short-circuited — no API calls made',
      })
    }

    const contentType = req.headers.get('content-type') || ''

    // Guardrail: prevent OOM from very large multipart bodies before parsing formData()
    // (formData parsing can allocate large ArrayBuffers and crash the dev server)
    if (contentType.includes('multipart/form-data')) {
      const contentLength = Number(req.headers.get('content-length') || '0')
      const maxBytes = Number(process.env.FIGHT_UPLOAD_MAX_BYTES || 200 * 1024 * 1024) // 200MB default
      if (contentLength && contentLength > maxBytes) {
        return NextResponse.json(
          {
            error: 'Video upload too large for current server config. Please upload a shorter clip or increase FIGHT_UPLOAD_MAX_BYTES.',
            maxBytes,
          },
          { status: 413 }
        )
      }
    }

    let action: string
    let body: any = {}
    let formData: FormData | null = null

    // Parse request based on content type (IMPORTANT: only read body once)
    if (contentType.includes('multipart/form-data')) {
      formData = await req.formData()
      action = String(formData.get('action') || '').trim()
    } else {
      try {
        body = await req.json()
      } catch (parseErr) {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
      }
      action = String(body?.action || '').trim()
    }

    if (!action) {
      return NextResponse.json({ error: 'Missing action parameter' }, { status: 400 })
    }

    const quotaBucket = fightActionToQuotaBucket(action)
    const guard = await aiGuard(req, quotaBucket)
    if (!guard.ok) return guard.response

    let user: MusashiUser | null = guard.user
    if (!user && process.env.MUSASHI_DISABLE_AUTH === '1') {
      user = {
        id: 'dev',
        email: 'dev@local',
        display_name: null,
        role: 'shogun',
        emailVerifiedAt: null,
        passwordUpdatedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    }
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    if (fightActionConsumesVideoQuota(action, body)) {
      const videoCtx = extractFightVideoQuotaContext(action, body, formData)
      if (!videoCtx) {
        return aiErrorResponse(new Error('VIDEO_CONTEXT_REQUIRED'))
      }
      try {
        await enforceVideoAnalysis(user.id, user.role, videoCtx)
      } catch (err) {
        return aiErrorResponse(err)
      }
    }

    // Per-clip follow-up question cap (chat/strategy grounded on an uploaded clip).
    const clipQuestionKey = extractChatClipKey(action, body)
    if (clipQuestionKey) {
      try {
        await enforceClipQuestionLimit(user.id, user.role, clipQuestionKey)
      } catch (err) {
        return aiErrorResponse(err)
      }
    }

    // Streaming actions return a Response directly — bypass the JSON wrapper below
    if (action === 'analyze_video_stream') {
      return handleAnalyzeVideoStream(body)
    }

    let result

    // Route to appropriate handler
    switch (action) {
      case 'upload_video':
        if (!formData) throw new Error('FormData required for upload_video')
        result = await handleVideoUpload(formData, user)
        break

      case 'analyze_frame':
        if (!formData) throw new Error('FormData required for analyze_frame')
        result = await handleAnalyzeFrame(formData, user)
        break

      case 'analyze_frames':
        if (!formData) throw new Error('FormData required for analyze_frames')
        result = await handleAnalyzeFrames(formData, user)
        break

      case 'chat':
        result = await handleChat(body, user)
        break

      case 'reflex':
        if (!formData) throw new Error('FormData required for reflex')
        result = await handleReflex(formData, user)
        break

      case 'track':
        if (!formData) throw new Error('FormData required for track')
        result = await handleTrack(formData, user)
        break

      case 'strategy':
        result = await handleStrategy(body, user)
        break

      case 'presets':
        result = await handlePresets(user)
        break

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
    }

    // Track technique performance from analysis results (feedback loop).
    // Only runs when D1 DB is available — skipped silently in local dev.
    try {
      const userId = user.id
      const dbReadyForTracking = Boolean((process.env.DB as unknown as { prepare?: unknown } | undefined)?.prepare)
      if (dbReadyForTracking && result && typeof result === 'object') {
        // Extract detected techniques from analysis results
        const techniques: string[] = []
        if (result.technique) techniques.push(result.technique)
        if (result.fighterA?.techniqueProgression) techniques.push(...result.fighterA.techniqueProgression)
        if (result.fighterB?.techniqueProgression) techniques.push(...result.fighterB.techniqueProgression)
        if (result.candidates) {
          for (const c of result.candidates) {
            if (c.style) techniques.push(c.style)
          }
        }

        for (const tech of techniques) {
          if (tech && typeof tech === 'string') {
            await updateTechniquePerformance(userId, tech.toLowerCase().replace(/\s+/g, '-'), true, {
              powerIndex: result.kinematics?.powerIndex,
              speedBwps: result.kinematics?.handSpeedBwps,
            }).catch((e) => {
              logger.warn('technique perf update failed (non-fatal)', { tech, error: e instanceof Error ? e.message : String(e) })
            })
          }
        }
      }

      // Log activity for all AI interactions
      const activityType = ['analyze_frame', 'analyze_frames'].includes(action) ? 'analyze'
        : action === 'reflex' ? 'reflex'
        : action === 'track' ? 'track'
        : action === 'chat' || action === 'strategy' ? 'chat'
        : null
      if (activityType) {
        await logActivity(activityType, action, body?.sessionId || null, { userId }).catch((e) => {
          logger.warn('activity log failed (non-fatal)', { activityType, error: e instanceof Error ? e.message : String(e) })
        })
      }
    } catch (e) {
      logger.warn('Technique tracking failed (non-fatal)', { error: e instanceof Error ? e.message : String(e) })
    }

    // Add session tracking and real-time updates (skip when DB not available, e.g. local dev)
    const dbForSession = getDbOrNull()
    if (dbForSession && (body?.sessionId || formData?.get('sessionId'))) {
      const sessionId = body?.sessionId || formData?.get('sessionId')
      try {
        await dbForSession.prepare(`
          UPDATE fight_sessions 
          SET updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(sessionId).run()
      } catch (e) {
        logger.warn('Failed to update session timestamp', { error: e instanceof Error ? e.message : String(e) })
      }
    }

    return NextResponse.json(result)

  } catch (e) {
    try {
      const code = e instanceof Error ? e.message : String(e)
      debugLog('POST catch', { code, stack: e instanceof Error ? e.stack : undefined })
      logger.apiError('/api/fight', e instanceof Error ? e : new Error(String(e)), { code })

      if (code === 'UNAUTHORIZED') return jsonError(401, 'Login required')
      if (code === 'FORBIDDEN') return jsonError(403, 'Forbidden')

      return jsonError(500, code, {
        debug: {
          timestamp: new Date().toISOString(),
          errorType: e instanceof Error ? e.constructor.name : 'Unknown'
        }
      })
    } catch (inner) {
      // Fallback: guarantee JSON even if logging/serialization fails
      return jsonError(500, 'Internal server error', {
        original: String(e),
        fallback: true
      })
    }
  }
}

// GET endpoint for session status and real-time data
export async function GET(req: Request) {
  try {
    let user: MusashiUser
    if (process.env.MUSASHI_DISABLE_AUTH === '1') {
      user = {
        id: 'dev',
        email: 'dev@local',
        display_name: null,
        role: 'shogun',
        emailVerifiedAt: null,
        passwordUpdatedAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    } else {
      user = await requireUser(req)
    }
    const { searchParams } = new URL(req.url)
    const sessionId = searchParams.get('sessionId')
    const action = searchParams.get('action')

    if (!sessionId) {
      return NextResponse.json({ error: 'Session ID required' }, { status: 400 })
    }

    const db = getDbOrNull()
    if (!db) {
      // Local dev without D1: return empty data so UI doesn't break
      if (action === 'status') return NextResponse.json({ session: null })
      if (action === 'kinematics') return NextResponse.json({ kinematics: [] })
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
    }

    if (action === 'status') {
      // Get current session status with latest biometrics
      const session = await db.prepare(`
        SELECT 
          fs.*,
          ks.hand_speed_bwps,
          ks.power_index,
          ks.technique_type,
          ks.range_state,
          ks.timestamp as last_kinematics_update
        FROM fight_sessions fs
        LEFT JOIN kinematics_snapshots ks ON fs.id = ks.session_id
        WHERE fs.id = ?
        ORDER BY ks.timestamp DESC
        LIMIT 1
      `).bind(sessionId).first()

      return NextResponse.json({ session })
    }

    if (action === 'kinematics') {
      // Get recent kinematics data for real-time display
      const kinematics = await db.prepare(`
        SELECT 
          hand_speed_bwps,
          hand_burst_bwps,
          foot_speed_bwps,
          hip_speed_bwps,
          power_index,
          range_distance_bw,
          range_closing_bwps,
          range_state,
          technique_type,
          technique_confidence,
          timestamp,
          raw_kinematics
        FROM kinematics_snapshots 
        WHERE session_id = ?
        ORDER BY timestamp DESC
        LIMIT 100
      `).bind(sessionId).all()

      return NextResponse.json({ kinematics: kinematics.results || [] })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })

  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to get session data' }, { status: 500 })
  }
}
