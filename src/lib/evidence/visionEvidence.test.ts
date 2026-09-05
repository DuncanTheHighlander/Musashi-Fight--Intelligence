import { describe, expect, it } from 'vitest'
import {
  buildVisionEvidencePrompt,
  formatVisionEvidenceBlock,
  hasUsableVisionEvidence,
  sanitizeVisionEvidence,
  VISION_EVIDENCE_RESPONSE_SCHEMA,
  VISION_EVIDENCE_SCHEMA_VERSION,
  type VisionEvidence,
} from '@/lib/evidence/visionEvidence'

function baseEvidence(overrides?: Partial<VisionEvidence>): VisionEvidence {
  return {
    schemaVersion: VISION_EVIDENCE_SCHEMA_VERSION,
    scene: {
      setting: 'cage',
      fightAreaVisible: true,
      visibilityNotes: [],
      cameraMotion: 'handheld',
      orientation: 'portrait',
    },
    people: [
      { id: 'p1', role: 'fighter', description: 'black shorts', screenPosition: 'left', insideFightArea: true, focusCandidate: true, confidence: 0.9 },
      { id: 'p2', role: 'fighter', description: 'white shorts', screenPosition: 'right', insideFightArea: true, focusCandidate: true, confidence: 0.9 },
      { id: 'p3', role: 'spectator', description: 'foreground spectator', screenPosition: 'foreground', insideFightArea: false, focusCandidate: false, confidence: 0.8 },
      { id: 'p4', role: 'referee', description: 'ref in gloves', screenPosition: 'center', insideFightArea: true, focusCandidate: false, confidence: 0.85 },
    ],
    fighterAssignment: {
      fighterA_personId: 'p1',
      fighterB_personId: 'p2',
      basis: 'A left at start',
      confidence: 0.8,
      cornerColors: { A: 'unknown', B: 'unknown' },
    },
    phases: [{ startSec: 0, endSec: 10, label: 'fence clinch' }],
    seen: [{ startSec: 2, endSec: 4, personIds: ['p1'], observation: 'p1 pressures p2 to the fence', confidence: 0.9 }],
    heard: [{ tSec: 3, kind: 'coach_instruction', transcript: 'throw a knee', attribution: 'corner', confidence: 0.7 }],
    inferred: [{ inference: 'p1 is the pressure fighter', basis: 'seen 2-4s', confidence: 0.7 }],
    uncertain: ['grip on the fence exchange is occluded'],
    coachingWindows: [{ startSec: 2, endSec: 6, reason: 'fence exchange' }],
    ...overrides,
  }
}

describe('visionEvidence', () => {
  it('never lets a referee, spectator, or cameraman be a focus candidate', () => {
    const dirty = baseEvidence()
    dirty.people[2] = { ...dirty.people[2], focusCandidate: true } // spectator claims focus
    dirty.people[3] = { ...dirty.people[3], focusCandidate: true } // referee claims focus
    const clean = sanitizeVisionEvidence(dirty)
    expect(clean.people.find((p) => p.id === 'p3')?.focusCandidate).toBe(false)
    expect(clean.people.find((p) => p.id === 'p4')?.focusCandidate).toBe(false)
    expect(clean.people.find((p) => p.id === 'p1')?.focusCandidate).toBe(true)
  })

  it('rejects fighter A/B assignments that point at non-fighters', () => {
    const dirty = baseEvidence()
    dirty.fighterAssignment = {
      ...dirty.fighterAssignment,
      fighterA_personId: 'p3', // spectator
      fighterB_personId: 'p2',
    }
    const clean = sanitizeVisionEvidence(dirty)
    expect(clean.fighterAssignment.fighterA_personId).toBeNull()
    expect(clean.fighterAssignment.fighterB_personId).toBe('p2')
  })

  it('clamps confidences and normalizes corner colors', () => {
    const dirty = baseEvidence()
    dirty.seen[0] = { ...dirty.seen[0], confidence: 7 }
    ;(dirty.fighterAssignment.cornerColors as { A: string }).A = 'green'
    const clean = sanitizeVisionEvidence(dirty)
    expect(clean.seen[0].confidence).toBe(1)
    expect(clean.fighterAssignment.cornerColors.A).toBe('unknown')
  })

  it('keeps SEEN and HEARD separate in the coaching block and states the audio rule', () => {
    const block = formatVisionEvidenceBlock(baseEvidence())
    expect(block).toContain('"heard"')
    expect(block).toContain('never proof the action happened')
    expect(block).toContain('throw a knee')
    // Coach-only-fighters rule travels with the evidence.
    expect(block).toContain('role is "fighter"')
  })

  it('prompt enforces evidence-class separation and anti-hallucination rules', () => {
    const prompt = buildVisionEvidencePrompt({ sport: 'mma', clipType: 'sparring', focusTarget: 'A', clipDurationSec: 30 })
    expect(prompt).toContain('NEVER evidence a knee was thrown')
    expect(prompt).toContain('NEVER invent hidden grips')
    expect(prompt).toContain('focusCandidate=true ONLY for the actual competing fighters')
    expect(prompt).toContain(VISION_EVIDENCE_SCHEMA_VERSION)
  })

  it('usability check requires people or seen entries', () => {
    expect(hasUsableVisionEvidence(null)).toBe(false)
    expect(hasUsableVisionEvidence(baseEvidence())).toBe(true)
    expect(hasUsableVisionEvidence(baseEvidence({ people: [], seen: [] }))).toBe(false)
  })

  it('response schema requires every evidence class', () => {
    expect(VISION_EVIDENCE_RESPONSE_SCHEMA.required).toEqual(
      expect.arrayContaining(['seen', 'heard', 'inferred', 'uncertain', 'people', 'fighterAssignment']),
    )
  })
})
