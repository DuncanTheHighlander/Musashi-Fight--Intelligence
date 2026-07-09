import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  SPORT_KEYS,
  buildCoachBrainBlock,
  getCoachBrainFile,
  getGlobalCoachRules,
  getSportBrain,
  resolveSportKey,
} from './coachBrain'
import { COACH_BRAIN_FILES } from './brains.generated'

describe('resolveSportKey (sport router aliases)', () => {
  it('routes every documented alias to the right sport brain', () => {
    expect(resolveSportKey('boxing')).toBe('boxing')
    expect(resolveSportKey('kickboxing')).toBe('kickboxing_muay_thai')
    expect(resolveSportKey('muay_thai')).toBe('kickboxing_muay_thai')
    expect(resolveSportKey('karate')).toBe('karate')
    expect(resolveSportKey('taekwondo')).toBe('taekwondo')
    expect(resolveSportKey('tkd')).toBe('taekwondo')
    expect(resolveSportKey('wrestling')).toBe('wrestling')
    expect(resolveSportKey('judo')).toBe('judo')
    expect(resolveSportKey('bjj')).toBe('bjj_grappling')
    expect(resolveSportKey('jiu_jitsu')).toBe('bjj_grappling')
    expect(resolveSportKey('grappling')).toBe('bjj_grappling')
    expect(resolveSportKey('fencing')).toBe('fencing')
    expect(resolveSportKey('mma')).toBe('mma')
  })

  it('normalizes case, spaces, and hyphens', () => {
    expect(resolveSportKey('Muay Thai')).toBe('kickboxing_muay_thai')
    expect(resolveSportKey('  BJJ ')).toBe('bjj_grappling')
    expect(resolveSportKey('jiu-jitsu')).toBe('bjj_grappling')
  })

  it('returns null for unknown or missing sports', () => {
    expect(resolveSportKey('sumo')).toBeNull()
    expect(resolveSportKey('')).toBeNull()
    expect(resolveSportKey(undefined)).toBeNull()
  })
})

describe('sport brain files', () => {
  it('every routed sport has a brain file with the standardized sections', () => {
    const requiredSections = [
      '## Purpose',
      '## Core Tactical Priorities',
      '## Common Positions / Phases',
      '## Common Mistakes',
      '## High-Value FightLang Events',
      '## What AI Vision Should Look For',
      '## What RTMPose / MediaPipe Should Measure',
      '## Coaching Rules',
      '## Caution / Uncertainty Rules',
      '## Good Feedback Patterns',
      '## Bad Feedback to Avoid',
      '## Output Guidance',
      '## Suggested FightLang Event Names',
    ]
    for (const key of SPORT_KEYS) {
      const brain = getSportBrain(key)
      expect(brain, `missing brain for ${key}`).not.toBeNull()
      for (const section of requiredSections) {
        expect(brain!.markdown, `${key} missing "${section}"`).toContain(section)
      }
    }
  })

  it('MMA brain focuses on transitions, not boxing+BJJ', () => {
    const mma = getSportBrain('mma')!
    expect(mma.markdown).toContain('transition')
    expect(mma.markdown).toContain('control_before_submission_fault')
    expect(mma.markdown).toContain('stance_square_under_takedown_threat')
    expect(mma.markdown).toContain('mat_return_opportunity')
  })

  it('BJJ brain keeps occlusion caution and positional fallback', () => {
    const bjj = getSportBrain('bjj')!
    expect(bjj.markdown).toContain('Position before submission')
    expect(bjj.markdown).toContain('fake-precise')
    expect(bjj.markdown).toContain('guard_retention_failure')
  })
})

describe('buildCoachBrainBlock', () => {
  it('includes the sport brain for the selected sport', () => {
    const block = buildCoachBrainBlock({ selectedSport: 'tkd' })
    expect(block).toContain('SPORT BRAIN (taekwondo)')
    expect(block).toContain('# Taekwondo Coaching Brain')
  })

  it('always includes the global rules (style, output, evidence, uncertainty)', () => {
    const block = buildCoachBrainBlock({ selectedSport: 'boxing' })
    expect(block).toContain('Musashi Global Coach Style')
    expect(block).toContain('Musashi Output Rules')
    expect(block).toContain('Musashi Evidence Rules')
    expect(block).toContain('Musashi Uncertainty Rules')
  })

  it('falls back to global coach rules only when the sport is unknown or missing', () => {
    const missing = buildCoachBrainBlock({})
    expect(missing).toContain('not specified — using global coach rules only')
    expect(missing).not.toContain('SPORT BRAIN (')
    expect(missing).toContain('Musashi Global Coach Style')

    const unknown = buildCoachBrainBlock({ selectedSport: 'sumo' })
    expect(unknown).toContain('no dedicated sport brain')
    expect(unknown).not.toContain('SPORT BRAIN (')
  })

  it('marks RTMPose as primary and MediaPipe as fallback', () => {
    const block = buildCoachBrainBlock({ selectedSport: 'mma' })
    expect(block).toContain('RTMPose (cloud) is the PRIMARY pose engine')
    expect(block).toContain('MediaPipe is the preview, free/basic, and fallback engine')
  })

  it('adds fallback-engine caution when MediaPipe fed the ledger', () => {
    const block = buildCoachBrainBlock({ selectedSport: 'boxing', poseEngine: 'mediapipe' })
    expect(block).toContain('MediaPipe fallback engine')
    expect(block).toContain('lower confidence')
  })

  it('triggers caution language on low poseQuality (string and numeric)', () => {
    for (const quality of ['low', 0.3] as const) {
      const block = buildCoachBrainBlock({ selectedSport: 'boxing', poseQuality: quality })
      expect(block).toContain('poseQuality: low')
      expect(block).toContain('POSE QUALITY IS LOW')
      expect(block).toContain('the tracking suggests')
    }
    const highBlock = buildCoachBrainBlock({ selectedSport: 'boxing', poseQuality: 0.9 })
    expect(highBlock).toContain('poseQuality: high')
    expect(highBlock).not.toContain('POSE QUALITY IS LOW')
  })

  it('carries clip type, fighter focus, and user question into the block', () => {
    const block = buildCoachBrainBlock({
      selectedSport: 'wrestling',
      clipType: 'sparring',
      fighterFocus: 'A',
      userQuestion: 'Why do my shots keep failing?',
    })
    expect(block).toContain('Clip type: sparring')
    expect(block).toContain('Fighter focus: A')
    expect(block).toContain('User question: Why do my shots keep failing?')
  })

  it('shapes the analysis per clip type (guidance lines)', () => {
    const sparring = buildCoachBrainBlock({ selectedSport: 'boxing', clipType: 'sparring' })
    expect(sparring).toContain('CLIP TYPE GUIDANCE:')
    expect(sparring).toContain('entries, exits, habits under resistance')

    const drilling = buildCoachBrainBlock({ selectedSport: 'bjj', clipType: 'drilling' })
    expect(drilling).toContain('repetition quality')
    expect(drilling).toContain('Do not judge it as live decision-making')

    const takedown = buildCoachBrainBlock({ selectedSport: 'wrestling', clipType: 'takedown' })
    expect(takedown).toContain('setup, level change, penetration, finish')

    const guardPassing = buildCoachBrainBlock({ selectedSport: 'bjj', clipType: 'guard_passing' })
    expect(guardPassing).toContain('frames, the knee line, hip control')

    const submission = buildCoachBrainBlock({ selectedSport: 'bjj', clipType: 'submission' })
    expect(submission).toContain('control before the submission')

    const striking = buildCoachBrainBlock({ selectedSport: 'mma', clipType: 'striking_exchange' })
    expect(striking).toContain('entry, guard responsibility')

    // Alias normalization: spaces/hyphens/slashes → underscores, 'match' → competition guidance.
    const rolling = buildCoachBrainBlock({ selectedSport: 'bjj', clipType: 'rolling / grappling' })
    expect(rolling).toContain('top/bottom context, frames, hip movement')
    const match = buildCoachBrainBlock({ selectedSport: 'judo', clipType: 'match' })
    expect(match).toContain('scoring and tactical consequences')

    // Unknown clip types add no guidance line but keep the label.
    const unknown = buildCoachBrainBlock({ selectedSport: 'boxing', clipType: 'mystery_footage' })
    expect(unknown).toContain('Clip type: mystery_footage')
    expect(unknown).not.toContain('CLIP TYPE GUIDANCE:')
  })

  it('discourages generic feedback via the global style rules', () => {
    const block = buildCoachBrainBlock({ selectedSport: 'boxing' })
    expect(block).toContain('Do not give generic advice unless it is tied to evidence')
    expect(block).toContain('Event → Consequence → Correction → Drill')
  })

  it('includes HISTORICAL ATHLETE DATA when recurring faults are provided', () => {
    const block = buildCoachBrainBlock({
      selectedSport: 'bjj',
      recurringFaults: ['hips flattened on bottom', 'guard dropping before entries'],
    })
    expect(block).toContain('HISTORICAL ATHLETE DATA')
    expect(block).toContain('hips flattened on bottom')
    expect(block).toContain('Do NOT claim a fault happened unless supported by current evidence')
  })

  it('omits HISTORICAL section when recurring faults are empty', () => {
    const block = buildCoachBrainBlock({ selectedSport: 'boxing', recurringFaults: [] })
    expect(block).not.toContain('HISTORICAL ATHLETE DATA')
  })

  it('blocks fake numeric precision via the evidence rules', () => {
    const block = buildCoachBrainBlock({ selectedSport: 'boxing' })
    expect(block).toContain('never output them as measurements')
    expect(block).toContain('the ledger indicates')
  })
})

describe('brains.generated.ts sync', () => {
  it('matches the markdown under coach-brain/ (run `pnpm gen:coach-brain` after editing)', () => {
    const brainDir = join(__dirname, '..', '..', '..', 'coach-brain')
    const collect = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? collect(join(dir, e.name)) : e.name.endsWith('.md') ? [join(dir, e.name)] : []
      )
    const diskFiles = collect(brainDir)
      .map((full) => ({
        key: relative(brainDir, full).replaceAll('\\', '/'),
        content: readFileSync(full, 'utf8').replace(/\r\n/g, '\n'),
      }))
      .sort((a, b) => a.key.localeCompare(b.key))

    expect(Object.keys(COACH_BRAIN_FILES).sort()).toEqual(diskFiles.map((f) => f.key))
    for (const f of diskFiles) {
      expect(COACH_BRAIN_FILES[f.key], `stale generated content for ${f.key}`).toBe(f.content)
    }
  })

  it('exposes the global rule files and router doc', () => {
    expect(getCoachBrainFile('sport_router.md')).toContain('Sport Router')
    expect(getGlobalCoachRules()).toContain('evidence-based fight-film coach')
  })
})
