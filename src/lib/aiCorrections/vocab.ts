/**
 * Sport vocabularies for Teach Musashi label structuring.
 * Reuses grappling enums; boxing/striking use a compact event list.
 * Free-text labels are allowed but flagged `unlisted: true`.
 */
import {
  GRAPPLING_ACTION_EVENTS,
  GRAPPLING_POSITIONS,
  GRAPPLING_TECHNICAL_FAULTS,
  GRAPPLING_TECHNIQUES,
} from '@/lib/grapplingAnalysisPrompt'
import { resolveSportKey, type SportKey } from '@/lib/coachBrain/coachBrain'

const STRIKING_LABELS = [
  'jab',
  'cross',
  'lead_hook',
  'rear_hook',
  'lead_uppercut',
  'rear_uppercut',
  'teep',
  'lead_kick',
  'rear_kick',
  'guard_drop',
  'guard_low',
  'linear_retreat',
  'circling',
  'ring_cutting',
  'one_beat_entry',
] as const

export type VocabLabel = { value: string; unlisted?: boolean }

export function sportVocabulary(sport?: string | null): string[] {
  const key = resolveSportKey(sport)
  if (key === 'bjj_grappling' || key === 'wrestling' || key === 'judo') {
    return [
      ...GRAPPLING_POSITIONS,
      ...GRAPPLING_ACTION_EVENTS,
      ...GRAPPLING_TECHNICAL_FAULTS,
      ...GRAPPLING_TECHNIQUES.map((t) => t.toLowerCase()),
    ]
  }
  if (key === 'mma') {
    return [
      ...GRAPPLING_POSITIONS,
      ...GRAPPLING_ACTION_EVENTS,
      ...GRAPPLING_TECHNIQUES.map((t) => t.toLowerCase()),
      ...STRIKING_LABELS,
    ]
  }
  return [...STRIKING_LABELS]
}

export function normalizeLabel(raw: string, sport?: string | null): VocabLabel {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
  if (!value) return { value: 'unknown', unlisted: true }
  const vocab = new Set(sportVocabulary(sport).map((v) => v.toLowerCase()))
  if (vocab.has(value)) return { value }
  return { value, unlisted: true }
}

export function isGrapplingSport(sport?: string | null): boolean {
  const key = resolveSportKey(sport) as SportKey | null
  return key === 'bjj_grappling' || key === 'wrestling' || key === 'judo' || key === 'mma'
}
