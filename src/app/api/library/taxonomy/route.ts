import { NextResponse } from 'next/server'
import {
  queryByPosition,
  queryByTag,
  queryCountersByName,
  querySequences,
  getTechniqueTree,
  taxonomySearch,
} from '@/lib/taxonomyService'

/**
 * GET /api/library/taxonomy
 *
 * Query the structured technique taxonomy.
 *
 * Query params:
 *   discipline  — filter by discipline (e.g. bjj, boxing)
 *   position    — find techniques from a position (e.g. mount, guard_bottom)
 *   tag         — find techniques by tag/submission (e.g. armbar, choke)
 *   counters    — find counters for a technique name (e.g. double leg)
 *   sequences   — if "true", return sequences for the discipline
 *   tree        — if "true", return full category→technique hierarchy
 *   q           — free-text smart search (used by AI coaching)
 *   difficulty  — filter sequences by difficulty
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const discipline = url.searchParams.get('discipline') || undefined
    const position = url.searchParams.get('position')
    const tag = url.searchParams.get('tag')
    const countersFor = url.searchParams.get('counters')
    const wantSequences = url.searchParams.get('sequences') === 'true'
    const wantTree = url.searchParams.get('tree') === 'true'
    const query = url.searchParams.get('q')
    const difficulty = url.searchParams.get('difficulty') || undefined

    // Smart search (used by AI)
    if (query) {
      const result = await taxonomySearch(query, discipline)
      return NextResponse.json({ result })
    }

    // Full technique tree
    if (wantTree && discipline) {
      const tree = await getTechniqueTree(discipline)
      return NextResponse.json({ tree })
    }

    // Position query
    if (position) {
      const entries = await queryByPosition(position, discipline)
      return NextResponse.json({ entries })
    }

    // Tag / submission query
    if (tag) {
      const entries = await queryByTag(tag, discipline)
      return NextResponse.json({ entries })
    }

    // Counter query
    if (countersFor) {
      const results = await queryCountersByName(countersFor, discipline)
      return NextResponse.json({ results })
    }

    // Sequences
    if (wantSequences) {
      const seqs = await querySequences(discipline, difficulty)
      return NextResponse.json({ sequences: seqs })
    }

    return NextResponse.json(
      { error: 'Provide at least one query param: q, position, tag, counters, sequences=true, or tree=true' },
      { status: 400 }
    )
  } catch (e) {
    console.error('Taxonomy query error:', e)
    return NextResponse.json(
      { error: 'Taxonomy query failed', details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
