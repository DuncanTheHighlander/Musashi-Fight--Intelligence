import { describe, expect, it } from 'vitest'
import type { FightEvidenceLedger } from '@/lib/fightlang/fightlang.types'
import { buildSessionEvidence, mergeEvidence, resolveEvidenceMode } from '@/lib/evidence/sessionEvidence'
import { normalizeGrapplingTechnique, sanitizeGrapplingVisionLedger } from '@/lib/grapplingAnalysisPrompt'

const mockLedger = (): FightEvidenceLedger =>
  ({
    contractVersion: '1.0.0',
    generatedAtMs: 0,
    actors: ['A', 'B'],
    geometry: [],
    kinematics: [],
    sequences: [],
    events: [
      {
        id: 'e1',
        kind: 'jab',
        actorId: 'A',
        t: { startMs: 1000, endMs: 1200 },
        label: 'jab',
        confidence: { score: 0.8 },
        evidence: [],
      },
      {
        id: 'e2',
        kind: 'movement',
        actorId: 'A',
        t: { startMs: 2000, endMs: 2500 },
        label: 'circle',
        confidence: { score: 0.7 },
        evidence: [],
      },
    ],
    faults: [
      {
        id: 'f1',
        kind: 'guard_low',
        actorId: 'A',
        t: { startMs: 1000, endMs: 1200 },
        label: 'low',
        confidence: { score: 0.6 },
        evidence: [],
      },
    ],
    patterns: [],
    actorStateTimeline: [],
    evidenceIndex: [],
  }) as unknown as FightEvidenceLedger

describe('mergeEvidence', () => {
  it('strips striking artifacts in grappling mode', () => {
    const merged = mergeEvidence({
      fightLang: mockLedger(),
      visionLedger: {
        video_analysis_ledger: [
          {
            timestamp: '00:05',
            dominant_position: 'half_guard',
            techniques_identified: ['WRIST_RIDE'],
          },
        ],
      },
      provenance: {
        mode: 'grappling',
        sport: 'bjj',
        clipType: 'rolling_grappling',
        videoSeen: true,
        poseEngine: null,
        poseQuality: null,
      },
    })
    expect(merged.coachingLedger.events.some((e) => e.kind === 'jab')).toBe(false)
    expect(merged.coachingLedger.events.some((e) => e.kind === 'movement')).toBe(true)
    expect(merged.visionFacts?.video_analysis_ledger?.[0]?.techniques_identified).toContain('WRIST_RIDE')
  })

  it('keeps FightLang strikes in striking mode', () => {
    const merged = mergeEvidence({
      fightLang: mockLedger(),
      visionLedger: { techniques_observed: ['1.0s - Fighter A jab'] },
      provenance: {
        mode: 'striking',
        sport: 'boxing',
        clipType: 'sparring',
        videoSeen: true,
        poseEngine: 'rtmpose-cloud',
        poseQuality: 'high',
      },
    })
    expect(merged.coachingLedger.events.some((e) => e.kind === 'jab')).toBe(true)
  })
})

describe('buildSessionEvidence', () => {
  it('resolves grappling mode from sport', () => {
    const session = buildSessionEvidence({
      fightLang: mockLedger(),
      visionLedger: null,
      sport: 'bjj',
      clipType: 'rolling_grappling',
      videoSeen: false,
    })
    expect(session.provenance.mode).toBe('grappling')
    expect(session.merged.mergeNotes.length).toBeGreaterThan(0)
  })
})

describe('resolveEvidenceMode', () => {
  it('uses grappling mode for vision-first sports (wrestling / judo / bjj)', () => {
    expect(resolveEvidenceMode({ sport: 'wrestling' })).toBe('grappling')
    expect(resolveEvidenceMode({ sport: 'judo' })).toBe('grappling')
    expect(resolveEvidenceMode({ sport: 'bjj' })).toBe('grappling')
  })

  it('keeps striking mode for boxing and hybrid MMA', () => {
    expect(resolveEvidenceMode({ sport: 'boxing' })).toBe('striking')
    expect(resolveEvidenceMode({ sport: 'mma' })).toBe('striking')
  })
})

describe('grappling technique enum', () => {
  it('normalizes unknown labels to UNKNOWN', () => {
    expect(normalizeGrapplingTechnique('armbar attempt')).toBe('UNKNOWN')
    expect(normalizeGrapplingTechnique('wrist ride')).toBe('WRIST_RIDE')
    expect(normalizeGrapplingTechnique('ARMBAR')).toBe('ARMBAR')
  })

  it('sanitizes hallucinated technique strings in vision ledger', () => {
    const cleaned = sanitizeGrapplingVisionLedger({
      video_analysis_ledger: [
        {
          timestamp: '00:04',
          dominant_position: 'side_control',
          techniques_identified: ['armbar attempt', 'WRIST_RIDE'],
        },
      ],
    })
    expect(cleaned.video_analysis_ledger?.[0]?.techniques_identified).toEqual(['UNKNOWN', 'WRIST_RIDE'])
  })
})
