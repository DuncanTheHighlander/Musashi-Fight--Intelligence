import { describe, expect, it } from 'vitest'
import { applyCoachingFocus, buildGroundedCoachingPrompt } from './gemini-client'
import type { FightEvidenceLedger } from '@/lib/fightlang/fightlang.types'
import type { CoachingPayload } from '@/lib/validators/llm-output.validator'

const ledger: FightEvidenceLedger = {
  contractVersion: '1.0.0',
  generatedAtMs: 0,
  clip: { durationMs: 12_000 },
  actors: ['A', 'B'],
  geometry: [],
  kinematics: [],
  actorStateTimeline: [],
  events: [],
  faults: [],
  patterns: [],
  sequences: [],
  evidenceIndex: [],
}

describe('buildGroundedCoachingPrompt', () => {
  it('makes blue-corner focus an actor-A-only coaching contract', () => {
    const prompt = buildGroundedCoachingPrompt({
      ledger,
      retrievedSnippets: [],
      focusTarget: 'A',
    })

    expect(prompt).toContain('FOCUS TARGET: Fighter A / blue corner')
    expect(prompt).toContain('quickCues MUST use actorId "A"')
    expect(prompt).toContain('suggestedCorrections MUST use actorId "A"')
    expect(prompt).toContain('overlayAnnotations MUST use actorId "A"')
  })

  it('makes red-corner focus an actor-B-only coaching contract', () => {
    const prompt = buildGroundedCoachingPrompt({
      ledger,
      retrievedSnippets: [],
      focusTarget: 'B',
    })

    expect(prompt).toContain('FOCUS TARGET: Fighter B / red corner')
    expect(prompt).toContain('quickCues MUST use actorId "B"')
    expect(prompt).toContain('suggestedCorrections MUST use actorId "B"')
    expect(prompt).toContain('overlayAnnotations MUST use actorId "B"')
  })

  it('keeps both-fighter focus balanced when no single actor is selected', () => {
    const prompt = buildGroundedCoachingPrompt({
      ledger,
      retrievedSnippets: [],
      focusTarget: 'both',
    })

    expect(prompt).toContain('FOCUS TARGET: both fighters')
    expect(prompt).toContain('Return the most important cues across A and B')
  })

  it('includes the elite coach source influence library without changing the JSON contract', () => {
    const prompt = buildGroundedCoachingPrompt({
      ledger,
      retrievedSnippets: [],
      focusTarget: 'A',
    })

    expect(prompt).toContain('SOURCE INFLUENCE LIBRARY')
    expect(prompt).toContain('Do not copy any creator')
    expect(prompt).toContain('tactical pattern recognition')
    expect(prompt).toContain('systems thinking')
    expect(prompt).toContain('turning corrections into drills')
    expect(prompt).toContain('OUTPUT JSON SCHEMA (exact keys):')
    expect(prompt).toContain('"quickCues"')
    expect(prompt).toContain('"mainDiagnosis"')
    expect(prompt).toContain('"styleNotes"')
    expect(prompt).toContain('"suggestedCorrections"')
    expect(prompt).toContain('"overlayAnnotations"')
    expect(prompt).toContain('"audioScript"')
  })

  it('injects the sport brain, global rules, and ledger for a selected sport', () => {
    const prompt = buildGroundedCoachingPrompt({
      ledger,
      retrievedSnippets: [],
      focusTarget: 'A',
      coachBrain: { selectedSport: 'bjj', clipType: 'sparring', userQuestion: 'How do I stop getting passed?' },
    })

    expect(prompt).toContain('MUSASHI COACH BRAIN')
    expect(prompt).toContain('SPORT BRAIN (bjj_grappling)')
    expect(prompt).toContain('# BJJ / Grappling Coaching Brain')
    expect(prompt).toContain('Musashi Evidence Rules')
    expect(prompt).toContain('Musashi Uncertainty Rules')
    expect(prompt).toContain('Current FightEvidenceLedger')
    expect(prompt).toContain('Clip type: sparring')
    expect(prompt).toContain('User question: How do I stop getting passed?')
  })

  it('includes poseEngine and poseQuality metadata with caution language', () => {
    const prompt = buildGroundedCoachingPrompt({
      ledger,
      retrievedSnippets: [],
      focusTarget: 'both',
      coachBrain: { selectedSport: 'mma', poseEngine: 'mediapipe', poseQuality: 0.3 },
    })

    expect(prompt).toContain('RTMPose (cloud) is the PRIMARY pose engine')
    expect(prompt).toContain('MediaPipe fallback engine')
    expect(prompt).toContain('poseQuality: low')
    expect(prompt).toContain('POSE QUALITY IS LOW')
  })

  it('falls back to global coach rules when no sport is selected, without breaking the JSON contract', () => {
    const prompt = buildGroundedCoachingPrompt({
      ledger,
      retrievedSnippets: [],
      focusTarget: 'A',
    })

    expect(prompt).toContain('not specified — using global coach rules only')
    expect(prompt).not.toContain('SPORT BRAIN (')
    expect(prompt).toContain('Musashi Global Coach Style')
    expect(prompt).toContain('OUTPUT JSON SCHEMA (exact keys):')
  })

  it('routes sport aliases inside the prompt (tkd → taekwondo)', () => {
    const prompt = buildGroundedCoachingPrompt({
      ledger,
      retrievedSnippets: [],
      coachBrain: { selectedSport: 'tkd' },
    })
    expect(prompt).toContain('SPORT BRAIN (taekwondo)')
    expect(prompt).toContain('# Taekwondo Coaching Brain')
  })

  it('maps the 3-adjustment coaching structure into existing JSON fields', () => {
    const prompt = buildGroundedCoachingPrompt({
      ledger,
      retrievedSnippets: [],
      focusTarget: 'A',
    })

    expect(prompt).toContain('Use this higher-level structure inside the existing JSON')
    expect(prompt).toContain('mainDiagnosis = Coach')
    expect(prompt).toContain('quickCues = exactly 3 short corner commands')
    expect(prompt).toContain('suggestedCorrections = exactly 3 detailed adjustments')
    expect(prompt).toContain('Adjustment 1 - Technical adjustment')
    expect(prompt).toContain('Adjustment 2 - Tactical adjustment')
    expect(prompt).toContain('Adjustment 3 - Training/habit adjustment')
    expect(prompt).toContain('Do not structure the response as Moment 1 / Moment 2 / Moment 3')
  })
})

describe('applyCoachingFocus', () => {
  const payload: CoachingPayload = {
    mainDiagnosis: 'A is giving ground; B is pressing.',
    styleNotes: ['pressure vs counter'],
    quickCues: [
      {
        id: 'cue-a',
        actorId: 'A',
        t: { startMs: 0, endMs: 1000 },
        quickCue: 'Angle off after jab',
        evidence: [],
        confidence: { score: 0.8, basis: 'model' },
      },
      {
        id: 'cue-b',
        actorId: 'B',
        t: { startMs: 0, endMs: 1000 },
        quickCue: 'Do not overreach',
        evidence: [],
        confidence: { score: 0.7, basis: 'model' },
      },
    ],
    suggestedCorrections: [
      { actorId: 'A', title: 'A fix', why: 'A why', doInstead: 'A do' },
      { actorId: 'B', title: 'B fix', why: 'B why', doInstead: 'B do' },
    ],
    overlayAnnotations: [
      {
        id: 'overlay-a',
        actorId: 'A',
        time: { startMs: 0, endMs: 1000 },
        annotationType: 'label',
        anchorPoints: [{ kind: 'bbox_center', actorId: 'A' }],
        message: 'Angle exit',
        confidence: { score: 0.8, basis: 'model' },
        evidence: [],
      },
      {
        id: 'overlay-b',
        actorId: 'B',
        time: { startMs: 0, endMs: 1000 },
        annotationType: 'label',
        anchorPoints: [{ kind: 'bbox_center', actorId: 'B' }],
        message: 'Overreach',
        confidence: { score: 0.8, basis: 'model' },
        evidence: [],
      },
    ],
  }

  it('keeps only actor-A coaching when blue corner is focused', () => {
    const focused = applyCoachingFocus(payload, 'A')

    expect(focused.quickCues.map((c) => c.actorId)).toEqual(['A'])
    expect(focused.suggestedCorrections.map((c) => c.actorId)).toEqual(['A'])
    expect(focused.overlayAnnotations.map((a) => a.actorId)).toEqual(['A'])
    expect(focused.mainDiagnosis).toBe(payload.mainDiagnosis)
  })

  it('leaves both-fighter coaching unchanged when both is focused', () => {
    const focused = applyCoachingFocus(payload, 'both')

    expect(focused.quickCues).toHaveLength(2)
    expect(focused.suggestedCorrections).toHaveLength(2)
    expect(focused.overlayAnnotations).toHaveLength(2)
  })
})
