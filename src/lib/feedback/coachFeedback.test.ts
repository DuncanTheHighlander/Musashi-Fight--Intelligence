import { describe, expect, it } from 'vitest'
import type { CoachingPayload } from '@/lib/validators/llm-output.validator'
import {
  buildCoachFeedbackView,
  coachingPayloadToProse,
  describeMoment,
  extractConfidenceNote,
  formatHumanTimes,
  looksLikeCoachingJson,
  sanitizeCoachText,
} from './coachFeedback'

const payload: CoachingPayload = {
  mainDiagnosis:
    'You are landing the 1-2 but exiting with the rear hand low, which leaves the counter lane open after every entry. Footwork feedback is limited because the feet are partially cut off in the clip.',
  styleNotes: [],
  quickCues: [
    {
      id: 'cue-1',
      actorId: 'A',
      t: { startMs: 0, endMs: 800 },
      quickCue: 'Recover first.',
      keyMistake: 'Rear hand drops on the exit',
      evidence: [],
      confidence: { score: 0.8, basis: 'model' },
    },
    {
      id: 'cue-2',
      actorId: 'A',
      t: { startMs: 4200, endMs: 5000 },
      quickCue: 'Pivot, don\u2019t back up.',
      evidence: [],
      confidence: { score: 0.7, basis: 'model' },
    },
  ],
  suggestedCorrections: [
    {
      actorId: 'A',
      title: 'Adjustment 1 - Recover your hand before exiting',
      why: 'When you exit with the hand low, the counter lane stays open.',
      doInstead: 'Finish the punch, recover the hand, then step or pivot out.',
    },
    {
      actorId: 'A',
      title: 'Adjustment 2 - Exit on an angle',
      why: 'Straight-back exits keep you on the opponent\u2019s attack line.',
      doInstead: 'After the cross, pivot off the lead foot instead of stepping straight back.',
    },
    {
      actorId: 'A',
      title: 'Adjustment 3 - Rear-hand recovery drill',
      why: 'The low-hand exit is a habit, so it needs reps, not reminders.',
      doInstead:
        'Jab-cross, bring the rear hand back to your chin, pivot off the lead foot, and finish in stance. Start slow, add a partner walking forward once the movement feels clean.',
    },
  ],
  overlayAnnotations: [],
}

describe('buildCoachFeedbackView', () => {
  it('maps the payload to Coach\u2019s Read, 3 fixes, drill, cues, and confidence note', () => {
    const view = buildCoachFeedbackView(payload, { clipDurationMs: 10_000 })

    expect(view.coachRead).toContain('landing the 1-2')
    expect(view.coachRead).not.toMatch(/feet are partially cut off/i)
    expect(view.confidenceNote).toMatch(/feet are partially cut off/i)

    expect(view.fixes).toHaveLength(3)
    expect(view.fixes[0].title).toBe('Recover your hand before exiting')
    expect(view.fixes[0].title).not.toMatch(/adjustment/i)
    expect(view.fixes[0].body).toContain('counter lane stays open')
    expect(view.fixes[0].body).toContain('recover the hand')

    expect(view.drill).not.toBeNull()
    expect(view.drill?.body).toContain('pivot off the lead foot')

    expect(view.quickCues).toEqual(['Recover first.', 'Pivot, don\u2019t back up.'])
  })

  it('uses moment language for 0ms timestamps and real times otherwise', () => {
    const view = buildCoachFeedbackView(payload, { clipDurationMs: 10_000 })
    expect(view.evidence[0].when).toBe('Early in the exchange')
    expect(view.evidence[1].when).toBe('Around 0:04')
  })
})

describe('describeMoment', () => {
  it('never renders a fake 0:00', () => {
    expect(describeMoment(0, 10_000, 0)).toBe('Early in the exchange')
    expect(describeMoment(undefined, null, 1)).toBe('As the exchange develops')
    expect(describeMoment(7000, 10_000, 0)).toBe('Around 0:07')
  })

  it('rejects timestamps beyond the clip', () => {
    expect(describeMoment(20_000, 10_000, 0)).toBe('Early in the exchange')
  })
})

describe('extractConfidenceNote', () => {
  it('returns no note for clean reads', () => {
    const r = extractConfidenceNote('A pressures behind the jab. B circles but never changes levels.')
    expect(r.note).toBeNull()
  })
})

describe('coachingPayloadToProse', () => {
  it('renders clean sections with no JSON artifacts or field names', () => {
    const prose = coachingPayloadToProse(payload)
    expect(prose).toContain("Coach's Read")
    expect(prose).toContain('3 Things to Fix')
    expect(prose).toContain('Quick Cues')
    expect(prose).toContain('Confidence note:')
    expect(prose).not.toMatch(/[{}]/)
    expect(prose).not.toMatch(/mainDiagnosis|suggestedCorrections|quickCues"|overlayAnnotations|audioScript|actorId/)
  })
})

describe('sanitizeCoachText', () => {
  it('passes normal coaching prose through untouched', () => {
    const prose = 'Strong entry, weak exit. Pivot off the lead foot after the cross.'
    expect(sanitizeCoachText(prose)).toBe(prose)
  })

  it('converts a leaked JSON payload into clean coaching text', () => {
    const leaked = JSON.stringify(payload)
    const out = sanitizeCoachText(leaked)
    expect(out).toContain("Coach's Read")
    expect(out).toContain('Recover your hand before exiting')
    expect(out).not.toMatch(/[{}[\]]/)
    expect(out).not.toMatch(/mainDiagnosis|overlayAnnotations|audioScript/)
  })

  it('converts a fenced JSON block and keeps surrounding prose', () => {
    const mixed = `Here is your gameplan:\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``
    const out = sanitizeCoachText(mixed)
    expect(out).toContain('Here is your gameplan:')
    expect(out).toContain('3 Things to Fix')
    expect(out).not.toContain('```')
    expect(out).not.toMatch(/"mainDiagnosis"/)
  })

  it('recovers readable text from truncated JSON instead of showing braces', () => {
    const truncated = JSON.stringify(payload).slice(0, 320)
    const out = sanitizeCoachText(truncated)
    expect(out).not.toMatch(/[{}]/)
    expect(out).not.toMatch(/"mainDiagnosis"/)
  })

  it('returns empty string for undefined or blank input', () => {
    expect(sanitizeCoachText(undefined as unknown as string)).toBe('')
    expect(sanitizeCoachText('   ')).toBe('')
  })
})

describe('looksLikeCoachingJson', () => {
  it('only flags text containing contract keys', () => {
    expect(looksLikeCoachingJson('{"foo": 1}')).toBe(false)
    expect(looksLikeCoachingJson('{"mainDiagnosis": "x"}')).toBe(true)
    expect(looksLikeCoachingJson('keep your mainDiagnosis private')).toBe(false)
  })
})

describe('formatHumanTimes', () => {
  it('converts millisecond tokens to seconds', () => {
    expect(formatHumanTimes('The trap lands at 2135ms into the clip.')).toBe(
      'The trap lands at 2.1s into the clip.'
    )
    expect(formatHumanTimes('Fault at 4000ms.')).toBe('Fault at 4s.')
    expect(formatHumanTimes('t=1500ms and 800 ms later')).toBe('1.5s and 0.8s later')
  })

  it('leaves already-human times alone', () => {
    expect(formatHumanTimes('at 0:04 and 4.2s in')).toBe('at 0:04 and 4.2s in')
  })

  it('sanitizes ms tokens even in plain (non-JSON) coach text', () => {
    expect(sanitizeCoachText('Recover at 2135ms.')).toBe('Recover at 2.1s.')
  })
})
