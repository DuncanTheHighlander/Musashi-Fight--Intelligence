import type { FightEvidenceLedger, FightLangFrameEvidence } from '@/lib/fightlang/ledger'
import { COMPROMISED_BASE_THRESHOLD } from '@/lib/geometry/fightMetrics'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import {
  computeCompromisedBaseScore,
  computeStanceWidth,
  computeTorsoAngle,
  isCompromisedBase,
} from '@/lib/geometry/fightMetrics'

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)))
  return sorted[idx] ?? null
}

function rate(values: Array<boolean | null>): number | null {
  const clean = values.filter((v): v is boolean => typeof v === 'boolean')
  if (!clean.length) return null
  const trues = clean.filter(Boolean).length
  return trues / clean.length
}

export function createEmptyLedger(): FightEvidenceLedger {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    constants: {
      compromisedBaseThresholdSw: COMPROMISED_BASE_THRESHOLD,
    },
    recentFrames: [],
    aggregates: {
      A: null,
      B: null,
    },
  }
}

export function ingestFrameEvidence(
  ledger: FightEvidenceLedger,
  frame: FightLangFrameEvidence,
  options?: { maxRecent?: number }
): FightEvidenceLedger {
  const maxRecent = options?.maxRecent ?? 90
  const recentFrames = [...ledger.recentFrames, frame].slice(-maxRecent)

  const collect = (id: 'A' | 'B') => {
    const fighterFrames = recentFrames
      .map((f) => f.fighters[id])
      .filter((v): v is NonNullable<typeof v> => Boolean(v))
    if (!fighterFrames.length) return null

    const torsoAngles = fighterFrames.map((f) => f.torsoAngleDeg).filter((v): v is number => typeof v === 'number')
    const stanceWidths = fighterFrames.map((f) => f.stanceWidthSw).filter((v): v is number => typeof v === 'number')
    const compromised = fighterFrames.map((f) => f.compromisedBase)

    return {
      torsoAngleDegP50: percentile(torsoAngles, 0.5),
      stanceWidthSwP50: percentile(stanceWidths, 0.5),
      compromisedBaseRate: rate(compromised),
    }
  }

  return {
    ...ledger,
    generatedAt: new Date().toISOString(),
    recentFrames,
    aggregates: {
      A: collect('A'),
      B: collect('B'),
    },
  }
}

export function buildFightLangFrameEvidence(input: {
  tMs: number
  videoTimeSec: number | null
  A: NormalizedLandmark[] | null
  B: NormalizedLandmark[] | null
}): FightLangFrameEvidence {
  const mk = (lms: NormalizedLandmark[] | null) => {
    if (!lms) return null
    const torsoAngleDeg = computeTorsoAngle(lms)
    const stanceWidthSw = computeStanceWidth(lms)
    const compromisedBaseScoreSw = computeCompromisedBaseScore(lms)
    const compromisedBase = isCompromisedBase(lms)
    return { torsoAngleDeg, stanceWidthSw, compromisedBaseScoreSw, compromisedBase }
  }

  return {
    tMs: input.tMs,
    videoTimeSec: input.videoTimeSec,
    fighters: {
      A: mk(input.A),
      B: mk(input.B),
    },
  }
}

