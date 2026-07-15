import { describe, expect, it } from 'vitest'
import type { FactualLedger } from '@/lib/fightAnalysisPrompt'
import {
  GRAPPLING_ACTION_EVENTS,
  GRAPPLING_POSITIONS,
  MUSASHI_BJJ_DEEP_ANALYSIS_SYSTEM,
  buildGrapplingCoachingPrompt,
  buildGrapplingDeepAnalysisPrompt,
  buildGrapplingEvidenceLedgerPrompt,
  buildGrapplingLedgerFallbackReport,
  buildGrapplingTacticalAndBans,
  buildGrapplingVerificationPrompt,
  isGrapplingClip,
} from './grapplingAnalysisPrompt'

const grapplingLedger: FactualLedger = {
  combat_type: 'bjj_grappling',
  fighters: [
    { id: 'A', description: 'black rashguard' },
    { id: 'B', description: 'white gi' },
  ],
  video_analysis_ledger: [
    {
      timestamp: '00:04',
      dominant_position: 'half_guard',
      top_player_identifier: 'black rashguard',
      action_events: [],
      technical_faults: ['underhook_lost'],
    },
    {
      timestamp: '00:12',
      dominant_position: 'side_control',
      top_player_identifier: 'black rashguard',
      action_events: ['guard_pass_completed'],
      technical_faults: ['frames_collapsed', 'hips_flattened'],
    },
    {
      timestamp: '00:19',
      dominant_position: 'camera_occluded',
      action_events: [],
      technical_faults: [],
    },
  ],
  video_quality_notes: ['camera pans to another mat around 00:19'],
  forbidden_claims: ['no submission attempt visible'],
  unknowns: [],
}

describe('isGrapplingClip', () => {
  it('routes bjj and grappling aliases to the grappling pipeline', () => {
    expect(isGrapplingClip({ discipline: 'bjj' })).toBe(true)
    expect(isGrapplingClip({ discipline: 'BJJ' })).toBe(true)
    expect(isGrapplingClip({ discipline: 'grappling' })).toBe(true)
    expect(isGrapplingClip({ discipline: 'jiu-jitsu' })).toBe(true)
  })

  it('routes unambiguous ground-grappling clip types even without a sport', () => {
    expect(isGrapplingClip({ clipType: 'rolling_grappling' })).toBe(true)
    expect(isGrapplingClip({ clipType: 'guard_passing' })).toBe(true)
    expect(isGrapplingClip({ clipType: 'submission' })).toBe(true)
  })

  it('does not route striking sports or striking clip types', () => {
    expect(isGrapplingClip({ discipline: 'boxing' })).toBe(false)
    expect(isGrapplingClip({ discipline: 'mma', clipType: 'sparring' })).toBe(false)
    expect(isGrapplingClip({ discipline: 'wrestling' })).toBe(false)
    expect(isGrapplingClip({})).toBe(false)
  })
})

describe('riding / back-attack vocabulary', () => {
  it('allows wrist ride, handcuff, seatbelt, hooks, body triangle as positions', () => {
    expect(GRAPPLING_POSITIONS).toContain('wrist_ride')
    expect(GRAPPLING_POSITIONS).toContain('dagestani_handcuff')
    expect(GRAPPLING_POSITIONS).toContain('seatbelt_control')
    expect(GRAPPLING_POSITIONS).toContain('hooks_in')
    expect(GRAPPLING_POSITIONS).toContain('body_triangle')
    expect(GRAPPLING_POSITIONS).toContain('flattened_out')
    expect(GRAPPLING_ACTION_EVENTS).toContain('back_take')
    expect(GRAPPLING_ACTION_EVENTS).toContain('mat_return')
  })

  it('embeds ride vocabulary in the flash-scan prompt', () => {
    const prompt = buildGrapplingEvidenceLedgerPrompt()
    expect(prompt).toContain('wrist_ride')
    expect(prompt).toContain('dagestani_handcuff')
    expect(prompt).toContain('back_take')
    expect(prompt).toContain('Prefer ride/back vocabulary')
  })
})

describe('buildGrapplingEvidenceLedgerPrompt', () => {
  it('asks for the grappling timeline and bans striking events', () => {
    const prompt = buildGrapplingEvidenceLedgerPrompt({ clipDuration: 30000, focusTarget: 'A' })
    expect(prompt).toContain('video_analysis_ledger')
    expect(prompt).toContain('Do not look for or record striking events')
    expect(prompt).toContain('scramble_unresolved')
    expect(prompt).toContain('camera_occluded')
    expect(prompt).toContain('Fighter A')
    expect(prompt).toContain('WRIST_RIDE')
    expect(prompt).toContain('UNKNOWN')
    expect(prompt).toContain('techniques_identified')
    // Full position enum must ride in the prompt so the model has the off-ramps.
    expect(prompt).toContain('back_control')
    expect(prompt).toContain('guard_pass_completed')
    expect(prompt).toContain('frames_collapsed')
  })

  it('tightens the emergency attempt', () => {
    const prompt = buildGrapplingEvidenceLedgerPrompt({ attempt: 'emergency' })
    expect(prompt).toContain('second, more conservative attempt')
  })
})

describe('BJJ deep pass prompts', () => {
  it('system prompt carries the evidence-contract override', () => {
    expect(MUSASHI_BJJ_DEEP_ANALYSIS_SYSTEM).toContain('ABSOLUTE SOURCE OF TRUTH')
    expect(MUSASHI_BJJ_DEEP_ANALYSIS_SYSTEM).toContain('compiler artifacts')
    expect(MUSASHI_BJJ_DEEP_ANALYSIS_SYSTEM).toContain('treat it as EMPTY')
    expect(MUSASHI_BJJ_DEEP_ANALYSIS_SYSTEM).toContain('do not hallucinate')
  })

  it('deep analysis prompt embeds the timeline as source of truth', () => {
    const prompt = buildGrapplingDeepAnalysisPrompt(grapplingLedger)
    expect(prompt).toContain('ABSOLUTE SOURCE OF TRUTH')
    expect(prompt).toContain('side_control')
    expect(prompt).toContain('What Worked')
  })

  it('deep analysis prompt degrades cleanly without a timeline', () => {
    const prompt = buildGrapplingDeepAnalysisPrompt(null)
    expect(prompt).toContain('could not build a reliable timeline')
    expect(prompt).toContain('acknowledge visual gaps')
  })

  it('streaming coaching prompt is ledger-only and focus-aware', () => {
    const prompt = buildGrapplingCoachingPrompt(grapplingLedger, { coachingMode: 'corner_coach' })
    expect(prompt).toContain('Coach Fighter A primarily')
    expect(prompt).toContain('guard_pass_completed')
    expect(prompt).toContain('do not invent anything beyond the ledger')
  })

  it('verification prompt embeds the candidate ledger', () => {
    const prompt = buildGrapplingVerificationPrompt(grapplingLedger, { clipDuration: 30000 })
    expect(prompt).toContain('half_guard')
    expect(prompt).toContain('Corrections only')
  })
})

describe('buildGrapplingTacticalAndBans', () => {
  it('anchors on the position timeline and bans striking coaching', () => {
    const { tacticalAnchors, hardBans } = buildGrapplingTacticalAndBans(grapplingLedger)
    expect(tacticalAnchors.some((line) => line.includes('side_control'))).toBe(true)
    expect(tacticalAnchors.some((line) => line.includes('camera pans'))).toBe(true)
    expect(hardBans.some((line) => line.includes('DO NOT coach strikes'))).toBe(true)
    expect(hardBans.some((line) => line.includes('FORBIDDEN: no submission attempt visible'))).toBe(true)
    // Occlusion entries must trigger the visual-gap ban.
    expect(hardBans.some((line) => line.includes('occluded'))).toBe(true)
  })

  it('handles a null ledger without throwing', () => {
    const { tacticalAnchors, hardBans } = buildGrapplingTacticalAndBans(null)
    expect(tacticalAnchors).toEqual([])
    expect(hardBans.length).toBeGreaterThan(0)
  })
})

describe('buildGrapplingLedgerFallbackReport', () => {
  it('produces grappling prose grounded in the timeline', () => {
    const report = buildGrapplingLedgerFallbackReport(grapplingLedger)
    expect(report).toContain('What Worked')
    expect(report).toContain('side control')
    expect(report).toContain('frames')
    // No JSON or striking language leaks into the user-facing fallback.
    expect(report).not.toContain('{')
    expect(report.toLowerCase()).not.toContain('jab')
  })

  it('degrades honestly when the scan produced nothing', () => {
    const report = buildGrapplingLedgerFallbackReport(null)
    expect(report).toContain('did not give the scan enough clean visual data')
    expect(report).toContain('The Core Focus')
  })
})
