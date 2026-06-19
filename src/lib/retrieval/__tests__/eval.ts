import { describe, it, expect } from 'vitest'
import { planSegments } from '../ingestVideoSegments'
import { fusedRerank } from '../rerank'
import { buildLedgerSummaryText, buildRetrievalQueryText } from '../text'
import type { RetrievedSnippet } from '../types'

type LedgerLike = Parameters<typeof buildLedgerSummaryText>[0]

// ── planSegments unit tests ─────────────────────────────────────────────────

describe('planSegments', () => {
  it('returns single window for short clips', () => {
    const segments = planSegments(8000)
    expect(segments).toEqual([{ startMs: 0, endMs: 8000 }])
  })

  it('returns overlapping windows for long clips', () => {
    const segments = planSegments(25000, { maxSegmentMs: 10000, overlapMs: 2000 })
    expect(segments.length).toBeGreaterThan(1)
    expect(segments[0].startMs).toBe(0)
    expect(segments[0].endMs).toBe(10000)
    expect(segments[1].startMs).toBe(8000)
    expect(segments[segments.length - 1].endMs).toBe(25000)
  })

  it('returns empty for zero duration', () => {
    expect(planSegments(0)).toEqual([])
  })
})

// ── buildLedgerSummaryText ──────────────────────────────────────────────────

describe('buildLedgerSummaryText', () => {
  it('produces stable canonical text from ledger fields', () => {
    const ledger: LedgerLike = {
      combat_type: 'kickboxing',
      matchup_style: 'pressure vs counter puncher',
      techniques_observed: ['jab', 'cross', 'teep'],
      key_moments: ['0:02 - jab exchange'],
    }
    const text = buildLedgerSummaryText(ledger)
    expect(text).toContain('combat_type: kickboxing')
    expect(text).toContain('matchup_style: pressure vs counter puncher')
    expect(text).toContain('jab')
  })

  it('returns empty for null ledger', () => {
    expect(buildLedgerSummaryText(null)).toBe('')
  })
})

// ── fusedRerank ─────────────────────────────────────────────────────────────

describe('fusedRerank', () => {
  const makeSnippet = (
    overrides: Partial<RetrievedSnippet> & { docId: string; score: number; namespace: RetrievedSnippet['namespace'] }
  ): RetrievedSnippet => ({
    title: null,
    text: 'test',
    metadata: {},
    ...overrides,
  })

  it('applies namespace weights correctly', () => {
    const snippets = [
      makeSnippet({ docId: 'a', score: 0.80, namespace: 'ledger_summary' }),
      makeSnippet({ docId: 'b', score: 0.80, namespace: 'video_segment' }),
      makeSnippet({ docId: 'c', score: 0.80, namespace: 'prior_coaching' }),
    ]
    const result = fusedRerank(snippets)
    expect(result[0].docId).toBe('a')
    expect(result[1].docId).toBe('b')
    expect(result[2].docId).toBe('c')
  })

  it('penalizes duplicate clips for video segments', () => {
    const snippets = [
      makeSnippet({ docId: 'v1', score: 0.9, namespace: 'video_segment', metadata: { clipId: 'clip1' } }),
      makeSnippet({ docId: 'v2', score: 0.85, namespace: 'video_segment', metadata: { clipId: 'clip1' } }),
      makeSnippet({ docId: 'v3', score: 0.5, namespace: 'video_segment', metadata: { clipId: 'clip2' } }),
    ]
    const result = fusedRerank(snippets)
    const v2 = result.find((s) => s.docId === 'v2')!
    const v3 = result.find((s) => s.docId === 'v3')!
    expect(v2.score).toBeLessThan(v3.score)
  })
})

// ── Retrieval eval cases (structural, no live API) ──────────────────────────

type EvalCase = {
  name: string
  queryText: string
  expectedNamespaceHits: string[]
  shouldNotMatch?: string[]
  description: string
}

const evalCases: EvalCase[] = [
  {
    name: 'boxer_pressure_style',
    queryText: 'pressure boxing, walking opponent down, jab-cross combinations',
    expectedNamespaceHits: ['ledger_summary', 'video_segment'],
    description: 'Should retrieve similar boxing pressure clips and matching ledger summaries.',
  },
  {
    name: 'southpaw_stance_switch',
    queryText: 'fighter switching from orthodox to southpaw mid-round',
    expectedNamespaceHits: ['video_segment', 'style_drill_library'],
    description: 'Should match video segments showing stance switches and relevant drill docs.',
  },
  {
    name: 'guard_drop_level_change',
    queryText: 'fighter dropping left hand during a level change',
    expectedNamespaceHits: ['video_segment'],
    description: 'Core cross-modal test: text query should match video showing this physical action.',
  },
  {
    name: 'counter_punching_style',
    queryText: 'counter-puncher sitting on the back foot, timing pull counters',
    expectedNamespaceHits: ['ledger_summary', 'video_segment', 'style_drill_library'],
    description: 'Should retrieve style library entries for counter-punching drills.',
  },
  {
    name: 'drill_recall_pivot',
    queryText: 'pivot drill to practice cutting off the ring',
    expectedNamespaceHits: ['style_drill_library', 'prior_coaching'],
    description: 'Should recall drills from style library and prior coaching advice.',
  },
  {
    name: 'misleading_video_similar_motion_different_tactic',
    queryText: 'aggressive forward pressure walk-down',
    expectedNamespaceHits: ['video_segment'],
    shouldNotMatch: ['video showing retreat disguised as pressure by camera angle'],
    description: 'Misleading case: visually similar forward motion but different tactical intent. Retrieval may match; reasoning must not treat it as factual proof.',
  },
  {
    name: 'misleading_video_clinch_vs_hug',
    queryText: 'Muay Thai clinch with knee strikes',
    expectedNamespaceHits: ['video_segment', 'style_drill_library'],
    shouldNotMatch: ['video of friendly post-fight embrace'],
    description: 'Misleading case: physical proximity looks like clinch but is not combat. Tests that retrieval might surface it but reasoning rules prevent factual claims.',
  },
  {
    name: 'prior_session_continuity',
    queryText: 'what did we work on last session with this fighter',
    expectedNamespaceHits: ['prior_coaching', 'ledger_summary'],
    description: 'Session memory retrieval: should pull recent coaching and ledger docs for the same user.',
  },
]

describe('retrieval eval cases (structural)', () => {
  for (const c of evalCases) {
    it(`case: ${c.name} — ${c.description}`, () => {
      expect(c.queryText.length).toBeGreaterThan(5)
      expect(c.expectedNamespaceHits.length).toBeGreaterThan(0)
      for (const ns of c.expectedNamespaceHits) {
        expect(
          ['ledger_summary', 'prior_coaching', 'style_drill_library', 'video_segment', 'outcome_memory'].includes(ns)
        ).toBe(true)
      }
    })
  }
})

export { evalCases }
export type { EvalCase }
