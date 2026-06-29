/**
 * YouTube-Style Fight Breakdown API
 *
 * Generates a structured, timestamped breakdown of fight footage
 * suitable for narrated video overlays — like a YouTube fight analyst.
 *
 * Pipeline: FightLang compiler → Embedding 2 retrieval → Gemini 3.1 Pro generation
 */

import { NextResponse } from 'next/server'
import { aiGuard, aiErrorResponse } from '@/lib/ai/aiGuard'
import { maybeEnforceVideoFromAnalyzeRequest } from '@/lib/musashiUsage'
import { compileFightLang } from '@/lib/compiler/fightlang.compiler'
import { inferStyle } from '@/lib/strategy/style-inference'
import type { PoseFrame, PoseLandmark, FightEvidenceLedger } from '@/lib/fightlang/fightlang.types'
import { generateGroundedBreakdown } from './breakdown-generator'
import { InMemoryRetrievalStore, retrieveSimilarContext } from '@/lib/retrieval/retrieval'
import { seedFightKnowledge } from '@/lib/retrieval/fight-knowledge-seed'

export const maxDuration = 120

type BreakdownRequest = {
  poseFrames?: PoseFrame[]
  poseTimeline?: Array<{ tMs: number; landmarks: number[][][] | number[][]; actorId?: 'A' | 'B' }>
  kinematics?: any
  clip?: { durationMs?: number; fps?: number; sourceId?: string }
  style?: 'commentary' | 'coaching' | 'scouting'
  focusActor?: 'A' | 'B' | 'both'
}

function toPoseLandmarks(arr: number[][]): PoseLandmark[] {
  return arr.map((v) => ({
    x: Number(v?.[0] ?? 0),
    y: Number(v?.[1] ?? 0),
    z: typeof v?.[2] === 'number' ? Number(v[2]) : undefined,
    visibility: typeof v?.[3] === 'number' ? Number(v[3]) : undefined,
  }))
}

function normalizePoseFrames(req: BreakdownRequest): PoseFrame[] {
  if (Array.isArray(req.poseFrames) && req.poseFrames.length > 0) {
    return req.poseFrames
  }
  if (Array.isArray(req.poseTimeline) && req.poseTimeline.length > 0) {
    const out: PoseFrame[] = []
    for (const e of req.poseTimeline) {
      const tMs = Math.round(Number(e.tMs ?? 0))
      const raw = e.landmarks
      const actors: any = {}
      if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0]) && Array.isArray(raw[0]?.[0])) {
        const a = raw[0] as number[][]
        const b = raw[1] as number[][] | undefined
        if (Array.isArray(a)) actors.A = toPoseLandmarks(a)
        if (Array.isArray(b)) actors.B = toPoseLandmarks(b)
      } else if (Array.isArray(raw) && raw.length > 0 && Array.isArray(raw[0])) {
        const actorId = e.actorId || 'A'
        actors[actorId] = toPoseLandmarks(raw as number[][])
      }
      out.push({ tMs, videoTimeSec: null, actors })
    }
    return out.sort((a, b) => a.tMs - b.tMs)
  }
  return []
}

const inMemStore = new InMemoryRetrievalStore()

export async function POST(request: Request) {
  const jsonError = (err: unknown, status: number) =>
    NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status })

  let data: BreakdownRequest
  try {
    data = (await request.json()) as BreakdownRequest
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const guard = await aiGuard(request, 'analyze')
  if (!guard.ok) return guard.response

  try {
    await maybeEnforceVideoFromAnalyzeRequest(guard.user, {
      clipDurationMs: data.clip?.durationMs,
      sourceId: data.clip?.sourceId,
      enabled: Boolean(data.clip?.durationMs && data.clip.durationMs > 0),
    })
  } catch (err) {
    return aiErrorResponse(err)
  }

  try {
    const poseFrames = normalizePoseFrames(data)
    if (poseFrames.length === 0) {
      return NextResponse.json({ success: false, error: 'Provide poseFrames or poseTimeline.' }, { status: 400 })
    }

    // Step 1: Deterministic FightLang compile
    const { ledger, overlayAnnotations: compilerOverlays } = compileFightLang({
      poseFrames,
      kinematics: Array.isArray(data.kinematics) ? data.kinematics : undefined,
      clip: data.clip,
    })

    // Step 2: Style inference
    const styleAssessments = ledger.actors.map((actor) => inferStyle(ledger, actor))

    // Step 3: Embedding retrieval (seeds fight knowledge on first call)
    await seedFightKnowledge(inMemStore)
    const retrieved = await retrieveSimilarContext({
      store: inMemStore,
      ledger,
      userIntent: 'Generate YouTube-style fight breakdown with timestamped commentary',
    })

    // Step 4: Gemini 3.1 Pro breakdown generation
    const breakdown = await generateGroundedBreakdown({
      ledger,
      retrievedSnippets: retrieved.snippets,
      styleAssessments,
      style: data.style || 'commentary',
      focusActor: data.focusActor || 'both',
    })

    return NextResponse.json({
      success: true,
      breakdown: breakdown.payload,
      ledger,
      styleAssessments,
      overlayAnnotations: [
        ...compilerOverlays,
        ...(breakdown.payload.overlayAnnotations || []),
      ],
      retrieval: retrieved,
      model: breakdown.model,
      pipelineStats: {
        poseFrames: poseFrames.length,
        actors: ledger.actors,
        events: ledger.events.length,
        faults: ledger.faults.length,
        patterns: ledger.patterns.length,
        retrievalSnippets: retrieved.snippets.length,
      },
    })
  } catch (err) {
    console.error('[Breakdown] Pipeline error:', err)
    return jsonError(err, 500)
  }
}
