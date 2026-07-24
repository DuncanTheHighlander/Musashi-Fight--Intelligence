import { describe, expect, it } from 'vitest'
import {
  formatFighterNamingBlock,
  normalizeFocusTarget,
  resolveFighterNaming,
} from '@/lib/fight/fighterNaming'
import { VISION_EVIDENCE_SCHEMA_VERSION, type VisionEvidence } from '@/lib/evidence/visionEvidence'

function evidence(overrides?: Partial<VisionEvidence>): VisionEvidence {
  return {
    schemaVersion: VISION_EVIDENCE_SCHEMA_VERSION,
    scene: { setting: 'cage', fightAreaVisible: true, visibilityNotes: [], cameraMotion: 'handheld', orientation: 'portrait' },
    people: [
      { id: 'p1', role: 'fighter', description: 'black shorts', screenPosition: 'left', insideFightArea: true, focusCandidate: true, confidence: 0.9 },
      { id: 'p2', role: 'fighter', description: 'white shorts', screenPosition: 'right', insideFightArea: true, focusCandidate: true, confidence: 0.9 },
      { id: 'p3', role: 'referee', description: 'referee', screenPosition: 'center', insideFightArea: true, focusCandidate: false, confidence: 0.9 },
    ],
    fighterAssignment: {
      fighterA_personId: 'p1',
      fighterB_personId: 'p2',
      basis: 'left/right at start',
      confidence: 0.85,
      cornerColors: { A: 'unknown', B: 'unknown' },
    },
    phases: [],
    seen: [],
    heard: [],
    inferred: [],
    uncertain: [],
    coachingWindows: [],
    ...overrides,
  }
}

describe('fighterNaming', () => {
  it('uses Fighter A/B when corner colors are not confirmed', () => {
    const naming = resolveFighterNaming(evidence())
    expect(naming.A.displayName).toBe('Fighter A')
    expect(naming.B.displayName).toBe('Fighter B')
    expect(naming.needsIdentityConfirmation).toBe(false)
  })

  it('uses Blue/Red only when the evidence confirmed corner colors', () => {
    const e = evidence()
    e.fighterAssignment.cornerColors = { A: 'blue', B: 'red' }
    const naming = resolveFighterNaming(e)
    expect(naming.A.displayName).toBe('Blue')
    expect(naming.B.displayName).toBe('Red')
  })

  it('never lets a non-fighter back an identity', () => {
    const e = evidence()
    e.fighterAssignment.fighterA_personId = 'p3' // referee
    const naming = resolveFighterNaming(e)
    expect(naming.A.personId).toBeNull()
    expect(naming.A.displayName).toBe('Fighter A')
    expect(naming.needsIdentityConfirmation).toBe(true)
  })

  it('asks for tap confirmation when assignment confidence is low or missing', () => {
    const low = evidence()
    low.fighterAssignment.confidence = 0.3
    expect(resolveFighterNaming(low).needsIdentityConfirmation).toBe(true)
    expect(resolveFighterNaming(null).needsIdentityConfirmation).toBe(true)

    const missing = evidence()
    missing.fighterAssignment.fighterB_personId = null
    expect(resolveFighterNaming(missing).needsIdentityConfirmation).toBe(true)
  })

  it('normalizes legacy focus vocab and respects confirmed colors', () => {
    expect(normalizeFocusTarget('A')).toBe('A')
    expect(normalizeFocusTarget('blue')).toBe('A') // legacy fixed mapping
    expect(normalizeFocusTarget('red')).toBe('B')
    expect(normalizeFocusTarget('nonsense')).toBe('unsure')

    // Confirmed colors override the legacy fixed order.
    const e = evidence()
    e.fighterAssignment.cornerColors = { A: 'red', B: 'blue' }
    const naming = resolveFighterNaming(e)
    expect(normalizeFocusTarget('blue', naming)).toBe('B')
    expect(normalizeFocusTarget('red', naming)).toBe('A')
  })

  it('prompt block pins names and bans coaching non-fighters', () => {
    const block = formatFighterNamingBlock(resolveFighterNaming(evidence()))
    expect(block).toContain('Fighter A')
    expect(block).toContain('never call them Blue/Red')
    expect(block).toContain('Never coach or address the referee')
  })
})
