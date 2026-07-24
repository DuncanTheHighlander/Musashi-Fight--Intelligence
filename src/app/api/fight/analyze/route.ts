import { NextResponse } from 'next/server'
import { compileFightLang } from '@/lib/compiler/fightlang.compiler'
import { inferStyle } from '@/lib/strategy/style-inference'
import {
  FIGHTLANG_CONTRACT_VERSION,
  type PoseFrame,
  type PoseLandmark,
  type FightEvidenceLedger,
} from '@/lib/fightlang/fightlang.types'
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
import { saveLedgerPoseSnapshot } from '@/lib/trainingDatasetStore'
import { buildSessionEvidence } from '@/lib/evidence/sessionEvidence'
import {
  buildVisionLedger,
  fightLangToVerificationCandidate,
  verifyVisionLedger,
} from '@/lib/evidence/verifyEvidenceLedger'
import type { MotionBurstEvidence, TemporalEvidence } from '@/lib/evidence/sessionEvidenceExtensions'
import { clientKinematicsToFightLang } from '@/lib/compiler/segmentation'
import { getRecurringFaultsForUser } from '@/lib/coachBrain/recurringFaults'
import { isVisionFirstSport, resolveSportKey } from '@/lib/coachBrain/coachBrain'
import { isInlineVideoEligible } from '@/lib/gemini/videoFilePart'
import { readUploadedAssetBytes } from '@/lib/storage/assets'
import { computeVideoFingerprint } from '@/lib/aiCorrections/fingerprint'
import { formatApprovedCorrectionsBlock, formatCorrectionAppliedSummary } from '@/lib/aiCorrections/formatBlock'
import { fetchApprovedCorrectionsForClip } from '@/lib/aiCorrections/store'
import { visionFirstEnabled } from '@/lib/visionFirst'
import {
  buildVisionEvidence,
  hasUsableVisionEvidence,
  type VisionEvidence,
  type VisionEvidenceUsage,
} from '@/lib/evidence/visionEvidence'

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
  focusTarget?: 'A' | 'B' | 'both' | 'unsure'
  actors?: Array<'A' | 'B'>
  clip?: { durationMs?: number; fps?: number; sourceId?: string; assetRef?: string }
  llm?: { enabled?: boolean }
  videoFileUri?: string
  videoMimeType?: string
  /** Normalized R2 asset — when < 20MB, analyze loads bytes as Gemini inlineData. */
  normalizedAssetId?: string
  /** Analysis window for Gemini videoMetadata (original file, no client re-encode). */
  startSec?: number | null
  endSec?: number | null
  /** User-selected sport (aliases ok: tkd, bjj, muay_thai, ...). Routes the coach-brain sport file. */
  sport?: string
  /** e.g. 'sparring' | 'bag work' | 'competition' — free-form context for the coach. */
  clipType?: string
  /** Pose pipeline metadata: which engine fed the ledger and how clean the tracking was. */
  pose?: { engine?: string; quality?: number | string }
  /** Phase 3: peak-motion burst from client captureBurst (pose-aligned). */
  temporalBurst?: MotionBurstEvidence
  /** Phase 3: optional exchange windows (usually derived server-side from compile). */
  exchangeWindows?: Array<{ startMs: number; endMs: number }>
  /** Phase 5: optional 3D-lifted pose frames from cloud pass (falls back to 2D if absent). */
  pose3DFrames?: PoseFrame[]
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

/** Empty FightLang stub for vision-first sports (BJJ / wrestling / judo) when pose is absent. */
function emptyVisionFirstLedger(clip?: AnalyzeRequest['clip']): FightEvidenceLedger {
  return {
    contractVersion: FIGHTLANG_CONTRACT_VERSION,
    generatedAtMs: Date.now(),
    clip: clip
      ? {
          ...(typeof clip.durationMs === 'number' ? { durationMs: clip.durationMs } : {}),
          ...(typeof clip.fps === 'number' ? { fps: clip.fps } : {}),
          ...(clip.sourceId ? { sourceId: clip.sourceId } : {}),
        }
      : undefined,
    actors: ['A', 'B'],
    geometry: [],
    kinematics: [],
    actorStateTimeline: [],
    events: [],
    faults: [],
    patterns: [],
    sequences: [],
    evidenceIndex: [],
    notes: ['Vision-first analysis: no pose frames; tape is the source of truth.'],
  }
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
    const quotaClipKey =
      data.videoFileUri ||
      (data.normalizedAssetId ? `inline:${String(data.normalizedAssetId).trim()}` : '') ||
      data.clip?.sourceId
    await maybeEnforceVideoFromAnalyzeRequest(guard.user, {
      clipDurationMs: data.clip?.durationMs,
      videoFileUri: quotaClipKey,
      sourceId: data.clip?.sourceId || data.normalizedAssetId,
      enabled:
        data.llm?.enabled !== false &&
        Boolean(data.videoFileUri || data.normalizedAssetId || (data.clip?.durationMs && data.clip.durationMs > 0)),
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

    // Inline-bytes fast path: load normalized R2 bytes when < 20MB so the first
    // Coach Cards pass skips Gemini Files API ACTIVE polling entirely.
    const videoFileUri = data.videoFileUri
    let videoMimeType = data.videoMimeType || 'video/mp4'
    let videoInlineBase64: string | undefined
    const normalizedAssetId = String(data.normalizedAssetId || '').trim()
    if (!videoFileUri && normalizedAssetId) {
      try {
        const user = await getCurrentUser(request).catch(() => null)
        const db = getDbOrNull()
        if (db && user?.id) {
          const asset = await readUploadedAssetBytes(db, {
            assetId: normalizedAssetId,
            userId: user.id,
            isAdmin: user.role === 'shogun',
          })
          if (isInlineVideoEligible(asset.sizeBytes)) {
            videoInlineBase64 = asset.bytes.toString('base64')
            videoMimeType = asset.contentType || videoMimeType
            console.log(
              `[FightLang] Inline-bytes fast path: asset=${normalizedAssetId} size=${asset.sizeBytes}`,
            )
          } else {
            console.warn(
              `[FightLang] Normalized asset ${normalizedAssetId} is ${asset.sizeBytes} bytes — too large for inline; need Files API URI`,
            )
          }
        }
      } catch (inlineErr) {
        console.warn(
          '[FightLang] Inline asset load failed:',
          inlineErr instanceof Error ? inlineErr.message : inlineErr,
        )
      }
    }

    const hasVideoTape = Boolean(videoFileUri || videoInlineBase64)

    let poseFrames = normalizePoseFrames(data)
    // Vision-first rollout: with the flag ON, EVERY sport coaches from the
    // tape when one is attached — pose becomes optional supporting evidence
    // and its absence can never block Coach Cards.
    const visionPrimary = visionFirstEnabled() && llmEnabled && hasVideoTape
    // Defense in depth: when vision is primary, a low-quality pose sidecar is
    // dropped server-side too — contaminated tracks (bystander lock, heavy
    // occlusion) must never leak tactical claims into the coaching ledger.
    if (visionPrimary && poseFrames.length > 0) {
      const q = String(data.pose?.quality ?? '').toLowerCase()
      if (q === 'low' || (typeof data.pose?.quality === 'number' && data.pose.quality < 0.5)) {
        console.log('[VisionFirst] dropping low-quality pose sidecar (%d frames, quality=%s)', poseFrames.length, String(data.pose?.quality))
        poseFrames = []
      }
    }
    const visionFirst = isVisionFirstSport(data.sport) || visionPrimary
    const visionOnly =
      poseFrames.length === 0 &&
      llmEnabled &&
      hasVideoTape &&
      visionFirst

    if (poseFrames.length === 0 && !visionOnly) {
      return NextResponse.json({ success: false, error: 'Provide poseFrames or poseTimeline.' }, { status: 400 })
    }

    const pose3DFrames =
      Array.isArray(data.pose3DFrames) && data.pose3DFrames.length > 0
        ? [...data.pose3DFrames].sort((a, b) => a.tMs - b.tMs)
        : undefined

    let ledger: FightEvidenceLedger
    let compilerOverlays: Awaited<ReturnType<typeof compileFightLang>>['overlayAnnotations'] = []
    let exchangeWindows: Awaited<ReturnType<typeof compileFightLang>>['exchangeWindows'] = []
    let suppressionStats: Awaited<ReturnType<typeof compileFightLang>>['suppressionStats'] = undefined

    if (visionOnly) {
      // Vision-first sports (BJJ / wrestling / judo): tape is enough — skip pose compile.
      ledger = emptyVisionFirstLedger(data.clip)
      console.log(`[FightLang] Vision-only path for sport=${data.sport ?? 'unknown'} (no pose frames)`)
    } else {
      const kinematicsForCompile = Array.isArray(data.kinematics)
        ? clientKinematicsToFightLang(data.kinematics as any)
        : undefined

      const compiled = compileFightLang({
        poseFrames,
        ...(pose3DFrames ? { pose3DFrames } : {}),
        kinematics: kinematicsForCompile,
        actors: data.actors,
        clip: data.clip,
        sport: data.sport,
        clipType: data.clipType,
      })
      ledger = compiled.ledger
      compilerOverlays = compiled.overlayAnnotations
      exchangeWindows = compiled.exchangeWindows
      suppressionStats = compiled.suppressionStats

      const ledgerValidation = validateFightEvidenceLedger(ledger)
      if (!ledgerValidation.ok) {
        return NextResponse.json(
          { success: false, error: 'Ledger validation failed', issues: ledgerValidation.issues },
          { status: 500 }
        )
      }
    }

    const strategyAssessment = ledger.actors.map((actorId) => inferStyle(ledger, actorId))

    // Phase 2: SessionEvidence — vision flash scan + verification before coaching.
    let sessionEvidence = buildSessionEvidence({
      fightLang: ledger,
      visionLedger: null,
      sport: data.sport ?? null,
      clipType: data.clipType ?? null,
      poseEngine: data.pose?.engine ?? null,
      poseQuality: data.pose?.quality ?? null,
      videoSeen: Boolean(hasVideoTape),
      ...(pose3DFrames ? { pose3DFrames } : {}),
    })

    // ── Vision-first Pass 1: THE single full-video Gemini call ─────────────
    // Replaces the legacy two-call flash scan + verification when the flag is
    // on. The coaching pass below then runs on evidence JSON with NO video.
    let visionEvidence: VisionEvidence | null = null
    let visionEvidenceUsage: VisionEvidenceUsage | null = null
    if (visionPrimary) {
      try {
        const result = await buildVisionEvidence({
          videoFileUri,
          videoInlineBase64,
          videoMimeType,
          sport: data.sport,
          clipType: data.clipType,
          focusTarget: data.focusTarget,
          clipDurationSec:
            typeof data.clip?.durationMs === 'number' && data.clip.durationMs > 0
              ? data.clip.durationMs / 1000
              : null,
          startSec: data.startSec,
          endSec: data.endSec,
        })
        visionEvidence = result.evidence
        visionEvidenceUsage = result.usage
        console.log(
          `[VisionFirst] evidence pass ok: model=${result.usage.model} latency=${result.usage.latencyMs}ms tokens=${result.usage.totalTokens ?? '?'} people=${visionEvidence.people.length} seen=${visionEvidence.seen.length} heard=${visionEvidence.heard.length}`,
        )
      } catch (evidenceErr) {
        const message = evidenceErr instanceof Error ? evidenceErr.message : String(evidenceErr)
        console.warn('[VisionFirst] evidence pass failed:', message)
        if (visionOnly) {
          // No pose AND no vision evidence — nothing to coach from.
          return NextResponse.json(
            { success: false, error: `Vision analysis failed: ${message}`, failedStage: 'gemini_evidence' },
            { status: 502 },
          )
        }
        // Pose exists: continue with the legacy ledger-only coaching path.
      }
      if (visionOnly && !hasUsableVisionEvidence(visionEvidence)) {
        return NextResponse.json(
          {
            success: false,
            error: 'Vision analysis produced no usable evidence for this clip.',
            failedStage: 'gemini_evidence',
          },
          { status: 502 },
        )
      }
    }

    if (llmEnabled && hasVideoTape && !visionPrimary) {
      try {
        const mode = sessionEvidence.provenance.mode
        const focusTargetStr =
          data.focusTarget === 'A'
            ? 'A'
            : data.focusTarget === 'B'
              ? 'B'
              : data.focusTarget === 'unsure'
                ? 'both'
                : 'both'

        const fightLangCandidate =
          mode === 'striking' && !visionOnly ? fightLangToVerificationCandidate(ledger) : null

        let visionLedger = await buildVisionLedger({
          videoFileUri,
          videoInlineBase64,
          videoMimeType,
          mode,
          clipDurationMs: data.clip?.durationMs,
          focusTarget: focusTargetStr,
          fightLangCandidate,
          startSec: data.startSec,
          endSec: data.endSec,
          sport: data.sport,
        })

        visionLedger = await verifyVisionLedger({
          candidate: visionLedger,
          videoFileUri,
          videoInlineBase64,
          videoMimeType,
          mode,
          clipDurationMs: data.clip?.durationMs,
          startSec: data.startSec,
          endSec: data.endSec,
          sport: data.sport,
        })

        sessionEvidence = buildSessionEvidence({
          fightLang: ledger,
          visionLedger,
          sport: data.sport ?? null,
          clipType: data.clipType ?? null,
          poseEngine: data.pose?.engine ?? null,
          poseQuality: data.pose?.quality ?? null,
          videoSeen: true,
          ...(pose3DFrames ? { pose3DFrames } : {}),
        })

        console.log(
          `[FightLang] SessionEvidence: mode=${sessionEvidence.provenance.mode} mergeNotes=${sessionEvidence.merged.mergeNotes.join(' | ')}`,
        )
      } catch (visionErr) {
        const message = visionErr instanceof Error ? visionErr.message : String(visionErr)
        if (visionOnly) {
          // Vision-first with no pose cannot coach from FightLang alone.
          return NextResponse.json(
            { success: false, error: `Vision analysis failed: ${message}` },
            { status: 502 },
          )
        }
        console.warn(
          '[FightLang] Vision scan/verify failed (non-fatal, coaching uses FightLang only):',
          message,
        )
      }
    }

    if (visionOnly && !visionPrimary && !sessionEvidence.merged.visionFacts) {
      return NextResponse.json(
        { success: false, error: 'Vision analysis produced no usable ledger for this clip.', failedStage: 'gemini_evidence' },
        { status: 502 },
      )
    }

    const coachingLedger = sessionEvidence.merged.coachingLedger

    const temporal: TemporalEvidence = {
      exchangeWindows: data.exchangeWindows?.length ? data.exchangeWindows : (exchangeWindows ?? []),
      motionBurst: data.temporalBurst ?? null,
      suppressionStats: suppressionStats ?? undefined,
    }

    let recurringFaultLabels: string[] = []
    try {
      const user = await getCurrentUser(request).catch(() => null)
      if (user?.id) {
        const recurring = await getRecurringFaultsForUser(user.id, {
          sport: data.sport ?? null,
          limit: 5,
        })
        recurringFaultLabels = recurring.map((f) => f.label)
      }
    } catch {
      // non-fatal — anonymous and offline paths continue without memory
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
    let correctionsAppliedSummary: string | null = null
    let appliedCorrectionIds: string[] = []

    if (llmEnabled) {
      try {
        await seedFightKnowledge(inMemStore)
      } catch (seedErr) {
        console.warn('[FightLang] Knowledge seed failed (non-fatal):', seedErr instanceof Error ? seedErr.message : seedErr)
      }

      const db = getDbOrNull()

      // Embedding 2 pipeline: embed video segments into D1 for cross-modal retrieval
      if (videoFileUri && db) {
        const clipId = data.clip?.sourceId || `clip_${Date.now()}`
        embedAndStoreSegments({
          db,
          userId: 'local',
          sessionId: `session_${Date.now()}`,
          clipId,
          fileUri: videoFileUri,
          mimeType: videoMimeType || 'video/mp4',
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
          const fullRetrieval = await retrieveForLedger({
            db,
            userId: 'local',
            ledger: coachingLedger as any,
            userIntent: data.userIntent || 'FightLang analysis',
          })
          retrieved = fullRetrieval
          console.log(`[FightLang] Full retrieval (D1+video): ${fullRetrieval.snippets.length} snippets`)
        } catch (e) {
          console.warn('[FightLang] Full retrieval failed, falling back to in-memory:', e instanceof Error ? e.message : e)
          retrieved = await retrieveSimilarContext({
            store: inMemStore,
            ledger: coachingLedger,
            userIntent: data.userIntent || 'FightLang analysis',
          })
        }
      } else {
        retrieved = await retrieveSimilarContext({
          store: inMemStore,
          ledger: coachingLedger,
          userIntent: data.userIntent || 'FightLang analysis',
        })
      }
      console.log(`[FightLang] Retrieval: ${retrieved.snippets.length} snippets matched (topScore=${retrieved.snippets[0]?.score?.toFixed(3) ?? 'none'})`)

      // Teach Musashi Phase 1: exact-clip approved corrections (same owner only).
      // Attached beside retrieval — never inside coach-brain text.
      let approvedCorrectionsBlock: string | null = null
      try {
        const owner = await getCurrentUser(request).catch(() => null)
        const sportKey = resolveSportKey(data.sport) || String(data.sport || '').trim()
        const clipId =
          String(data.clip?.assetRef || data.clip?.sourceId || data.normalizedAssetId || '').trim() || null
        if (db && owner?.id && sportKey && (clipId || data.normalizedAssetId)) {
          let fingerprint: string | null = null
          const assetForFp = String(data.normalizedAssetId || clipId || '').trim()
          if (assetForFp) {
            fingerprint = await computeVideoFingerprint({
              db,
              assetId: assetForFp,
              userId: owner.id,
              isAdmin: owner.role === 'shogun',
              durationMs: data.clip?.durationMs ?? null,
            })
          }
          const rangeStartMs =
            typeof data.startSec === 'number' && Number.isFinite(data.startSec)
              ? Math.max(0, Math.trunc(data.startSec * 1000))
              : 0
          const rangeEndMs =
            typeof data.endSec === 'number' && Number.isFinite(data.endSec)
              ? Math.trunc(data.endSec * 1000)
              : data.clip?.durationMs ?? null
          const corrections = await fetchApprovedCorrectionsForClip({
            db,
            ownerUserId: owner.id,
            clipId,
            videoFingerprint: fingerprint,
            sport: sportKey,
            rangeStartMs,
            rangeEndMs,
          })
          if (corrections.length > 0) {
            approvedCorrectionsBlock = formatApprovedCorrectionsBlock(corrections)
            appliedCorrectionIds = corrections.map((c) => c.id)
            correctionsAppliedSummary = formatCorrectionAppliedSummary(corrections)
          }
        }
      } catch (corrErr) {
        console.warn(
          '[FightLang] Approved corrections fetch failed (non-fatal):',
          corrErr instanceof Error ? corrErr.message : corrErr,
        )
      }

      // Coaching failure must never produce fake feedback: on error we keep
      // the deterministic ledger/overlays, return coaching=null, and surface
      // the failure explicitly so the UI can say "AI coaching unavailable"
      // instead of showing a canned payload.
      try {
        const gen = await generateGroundedCoaching({
          ledger: coachingLedger,
          retrievedSnippets: retrieved.snippets,
          focusTarget: data.focusTarget,
          videoFileUri,
          videoInlineBase64,
          videoMimeType,
          startSec: data.startSec,
          endSec: data.endSec,
          visionLedger: sessionEvidence.merged.visionFacts,
          temporalEvidence: temporal,
          // Pass-1 evidence: when set, coaching runs WITHOUT re-sending video.
          visionEvidence,
          // With vision evidence, identity comes from its fighterAssignment;
          // the left/right fallback only applies when no evidence exists.
          visionScreenMapping: !visionEvidence && (visionOnly || (visionFirst && hasVideoTape)),
          coachBrain: {
            selectedSport: data.sport,
            clipType: data.clipType,
            userQuestion: data.userIntent,
            poseEngine: data.pose?.engine,
            poseQuality: data.pose?.quality,
            recurringFaults: recurringFaultLabels,
          },
          approvedCorrectionsBlock,
        })
        model = gen.model

        const validated = validateCoachingPayloadAgainstLedger({ ledger: coachingLedger, payload: gen.payload })
        coaching = validated.sanitized ?? gen.payload
        if (coaching && appliedCorrectionIds.length > 0) {
          ;(coaching as CoachingPayload & { applied_correction_ids?: string[] }).applied_correction_ids =
            appliedCorrectionIds
        }
        llmIssues = validated.issues
      } catch (llmErr) {
        const message = llmErr instanceof Error ? llmErr.message : String(llmErr)
        console.warn('[FightLang] Grounded coaching failed (returning ledger without coaching):', message)
        coaching = null
        model = null
        llmIssues = [{ level: 'error', code: 'llm_unavailable', message: `AI coaching unavailable: ${message}` }]
      }
    }

    // Learning loop: persist the symbolic ledger so its detections can be
    // human-reviewed (confirm / reject / relabel) at /review. Saved AFTER the
    // coaching pass so admins also see the sport/clipType/fighterFocus context
    // and the final feedback the user received. Non-fatal — analysis still
    // succeeds when no DB is bound.
    let savedLedgerId: string | null = null
    {
      const dbForLedger = getDbOrNull()
      if (dbForLedger) {
        try {
          const user = await getCurrentUser(request).catch(() => null)
          savedLedgerId = await saveAnalysisLedger({
            db: dbForLedger,
            ledger: coachingLedger,
            userId: user?.id ?? null,
            sourceId: data.clip?.assetRef ?? data.clip?.sourceId ?? null,
            context: {
              sport: data.sport ?? null,
              clipType: data.clipType ?? null,
              fighterFocus: data.focusTarget ?? null,
              poseEngine: data.pose?.engine ?? null,
              poseQuality: data.pose?.quality ?? null,
            },
            coaching: coaching
              ? {
                  model,
                  mainDiagnosis: coaching.mainDiagnosis,
                  quickCues: coaching.quickCues as unknown[],
                  suggestedCorrections: coaching.suggestedCorrections as unknown[],
                }
              : null,
          })
          if (savedLedgerId) {
            try {
              await saveLedgerPoseSnapshot({
                db: dbForLedger,
                ledgerId: savedLedgerId,
                poseFrames,
              })
            } catch (snapErr) {
              console.warn(
                '[TrainingDataset] Pose snapshot save failed (non-fatal):',
                snapErr instanceof Error ? snapErr.message : snapErr
              )
            }
          }
        } catch (e) {
          console.warn('[FightLang] Ledger save failed (non-fatal):', e instanceof Error ? e.message : e)
        }
      }
    }

    const allOverlays = [...compilerOverlays, ...(coaching?.overlayAnnotations ?? [])]

    const eventKinds: Record<string, number> = {}
    for (const e of ledger.events) eventKinds[e.kind] = (eventKinds[e.kind] ?? 0) + 1

    return NextResponse.json({
      success: true,
      ledger: coachingLedger,
      visionFirst: visionPrimary,
      ...(visionEvidence ? { visionEvidence } : {}),
      ...(visionEvidenceUsage ? { visionEvidenceUsage } : {}),
      sessionEvidence: {
        provenance: sessionEvidence.provenance,
        mergeNotes: sessionEvidence.merged.mergeNotes,
        visionLedger: sessionEvidence.merged.visionFacts,
        temporal,
        ...(sessionEvidence.pose3DFrames?.length
          ? { pose3DFrames: sessionEvidence.pose3DFrames, pose3DEnabled: true }
          : { pose3DEnabled: false }),
      },
      savedLedgerId,
      strategyAssessment,
      coaching,
      overlayAnnotations: allOverlays,
      retrieval: retrieved,
      model,
      llmIssues,
      appliedCorrectionIds,
      correctionsAppliedSummary,
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
        evidenceMode: sessionEvidence.provenance.mode,
        visionVerified: Boolean(sessionEvidence.merged.visionFacts),
      },
    })
  } catch (err) {
    return jsonError(err, 500)
  }
}
