/**
 * Coach Brain — sport-specific coaching knowledge for the final Gemini call.
 *
 * The markdown under coach-brain/ (repo root) is the source of truth:
 *   coach-brain/global_coach_style.md   — voice + cause-and-effect structure
 *   coach-brain/output_rules.md         — required response components
 *   coach-brain/evidence_rules.md       — evidence stack + numeric precision rules
 *   coach-brain/uncertainty_rules.md    — occlusion / poseQuality / mismatch caution
 *   coach-brain/sports/<sport>.md       — per-sport tactical brain
 *
 * This module routes a user sport selection (with aliases) to the right brain
 * and assembles a prompt block that is APPENDED to the existing Gemini
 * coaching prompts. It never replaces the video + FightLang ledger flow.
 *
 * Mapping documented in coach-brain/sport_router.md — keep in sync.
 */
import { COACH_BRAIN_FILES } from './brains.generated'

export const SPORT_KEYS = [
  'boxing',
  'kickboxing_muay_thai',
  'karate',
  'taekwondo',
  'wrestling',
  'judo',
  'bjj_grappling',
  'fencing',
  'mma',
] as const

export type SportKey = (typeof SPORT_KEYS)[number]

const SPORT_ALIASES: Record<string, SportKey> = {
  boxing: 'boxing',
  kickboxing: 'kickboxing_muay_thai',
  muay_thai: 'kickboxing_muay_thai',
  kickboxing_muay_thai: 'kickboxing_muay_thai',
  karate: 'karate',
  taekwondo: 'taekwondo',
  tkd: 'taekwondo',
  wrestling: 'wrestling',
  judo: 'judo',
  bjj: 'bjj_grappling',
  jiu_jitsu: 'bjj_grappling',
  bjj_grappling: 'bjj_grappling',
  grappling: 'bjj_grappling',
  fencing: 'fencing',
  mma: 'mma',
}

/** Case-insensitive alias resolution; spaces/hyphens normalize to underscores. */
export function resolveSportKey(input?: string | null): SportKey | null {
  if (!input) return null
  const norm = String(input).trim().toLowerCase().replace(/[\s-]+/g, '_')
  return SPORT_ALIASES[norm] ?? null
}

export function getCoachBrainFile(path: string): string | null {
  return COACH_BRAIN_FILES[path] ?? null
}

/** Sport brain markdown for a user selection (alias-aware). Null when unknown. */
export function getSportBrain(input?: string | null): { key: SportKey; markdown: string } | null {
  const key = resolveSportKey(input)
  if (!key) return null
  const markdown = getCoachBrainFile(`sports/${key}.md`)
  if (!markdown) return null
  return { key, markdown }
}

/** The four global rule files, concatenated. Always injected — this is the fallback when no sport matches. */
export function getGlobalCoachRules(): string {
  return ['global_coach_style.md', 'output_rules.md', 'evidence_rules.md', 'uncertainty_rules.md']
    .map((f) => getCoachBrainFile(f))
    .filter(Boolean)
    .join('\n\n---\n\n')
}

export type CoachBrainContext = Readonly<{
  selectedSport?: string | null
  clipType?: string | null
  fighterFocus?: string | null
  userQuestion?: string | null
  /** Pose engine that fed the ledger: 'rtmpose' (cloud, primary) or 'mediapipe' (preview/fallback). */
  poseEngine?: string | null
  /** 0..1 score or 'low' | 'medium' | 'high'. */
  poseQuality?: number | string | null
}>

function normalizePoseQuality(q?: number | string | null): 'low' | 'medium' | 'high' | null {
  if (q == null) return null
  if (typeof q === 'number') {
    if (!Number.isFinite(q)) return null
    return q < 0.5 ? 'low' : q < 0.75 ? 'medium' : 'high'
  }
  const s = q.trim().toLowerCase()
  return s === 'low' || s === 'medium' || s === 'high' ? s : null
}

function buildPoseEvidenceLines(ctx: CoachBrainContext): string[] {
  const lines: string[] = [
    'POSE EVIDENCE SOURCE:',
    '- RTMPose (cloud) is the PRIMARY pose engine for uploaded/premium analysis. MediaPipe is the preview, free/basic, and fallback engine.',
    '- Whichever engine fed the FightLang ledger is the primary pose evidence for THIS clip. Judge by poseQuality, not engine name.',
  ]

  const engine = ctx.poseEngine?.trim().toLowerCase()
  if (engine) {
    if (engine.includes('mediapipe')) {
      lines.push(
        `- This clip's ledger was built from the MediaPipe fallback engine. Mention lower confidence where a claim depends on fine pose detail (joint angles, small guard shifts).`
      )
    } else {
      lines.push(`- This clip's ledger was built from the ${engine} engine.`)
    }
  }

  const quality = normalizePoseQuality(ctx.poseQuality)
  if (quality) {
    lines.push(`- poseQuality: ${quality}.`)
    if (quality === 'low') {
      lines.push(
        '- POSE QUALITY IS LOW: use cautious wording throughout ("appears", "the tracking suggests"). Do not build strong claims on fine pose detail; prefer broad positional reads.'
      )
    }
  }

  return lines
}

/**
 * Assembles the coach-brain prompt block appended to the Gemini coaching
 * prompt. Always contains the global rules; adds the sport brain when the
 * selected sport resolves, otherwise states the global-only fallback.
 */
export function buildCoachBrainBlock(ctx: CoachBrainContext = {}): string {
  const brain = getSportBrain(ctx.selectedSport)

  const contextLines: string[] = []
  if (ctx.selectedSport) {
    contextLines.push(
      brain
        ? `Selected sport: ${ctx.selectedSport} → ${brain.key}`
        : `Selected sport: ${ctx.selectedSport} (no dedicated sport brain — using global coach rules only). If the video clearly shows a different sport than selected, warn briefly and coach the most likely sport cautiously.`
    )
  } else {
    contextLines.push('Selected sport: not specified — using global coach rules only.')
  }
  if (ctx.clipType) contextLines.push(`Clip type: ${ctx.clipType}`)
  if (ctx.fighterFocus) contextLines.push(`Fighter focus: ${ctx.fighterFocus}`)
  if (ctx.userQuestion) contextLines.push(`User question: ${ctx.userQuestion}`)

  const sections: string[] = [
    'MUSASHI COACH BRAIN (sport-specific coaching knowledge — apply it on top of the evidence contract, never against it):',
    contextLines.join('\n'),
    buildPoseEvidenceLines(ctx).join('\n'),
    `GLOBAL COACH RULES:\n${getGlobalCoachRules()}`,
  ]

  if (brain) {
    sections.push(`SPORT BRAIN (${brain.key}):\n${brain.markdown}`)
    sections.push(
      'If the selected sport and what the video shows clearly conflict, say so briefly and coach the most likely sport cautiously.'
    )
  }

  return sections.join('\n\n')
}
