import { NextResponse } from 'next/server'
import { compileFightLang } from '@/lib/compiler/fightlang.compiler'
import { inferStyle } from '@/lib/strategy/style-inference'
import type { PoseFrame, PoseLandmark, FightEvidenceLedger } from '@/lib/fightlang/fightlang.types'
import { validateFightEvidenceLedger } from '@/lib/validators/fightlang.validator'
import { validateCoachingPayloadAgainstLedger, type CoachingPayload } from '@/lib/validators/llm-output.validator'
import { generateGroundedCoaching } from '@/lib/gemini/gemini-client'
import { InMemoryRetrievalStore, retrieveSimilarContext } from '@/lib/retrieval/retrieval'
import { seedFightKnowledge } from '@/lib/retrieval/fight-knowledge-seed'
import { embedAndStoreSegments } from '@/lib/retrieval/ingestVideoSegments'
import { retrieveForLedger } from '@/lib/retrieval/orchestrate'
import { cleanupOldFiles } from '@/services/videoUpload'
import { aiGuard, aiErrorResponse } from '@/lib/ai/aiGuard'
import { maybeEnforceVideoFromAnalyzeRequest } from '@/lib/musashiUsage'
import { getDbOrNull } from '@/lib/db'
import { getCurrentUser } from '@/lib/musashiAuth'
import { saveAnalysisLedger } from '@/lib/ledgerStore'

export const maxDuration = 60

// Gemini Files API housekeeping — each analyze call kicks a background
// cleanup of files older than 24h, but only once per hour per server
// instance (so we don't waste list+delete roundtrips).
let lastFilesCleanupAt = 0
const FILES_CLEANUP_COOLDOWN_MS = 60 * 60 * 1000
function maybeCleanupGeminiFiles() {
  const now = Date.now()
  if (now - lastFilesCleanupAt < FILES_CLEANUP_COOLDOWN_MS) return
  lastFilesCleanupAt = now
  void cleanupOldFiles().catch((e) => {
    console.warn('[FightLang] Gemini Files cleanup failed (non-fatal):', e instanceof Error ? e.message : e)
  })
}

type AnalyzeRequest = {
  poseFrames?: PoseFrame[]
  poseTimeline?: Array<{ tMs: number; landmarks: number[][][] | number[][]; actorId?: 'A' | 'B' }>
  kinematics?: any
  userIntent?: string
  focusTarget?: 'A' | 'B' | 'both'
  actors?: Array<'A' | 'B'>
  clip?: { durationMs?: number; fps?: number; sourceId?: string; assetRef?: string }
  llm?: { enabled?: boolean }
  videoFileUri?: string
  videoMimeType?: string
  /** User-selected sport (aliases ok: tkd, bjj, muay_thai, ...). Routes the coach-brain sport file. */
  sport?: string
  /** e.g. 'sparring' | 'bag work' | 'competition' — free-form context for the coach. */
  clipType?: string
  /** Pose pipeline metadata: which engine fed the ledger and how clean the tracking was. */
  pose?: { engine?: string; quality?: number | string }
}

const inMemStore = new InMemoryRetrievalStore()

function toPoseLandmarks(arr: number[][]): PoseLandmark[] {
  return arr.map((v) => ({
    x: Number(v?.[0] ?? 0),
    y: Number(v?.[1] ?? 0),
    z: typeof v?.[2] === 'number' ? Number(v[2]) : undefined,
    visibility: typeof v?.[3] === 'number' ? Number(v[3]) : undefined,
  }))
}

function normalizePoseFrames(req: AnalyzeRequest): PoseFrame[] {
  if (Array.isArray(req.poseFrames) && req.poseFrames.length > 0) {
    return req.poseFrames
  }

  if (Array.isArray(req.poseTimeline) && req.poseTimeline.length > 0) {
    const out: PoseFrame[] = []
    for (const e of req.poseTimeline) {
      const tMs = Math.round(Number(e.tMs ?? 0))
      const raw = (e as any).landmarks
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

export async function POST(request: Request) {
  const jsonError = (err: unknown, status: number) => {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status })
  }

  let data: AnalyzeRequest
  try {
    data = (await request.json()) as AnalyzeRequest
  } catch (e) {
    return jsonError('Invalid JSON', 400)
  }

  // Gate Gemini spend BEFORE doing any work. The DRY_RUN / OFFLINE_MODE
  // short-circuit below stays inside the guard so dev mocks still respect
  // the kill switch (handy when proving quota UX during a demo).
  const guard = await aiGuard(request, 'analyze')
  if (!guard.ok) return guard.response

  try {
    await maybeEnforceVideoFromAnalyzeRequest(guard.user, {
      clipDurationMs: data.clip?.durationMs,
      videoFileUri: data.videoFileUri,
      sourceId: data.clip?.sourceId,
      enabled: data.llm?.enabled !== false && Boolean(data.videoFileUri || (data.clip?.durationMs && data.clip.durationMs > 0)),
    })
  } catch (err) {
    return aiErrorResponse(err)
  }

  try {
    // OFFLINE MODE — return a deterministic mock. Lets the user exercise every
    // UI path (skeleton, overlays, charts) with zero Gemini spend. Toggle with
    // GEMINI_DRY_RUN=1 or OFFLINE_MODE=1 in .env.local.
    if (process.env.GEMINI_DRY_RUN === '1' || process.env.OFFLINE_MODE === '1') {
      return NextResponse.json({
        success: true,
        mocked: true,
        ledger: { actors: ['A', 'B'], strikes: [], events: [], mocked: true },
        coaching: {
          quickCues: [
            { actorId: 'A', text: '[OFFLINE] Jab tight, rear hand home.' },
            { actorId: 'B', text: '[OFFLINE] Circle off the fence.' },
          ],
          mainDiagnosis: '[OFFLINE] Mocked coaching — no API call made.',
        },
        overlayAnnotations: [],
        retrieval: { snippets: [] },
        pipelineStats: { mocked: true },
      })
    }

    const llmEnabled = data.llm?.enabled !== false

    // Keep compile-only analysis zero-spend. Gemini file cleanup only matters
    // when the paid LLM path is explicitly enabled.
    if (llmEnabled) {
      maybeCleanupGeminiFiles()
    }

    const poseFrames = normalizePoseFrames(data)
    if (poseFrames.length === 0) {
      return NextResponse.json({ success: false, error: 'Provide poseFrames or poseTimeline.' }, { status: 400 })
    }

    const { ledger, overlayAnnotations: compilerOverlays } = compileFightLang({
      poseFrames,
      kinematics: Array.isArray(data.kinematics) ? (data.kinematics as any) : undefined,
      actors: data.actors,
      clip: data.clip,
    })

    const ledgerValidation = validateFightEvidenceLedger(ledger)
    if (!ledgerValidation.ok) {
      return NextResponse.json(
        { success: false, error: 'Ledger validation failed', issues: ledgerValidation.issues },
        { status: 500 }
      )
    }

    const strategyAssessment = ledger.actors.map((actorId) => inferStyle(ledger, actorId))

    // Learning loop: persist the symbolic ledger so its detections can be
    // human-reviewed (confirm / reject / relabel) at /review. Non-fatal —
    // analysis still succeeds when no DB is bound.
    let savedLedgerId: string | null = null
    {
      const dbForLedger = getDbOrNull()
      if (dbForLedger) {
        try {
          const user = await getCurrentUser(request).catch(() => null)
          savedLedgerId = await saveAnalysisLedger({
            db: dbForLedger,
            ledger,
            userId: user?.id ?? null,
            sourceId: data.clip?.assetRef ?? data.clip?.sourceId ?? null,
          })
        } catch (e) {
          console.warn('[FightLang] Ledger save failed (non-fatal):', e instanceof Error ? e.message : e)
        }
      }
    }

    let coaching: CoachingPayload | null = null
    let retrieved: {
      queryText: string
      queryEmbeddingModel: string
      topK: number
      snippets: any[]
    } = {
      queryText: '',
      queryEmbeddingModel: 'disabled',
      topK: 0,
      snippets: [],
    }
    let model: string | null = null
    let llmIssues: any[] = []

    if (llmEnabled) {
      try {
        await seedFightKnowledge(inMemStore)
      } catch (seedErr) {
        console.warn('[FightLang] Knowledge seed failed (non-fatal):', seedErr instanceof Error ? seedErr.message : seedErr)
      }

      const db = getDbOrNull()

      // Embedding 2 pipeline: embed video segments into D1 for cross-modal retrieval
      if (data.videoFileUri && db) {
        const clipId = data.clip?.sourceId || `clip_${Date.now()}`
        embedAndStoreSegments({
          db,
          userId: 'local',
          sessionId: `session_${Date.now()}`,
          clipId,
          fileUri: data.videoFileUri,
          mimeType: data.videoMimeType || 'video/mp4',
          totalDurationMs: data.clip?.durationMs || 0,
        }).then((res) => {
          console.log(`[FightLang] Embedding 2 segments: ${res.stored} stored, ${res.errors} errors`)
        }).catch((e) => {
          console.warn('[FightLang] Embedding 2 segment ingestion failed (non-fatal):', e instanceof Error ? e.message : e)
        })
      }

      // NOTE: Whole-clip video embedding removed.
      // The segmented pipeline above (embedAndStoreSegments) already covers the
      // full clip at higher granularity (per-segment) with better retrieval
      // characteristics. Running both paths doubled Gemini Embedding API cost
      // with no retrieval benefit — the whole-clip vector was never preferred
      // over segment vectors during retrieveForLedger/retrieveSimilarContext.

      // Use the full retrieval pipeline (D1 + in-memory) when DB is available,
      // fall back to in-memory only retrieval otherwise
      if (db) {
        try {
          const ledgerAsFactual = ledger as any
          const fullRetrieval = await retrieveForLedger({
            db,
            userId: 'local',
            ledger: ledgerAsFactual,
            userIntent: data.userIntent || 'FightLang analysis',
          })
          retrieved = fullRetrieval
          console.log(`[FightLang] Full retrieval (D1+video): ${fullRetrieval.snippets.length} snippets`)
        } catch (e) {
          console.warn('[FightLang] Full retrieval failed, falling back to in-memory:', e instanceof Error ? e.message : e)
          retrieved = await retrieveSimilarContext({
            store: inMemStore,
            ledger,
            userIntent: data.userIntent || 'FightLang analysis',
          })
        }
      } else {
        retrieved = await retrieveSimilarContext({
          store: inMemStore,
          ledger,
          userIntent: data.userIntent || 'FightLang analysis',
        })
      }
      console.log(`[FightLang] Retrieval: ${retrieved.snippets.length} snippets matched (topScore=${retrieved.snippets[0]?.score?.toFixed(3) ?? 'none'})`)

      const gen = await generateGroundedCoaching({
        ledger,
        retrievedSnippets: retrieved.snippets,
        focusTarget: data.focusTarget,
        videoFileUri: data.videoFileUri,
        videoMimeType: data.videoMimeType,
        coachBrain: {
          selectedSport: data.sport,
          clipType: data.clipType,
          userQuestion: data.userIntent,
          poseEngine: data.pose?.engine,
          poseQuality: data.pose?.quality,
        },
      })
      model = gen.model

      const validated = validateCoachingPayloadAgainstLedger({ ledger, payload: gen.payload })
      coaching = validated.sanitized ?? gen.payload
      llmIssues = validated.issues
    }

    const allOverlays = [...compilerOverlays, ...(coaching?.overlayAnnotations ?? [])]

    const eventKinds: Record<string, number> = {}
    for (const e of ledger.events) eventKinds[e.kind] = (eventKinds[e.kind] ?? 0) + 1

    return NextResponse.json({
      success: true,
      ledger,
      savedLedgerId,
      strategyAssessment,
      coaching,
      overlayAnnotations: allOverlays,
      retrieval: retrieved,
      model,
      llmIssues,
      pipelineStats: {
        poseFrames: poseFrames.length,
        actors: ledger.actors,
        events: ledger.events.length,
        eventKinds,
        faults: ledger.faults.length,
        patterns: ledger.patterns.length,
        overlayAnnotations: allOverlays.length,
        compilerOverlays: compilerOverlays.length,
        llmOverlays: coaching?.overlayAnnotations?.length ?? 0,
        retrievalSnippets: retrieved?.snippets?.length ?? 0,
        retrievalTopScore: retrieved?.snippets?.[0]?.score ?? null,
        llmEnabled,
      },
    })
  } catch (err) {
    return jsonError(err, 500)
  }
}
