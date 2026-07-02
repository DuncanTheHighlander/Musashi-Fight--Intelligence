import { describe, expect, it } from 'vitest'
import { validateCoachingPayloadAgainstLedger, type CoachingPayload } from './llm-output.validator'
import type { FightEvidenceLedger } from '@/lib/fightlang/fightlang.types'

const emptyLedger: FightEvidenceLedger = {
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

function payloadWith(text: Partial<{ quickCue: string; expanded: string; mainDiagnosis: string; why: string }>): CoachingPayload {
  return {
    mainDiagnosis: text.mainDiagnosis ?? 'A pressures, B counters.',
    styleNotes: [],
    quickCues: [
      {
        id: 'cue-1',
        actorId: 'A',
        t: { startMs: 0, endMs: 1000 },
        quickCue: text.quickCue ?? 'Angle off after the jab',
        expanded: text.expanded,
        evidence: [],
        confidence: { score: 0.8, basis: 'model' },
      },
    ],
    suggestedCorrections: [
      { actorId: 'A', title: 'Fix', why: text.why ?? 'Opens the counter', doInstead: 'Pivot out' },
    ],
    overlayAnnotations: [],
  }
}

describe('unsupported numeric precision softening', () => {
  it('softens exact force/velocity/cm claims when the ledger has no measured kinematics', () => {
    const payload = payloadWith({
      quickCue: 'Your cross generated 4.2 kN of force',
      expanded: 'The hand dropped 15cm and traveled at 13 m/s.',
      mainDiagnosis: 'The rear hand fell 20 centimeters below the chin every exchange.',
    })

    const result = validateCoachingPayloadAgainstLedger({ ledger: emptyLedger, payload })

    expect(result.issues.some((i) => i.code === 'unsupported_numeric_precision')).toBe(true)
    const cue = result.sanitized!.quickCues[0]
    expect(cue.quickCue).not.toContain('kN')
    expect(cue.quickCue).toContain('significant force')
    expect(cue.expanded).not.toContain('15cm')
    expect(cue.expanded).not.toContain('13 m/s')
    expect(cue.expanded).toContain('a clear margin')
    expect(cue.expanded).toContain('high speed')
    expect(result.sanitized!.mainDiagnosis).not.toContain('20 centimeters')
  })

  it('leaves clean coaching text untouched', () => {
    const payload = payloadWith({
      quickCue: 'Pivot 45 degrees off the lead foot after the 2',
      expanded: 'The exit stays on the centerline, so the counter finds you.',
    })

    const result = validateCoachingPayloadAgainstLedger({ ledger: emptyLedger, payload })

    expect(result.ok).toBe(true)
    expect(result.issues).toHaveLength(0)
    // Instructional degrees are allowed — not a measurement claim.
    expect(result.sanitized!.quickCues[0].quickCue).toBe('Pivot 45 degrees off the lead foot after the 2')
  })

  it('keeps the payload JSON shape backward compatible after softening', () => {
    const payload = payloadWith({ quickCue: 'You lost 30 kg of effective mass on that cross' })
    const result = validateCoachingPayloadAgainstLedger({ ledger: emptyLedger, payload })

    const sanitized = result.sanitized!
    expect(Object.keys(sanitized).sort()).toEqual(Object.keys(payload).sort())
    expect(sanitized.quickCues[0]).toMatchObject({ id: 'cue-1', actorId: 'A' })
    // Round-trips through JSON cleanly.
    expect(() => JSON.parse(JSON.stringify(sanitized))).not.toThrow()
  })
})
