'use client'

import React, { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '@/contexts/AuthContext'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { CompactFocusToggle } from '@/components/fight/FocusToggle'
import { PoseQualityBadge } from '@/components/fight/PoseQualityBadge'
import RotatingWisdom from '@/components/fight/RotatingWisdom'
import ChatMarkdown from '@/components/fight/ChatMarkdown'
import {
  deleteSession,
  exportAll,
  getSession,
  importAll,
  listSessions,
  putSession,
  type LocalFightSession,
} from '@/lib/fightLocalStore'
import {
  type KinematicsSnapshot,
  type LandmarkHistory,
} from '@/lib/kinematics'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
// Video upload now routed through /api/fight server action (keeps API key secure)
import { segmentExchanges, type ExchangeTimeline } from '@/services/exchangeSegmenter'
import { detectPatterns, exportPatternsForAI, type PatternAnalysisResult } from '@/services/patternDetector'
import { parseApiResponse, fetchAndParseApiResponse } from '@/lib/safeJson'
import { uploadMarketplaceFile, type UploadProgress } from '@/lib/storage/uploadClient'
import { toAssetRef, parseAssetRef } from '@/lib/storage/assetRef'
import { getPerformanceProfile, SERVER_DEFAULT_PROFILE } from '@/lib/performanceProfile'
import { cn } from '@/lib/utils'
import { useVideoKeyboardShortcuts } from '@/hooks/useVideoKeyboardShortcuts'
import {
  AlertTriangle,
  CheckCircle2,
  FileVideo,
  Gauge,
  Loader2,
  Mic,
  Play,
  RotateCcw,
  Send,
  Upload,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { FightAnalyzer } from '@/components/video/FightAnalyzer'
import { pickByClick } from '@/lib/pose/fighterSelection'
import { isRtmposeReady, rtmposeRequested } from '@/lib/pose/rtmposeBackend'
import type { PoseEngineInfo } from '@/lib/pose/poseQuality'
import { filterFramesByVisibility } from '@/lib/pose/poseQuality'
import type { FightEvidenceLedger } from '@/lib/fightlang/ledger'
import { createEmptyLedger, ingestFrameEvidence } from '@/lib/compiler/evidenceCompiler'
import { FightOverlay } from '@/components/overlay/FightOverlay'
import { CoachingPanel } from '@/components/feedback/CoachingPanel'
import { sanitizeCoachText, looksLikeCoachingJson } from '@/lib/feedback/coachFeedback'
import ClipTimeWindowSlider, { type ClipTimeWindow } from '@/components/fight/ClipTimeWindowSlider'
import { defaultTrimWindow, resolveVideoDuration } from '@/lib/videoTrim'
import {
  FREE_MAX_VIDEO_SEC,
  PRO_MAX_VIDEO_SEC,
  SHOGUN_MAX_VIDEO_SEC,
  VIDEO_DURATION_TOLERANCE_SEC,
} from '@/lib/videoTierLimits'
import { clipWindowDurationSec } from '@/lib/gemini/videoFilePart'
import type {
  PoseFrame as FightLangPoseFrame,
  PoseLandmark as FightLangPoseLandmark,
  OverlayAnnotation as FightLangOverlayAnnotation,
} from '@/lib/fightlang/fightlang.types'
import {
  hasNearFullClipCoverage,
  slicePoseFramesFullClip,
  slicePoseFramesWindow,
} from '@/lib/fightlang/pose-buffer'
import {
  waitForMediaPreloaded,
  mediaBufferedEnough,
  verifyBootReadiness,
  type MediaPreloadOutcome,
} from '@/lib/bootVerification'
import { dedupeInflight, fingerprintSlice } from '@/lib/ai/clientInflight'
import { findPeakMotionMs, PEAK_MOTION_THRESHOLDS } from '@/services/motionScore'
import { captureBurstFromBuffer } from '@/services/captureBurst'
import { isGrapplingClip } from '@/lib/grapplingAnalysisPrompt'
import { isVisionFirstSport, resolveSportKey } from '@/lib/coachBrain/coachBrain'
import type { MotionBurstEvidence } from '@/lib/evidence/sessionEvidenceExtensions'
import {
  CLIP_TYPE_OPTIONS,
  SPORT_OPTIONS,
  buildFightClipAiMetadata,
  clipTypeLabelFor,
  sportLabelFor,
} from '@/lib/fightClipMetadata'

/** Faster cadence for short clips; relaxed for long fights. */
function getFightLangSchedule(durSec: number) {
  if (!Number.isFinite(durSec) || durSec <= 0) {
    return { fastDelayMs: 600, fastIntervalMs: 1800, llmDelayMs: 3200, llmIntervalMs: 9000, minFramesFast: 14, minFramesLlm: 20 }
  }
  if (durSec <= 12) {
    return { fastDelayMs: 0, fastIntervalMs: 2600, llmDelayMs: 1200, llmIntervalMs: 7000, minFramesFast: 4, minFramesLlm: 6 }
  }
  if (durSec <= 22) {
    return { fastDelayMs: 400, fastIntervalMs: 3200, llmDelayMs: 2200, llmIntervalMs: 8000, minFramesFast: 10, minFramesLlm: 14 }
  }
  return { fastDelayMs: 1200, fastIntervalMs: 5000, llmDelayMs: 4200, llmIntervalMs: 12000, minFramesFast: 18, minFramesLlm: 26 }
}

function poseFramesToLandmarkHistories(frames: FightLangPoseFrame[]): {
  A: LandmarkHistory[]
  B: LandmarkHistory[]
} {
  const A: LandmarkHistory[] = []
  const B: LandmarkHistory[] = []
  const toNorm = (lm: FightLangPoseLandmark): NormalizedLandmark => ({
    x: lm.x,
    y: lm.y,
    z: lm.z ?? 0,
    visibility: lm.visibility ?? 1,
  })
  for (const f of frames) {
    if (f.actors.A?.length) {
      A.push({ timestampMs: f.tMs, landmarks: f.actors.A.map(toNorm) })
    }
    if (f.actors.B?.length) {
      B.push({ timestampMs: f.tMs, landmarks: f.actors.B.map(toNorm) })
    }
  }
  return { A, B }
}

type PlaybackSnapshot = {
  currentTime: number
  duration: number
  paused: boolean
  ended: boolean
  readyState: number
  videoWidth: number
  videoHeight: number
  bufferedPct: number
}

type PreScanProgress = {
  passIndex: number
  passCount: number
  stepIndex: number
  totalSteps: number
  completed: number
}

type VideoCreditBalance = {
  limit: number
  used: number
  reserved: number
  remaining: number
  tier: 'free' | 'pro' | 'shogun'
}

type VideoIngestionStage =
  | 'selected'
  | 'uploading_original'
  | 'original_uploaded'
  | 'normalizing'
  | 'normalized'
  | 'uploading_to_gemini'
  | 'gemini_processing'
  | 'gemini_ready'
  | 'analyzing'
  | 'complete'
  | 'failed'

function hasUsableCoachCards(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const payload = value as Record<string, unknown>
  const diagnosis = typeof payload.mainDiagnosis === 'string' ? payload.mainDiagnosis.trim() : ''
  const quickCues = Array.isArray(payload.quickCues) ? payload.quickCues : []
  const corrections = Array.isArray(payload.suggestedCorrections) ? payload.suggestedCorrections : []
  return diagnosis.length > 0 && (quickCues.length > 0 || corrections.length > 0)
}

function formatUploadBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return 'unknown size'
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 1 : 2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${Math.round(bytes)} B`
}

type NoClipChatBalance = {
  tier: 'free' | 'pro' | 'shogun'
  limit: number | null
  used: number
  remaining: number | null
  day: string
  resetsAt: string
}

/**
 * Discriminated union mirroring the shapes returned by `src/lib/ai/aiGuard.ts`.
 * Anything non-OK gets surfaced as a polished card so the demo never shows a
 * raw HTTP 5xx to the user.
 */
type AiQuotaState =
  | { kind: 'auth' }
  | { kind: 'rate_limited'; retryAfterSec?: number }
  | { kind: 'quota_exhausted' }
  | { kind: 'kill_switch'; hint?: string }

const EMPTY_PLAYBACK_SNAPSHOT: PlaybackSnapshot = {
  currentTime: 0,
  duration: 0,
  paused: true,
  ended: false,
  readyState: 0,
  videoWidth: 0,
  videoHeight: 0,
  bufferedPct: 0,
}

function getBufferedPercent(video: HTMLVideoElement): number {
  const duration = video.duration
  if (!Number.isFinite(duration) || duration <= 0 || video.buffered.length === 0) return 0
  const bufferedEnd = video.buffered.end(video.buffered.length - 1)
  return Math.max(0, Math.min(100, (bufferedEnd / duration) * 100))
}

/** Instant strip text from compiler ledger before LLM returns. */
function buildPreviewCoachingFromLedger(ledger: {
  actors?: string[]
  faults?: Array<{ id?: string; actorId?: string; kind?: string; message?: string; severity?: string; confidence?: { score?: number } }>
  patterns?: Array<{ id?: string; actorId?: string; kind?: string; confidence?: { score?: number } }>
}): { quickCues: Array<Record<string, unknown>>; mainDiagnosis: string } {
  const cues: Array<Record<string, unknown>> = []
  let idx = 0
  for (const f of (ledger.faults || []).slice(0, 4)) {
    cues.push({
      id: f.id || `pv_${idx}`,
      actorId: f.actorId || 'A',
      quickCue: String(f.message || f.kind || 'Position note'),
      keyMistake: f.severity === 'high' ? 'Priority' : '',
      confidence: f.confidence || { score: 0.62 },
    })
    idx++
  }
  for (const p of (ledger.patterns || []).slice(0, 2)) {
    if (cues.length >= 5) break
    cues.push({
      id: p.id || `pv_${idx}`,
      actorId: p.actorId || 'A',
      quickCue: `Pattern: ${String(p.kind || 'rhythm')}`,
      confidence: p.confidence || { score: 0.55 },
    })
    idx++
  }
  const actors = (ledger.actors || []).filter(Boolean).join(' & ') || 'Fighters'

  if (cues.length === 0) {
    const states = (ledger as any)?.actorStateTimeline as Array<{ actorId?: string; stanceSide?: string; guard?: string; rangeToOther?: string }> | undefined
    const last = states?.length ? states[states.length - 1] : null
    if (last) {
      cues.push({
        id: 'pv_state',
        actorId: last.actorId || 'A',
        quickCue: `${last.stanceSide ?? 'orthodox'} stance · ${last.guard ?? 'high'} guard${last.rangeToOther ? ` · ${last.rangeToOther} range` : ''}`,
        keyMistake: '',
        confidence: { score: 0.55 },
      })
    } else {
      cues.push({
        id: 'pv_sample',
        actorId: 'A',
        quickCue: 'Mapping fighters — stance, guard, and range…',
        keyMistake: '',
        confidence: { score: 0.5 },
      })
    }
  }

  const faultCount = (ledger.faults || []).length
  const patternCount = (ledger.patterns || []).length
  const summary = [
    `${actors}`,
    faultCount > 0 ? `${faultCount} fault${faultCount > 1 ? 's' : ''}` : null,
    patternCount > 0 ? `${patternCount} pattern${patternCount > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ')

  return {
    quickCues: cues,
    mainDiagnosis: `Compiler preview: ${summary}. Full AI commentary loading…`,
  }
}

type FighterCandidate = {
  id: string
  label: string
  description: string}

type FrameAnalysis = {
  personCount: number
  candidates: FighterCandidate[]
  sceneSummary: string
  ruleset?: {
    value: 'boxing' | 'kickboxing' | 'muay_thai' | 'mma' | 'wrestling' | 'bjj' | 'judo' | 'karate' | 'taekwondo' | 'sumo' | 'sambo' | 'unknown'
    confidence: number
    notes?: string
  }
  fighters?: Record<
    string,
    {
      stance?: 'orthodox' | 'southpaw' | 'switch' | 'unknown'
      base?:
        | 'boxing'
        | 'kickboxing'
        | 'muay_thai'
        | 'taekwondo'
        | 'karate'
        | 'mma'
        | 'wrestling'
        | 'bjj'
        | 'judo'
        | 'sumo'
        | 'sambo'
        | 'unknown'
      archetype?:
        | 'out-fighter'
        | 'pressure'
        | 'counter'
        | 'volume'
        | 'sniper'
        | 'clinch'
        | 'grappler'
        | 'unknown'
      tells?: string[]
      gear?: {
        shinGuards?: boolean
        headgear?: boolean
        gloves?: 'boxing' | 'mma' | 'unknown'
      }
    }
  >
}

// FighterKinematics and KinematicsSnapshot imported from @/lib/kinematics

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

function normalizeChatMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((m): m is { role: string; content?: unknown } => Boolean(m && typeof m === 'object'))
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({
      role: m.role as ChatMessage['role'],
      content: typeof m.content === 'string' ? m.content : '',
    }))
}

function asChatContent(value: unknown): string {
  return sanitizeCoachText(typeof value === 'string' ? value : '')
}

type ReflexResponse = {
  cue: string
  focus?: string
}

type TrackBoxResponse = {
  ymin: number
  xmin: number
  ymax: number
  xmax: number
  confidence?: number
  label?: string
  notes?: string
}

type FocusTarget = 'A' | 'B' | 'both' | 'unsure'

type AnalysisSource = 'single_frame' | 'style_scan'

type Corner = 'blue' | 'red'

type Point2 = { x: number; y: number }

// ... (rest of the code remains the same)

type PresetTemplates = {
  gameplan: string
  counters: string
  corner: string
}

/** Built-in coaching prompts used when the shogun prompt templates are unavailable. */
const DEFAULT_PRESET_TEXTS: PresetTemplates = {
  gameplan:
    "Build me a complete gameplan for my next fight based on what you've seen in this clip: 1) my primary win condition, 2) round-by-round strategy, 3) three specific combinations to drill this week, 4) the biggest thing to avoid.",
  counters:
    "Break down the opponent's tendencies from this clip and give me a counter-strategy: 1) their three most repeated attacks or habits, 2) a specific counter for each one, 3) how to bait their favorite attack and punish it.",
  corner:
    "Act as my cornerman between rounds. Based on this clip, give me concise corner advice for the next round: maximum 3 short cues — what's working, what to change, and one thing to watch for. Keep it tight enough to deliver in 30 seconds.",
}

const PRESET_TEMPLATE_KEYS: Record<keyof PresetTemplates, string> = {
  gameplan: 'fight_preset_gameplan',
  counters: 'fight_preset_counters',
  corner: 'fight_preset_corner',
}

// Minimal Web Speech API surface — the project's TS lib config has no DOM types
// for SpeechRecognition, so we declare just what we use.
type SpeechRecognitionAlternativeLike = { transcript: string }
type SpeechRecognitionResultLike = {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternativeLike
}
type SpeechRecognitionEventLike = {
  resultIndex: number
  results: { length: number; [index: number]: SpeechRecognitionResultLike }
}
type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

function getSpeechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition || w.webkitSpeechRecognition || null
}

type CoachingMode = 'reflex' | 'strategy'

type StrategyResponse = {
  gameplan: string
  counters: string[]
  weaknesses: string[]
  opportunities: string[]
}

const INITIAL_CLIP_ANALYSIS_REQUEST = 'Analyze this fight clip in full depth. Give your complete coaching breakdown.'
const CORNER_FOR_FIGHTER: Record<'A' | 'B', Corner> = { A: 'blue', B: 'red' }

export type FightCoachExperienceProps = {
  /** Hide the compact Musashi header when the shell (nav + home hero) already provides context. */
  hideShellHeader?: boolean
  /** Load a clip picked from outside this tree (e.g. hero Upload on the home page). */
  bootstrapVideoFile?: File | null
  /** Render nothing while no clip is loaded — the page's own uploader (home
   *  hero) is then the single upload terminal. */
  collapseWhenIdle?: boolean
  /** Increment to load the built-in demo clip (used by the home hero's
   *  "try the demo" link when the idle Fight Lab surface is collapsed). */
  demoRequestToken?: number
  /** DOM id of an element (rendered by the host page, e.g. the home hero's
   *  "Musashi AI Coach" card) to portal the idle no-clip chat into — so
   *  there's one chat surface, not a second live one appearing elsewhere on
   *  the page once collapseWhenIdle is showing nothing. */
  idleChatSlotId?: string
  /** Dev fixture helper: auto-unlock/play once the boot pre-scan is ready. */
  autoPlayOnReady?: boolean
  onBootstrapConsumed?: () => void
}

/** Min time after decode before we start upload + multi-pass pre-scan. */
const CLIP_PROCESSING_MIN_MS = 400
/** Paused seek passes over the clip before unlock (pose + FightLang buffers). */
// Pre-scan passes during boot pipeline. Reduced from 3 → 1 because CPU-only laptops
// (no NVIDIA GPU) get saturated running MediaPipe 3× across an entire clip. One pass is enough
// for the FightLang compiler to produce an initial ledger; further passes run lazily on demand.
const BOOT_PIPELINE_PASSES = 1
/**
 * Never make play wait for a full local pose pass. We give the analyzer a
 * moment to attach, then let it continue in the background. On a CPU-only
 * device a full pass can take minutes, which previously looked like a frozen
 * trimmed video because the play layer intentionally swallowed all input.
 */
const BOOT_PLAYABLE_WAIT_MS = 900
/** Built-in demo clip — the bundled fight clip at `public/test-videos/`. */
const DEMO_CLIP_URL = '/test-videos/test-video-for-app.mp4'
/** How the current clip entered the Fight Lab. */
type ClipLoadSource = 'none' | 'upload' | 'restored' | 'demo'

type ClipPickOptions = {
  source?: ClipLoadSource
  sessionId?: string
  skipToast?: boolean
}

export default function FightCoachExperience({
  hideShellHeader = false,
  bootstrapVideoFile = null,
  collapseWhenIdle = false,
  demoRequestToken = 0,
  idleChatSlotId,
  autoPlayOnReady = false,
  onBootstrapConsumed,
}: FightCoachExperienceProps = {}) {
  const { toast } = useToast()
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const latestPoseRef = useRef<{ A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null }>({ A: null, B: null })
  // Video-clock time (ms) of the frame whose pose is currently in `latestPose`.
  // Used by FightOverlay to align the skeleton with the displayed frame rather
  // than trailing it by the ~60–100 ms MediaPipe detection latency.
  const overlayRedrawRef = useRef<(() => void) | null>(null)
  const latestPoseVideoTimeMsRef = useRef<number | null>(null)
  const videoContentRectRef = useRef<{ top: number; left: number; width: number; height: number } | null>(null)
  const [skeletonVisible, setSkeletonVisible] = useState<{ A: boolean; B: boolean }>({ A: true, B: true })
  const [poseDetected, setPoseDetected] = useState<{ A: boolean; B: boolean }>({ A: false, B: false })
  const [aiFocusPose, setAiFocusPose] = useState<'A' | 'B' | 'both'>('both')
  const [aiCropOn, setAiCropOn] = useState(true)
  const lastAutoAnalyzeTimeRef = useRef<number>(-1)

  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoMuted, setVideoMuted] = useState(false)
  const [fightEvidenceLedger, setFightEvidenceLedger] = useState<FightEvidenceLedger | null>(null)
  const lastLedgerIngestMsRef = useRef(0)
  const [fightLangLoading, setFightLangLoading] = useState(false)
  const [fightLangCoaching, setFightLangCoaching] = useState<any | null>(null)
  // Saved analysis id + model from the server — enables the thumbs rating row.
  const [fightLangRatingContext, setFightLangRatingContext] = useState<{ ledgerId: string; aiModel?: string | null; discipline?: string | null } | null>(null)
  const [fightLangLlmIssues, setFightLangLlmIssues] = useState<Array<{ code: string; message: string }> | null>(null)
  const [fightLangOverlayAnnotations, setFightLangOverlayAnnotations] = useState<FightLangOverlayAnnotation[] | null>(null)
  // Phase 1 + 2: AI guard response state. When the server returns 401/402/429/503
  // we surface a polished card in the coaching column instead of letting the
  // request silently fail or spam the toast system.
  const [aiQuotaState, setAiQuotaState] = useState<AiQuotaState | null>(null)
  const fightLangPoseFramesRef = useRef<FightLangPoseFrame[]>([])
  const pose3DFramesRef = useRef<FightLangPoseFrame[]>([])
  /** One FightLang buffer sample per ~100ms of *video* time (wall-clock throttle broke seek pre-scan). */
  const lastFightLangVideoBucketRef = useRef<number | null>(null)
  const clipEndPassCountRef = useRef(0)
  const lastFullClipEndRunRef = useRef(0)
  const [clipDurationSec, setClipDurationSec] = useState(0)
  const [autoAnalyzeOnPause, setAutoAnalyzeOnPause] = useState(false)
  // EXPLICIT opt-in for Gemini coaching auto-loop. OFF by default — prevents
  // runaway API spend (previously cost ~$50-100/session with no user consent).
  // User must click "Start Coaching" to begin and can stop anytime.
  const [coachingEnabled, setCoachingEnabled] = useState(false)
  const [coachingConfirmOpen, setCoachingConfirmOpen] = useState(false)
  const [llmCallCount, setLlmCallCount] = useState(0)
  const LLM_CALL_CAP = 20 // ~$1 worst case at $0.05/call
  // Hardware profile — resolved on the client after mount so SSR and the first
  // client render agree (otherwise the tier badge flips between BALANCED/LITE/MAX
  // and React throws a hydration mismatch). We start from SERVER_DEFAULT_PROFILE
  // (which is what getPerformanceProfile() also returns server-side) and upgrade
  // to the real probe in a layout effect so any downstream consumer sees the
  // detected tier on the very next paint.
  const [hwProfile, setHwProfile] = useState(SERVER_DEFAULT_PROFILE)
  const hwProfileRef = useRef(SERVER_DEFAULT_PROFILE)
  hwProfileRef.current = hwProfile
  useEffect(() => {
    const detected = getPerformanceProfile()
    if (detected !== hwProfileRef.current) {
      setHwProfile(detected)
    }
  }, [])
  const [coachBannerIdx, setCoachBannerIdx] = useState(0)
  const [coachPreviewCoaching, setCoachPreviewCoaching] = useState<{ quickCues: Array<Record<string, unknown>>; mainDiagnosis?: string } | null>(null)
  const [breakdownSlowMo, setBreakdownSlowMo] = useState(false)
  /** True while FightAnalyzer seeks the paused video to pre-fill pose / FightLang (avoids “random jumps” with no context). */
  const [fightLangPreScanBusy, setFightLangPreScanBusy] = useState(false)
  /** False from file pick until user clicks the explicit ▶ Play button — native controls hidden, play blocked. */
  const [playbackUnlocked, setPlaybackUnlocked] = useState(false)
  /** Hard-gate: checked synchronously inside native play/playing listeners so there is no React-render race. */
  const playbackUnlockedRef = useRef(false)
  /** True once the boot pipeline has reached "safe to play" — the ▶ Play button appears only when this flips true. */
  const [bootPipelineReady, setBootPipelineReady] = useState(false)
  const [bootPipelineMessage, setBootPipelineMessage] = useState('')
  const clipProcessingMinUntilRef = useRef(0)
  const prescanBootResolveRef = useRef<(() => void) | null>(null)
  const bootPipelineRunningRef = useRef(false)
  /** True after upload success kicks off runInitialClipAnalysis + stream (avoids duplicate prepare at boot end). */
  const clipAnalysisPipelineStartedRef = useRef(false)
  /** Apply lock state to React + ref in one call (ref is checked synchronously by native play listener). */
  const applyPlaybackLock = useCallback((unlocked: boolean) => {
    playbackUnlockedRef.current = unlocked
    setPlaybackUnlocked(unlocked)
  }, [])
  /** Measured boot outcomes — reset on new clip; read before unlock. */
  const bootMediaOutcomeRef = useRef<MediaPreloadOutcome | null>(null)
  const bootLastPassTotalStepsRef = useRef(0)
  const bootLastPassFramesCompletedRef = useRef(0)
  /** Last wall time the pose pass reported progress — drives the stall watchdog. */
  const bootProgressAtRef = useRef(0)
  const [bootVerificationSummary, setBootVerificationSummary] = useState<string | null>(null)
  // Frame count of the per-frame deep track (computed or restored from cache).
  // Surfaced in the boot summary so the small sparse keyframe count isn't
  // mistaken for the full analysis coverage.
  const [deepTrackFrames, setDeepTrackFrames] = useState<number | null>(null)
  // Which pose engine produced the deep track (rtmpose-cloud = primary for
  // uploads, mediapipe-local = preview/fallback) + its quality grade. Sent with
  // every analyze call so the coach softens claims on fallback/weak pose data.
  const [poseEngineInfo, setPoseEngineInfo] = useState<PoseEngineInfo | null>(null)
  const poseEngineInfoRef = useRef<PoseEngineInfo | null>(null)
  const [poseQualityOverride, setPoseQualityOverride] = useState(false)
  const poseQualityOverrideRef = useRef(false)
  poseQualityOverrideRef.current = poseQualityOverride
  const earlyCompileOnceRef = useRef(false)
  /** Fires the AI-coaching consent dialog once per clip, the moment play is first pressed — instead of requiring the user to dig into Advanced Controls. */
  const autoCoachPromptShownRef = useRef(false)
  const fastCompileHashRef = useRef<string | null>(null)
  const [embedSnippetCount, setEmbedSnippetCount] = useState<number | null>(null)
  const fightLangFastErrorToastRef = useRef(false)
  const [pipelineStats, setPipelineStats] = useState<{
    poseFrames: number; actors: string[]; events: number; eventKinds: Record<string, number>;
    faults: number; patterns: number; overlayAnnotations: number; compilerOverlays: number;
    llmOverlays: number; retrievalSnippets: number; retrievalTopScore: number | null; llmEnabled: boolean;
  } | null>(null)
  const [playbackState, setPlaybackState] = useState<PlaybackSnapshot>(EMPTY_PLAYBACK_SNAPSHOT)
  const [preScanProgress, setPreScanProgress] = useState<PreScanProgress | null>(null)
  const [preScanDetections, setPreScanDetections] = useState({ samples: 0, A: 0, B: 0, both: 0 })
  const [poseFrameCount, setPoseFrameCount] = useState(0)
  const [lastPoseSampleMs, setLastPoseSampleMs] = useState<number | null>(null)
  const [bootWarnings, setBootWarnings] = useState<string[]>([])
  const [mediaErrorMessage, setMediaErrorMessage] = useState<string | null>(null)
  const [lastCompileError, setLastCompileError] = useState<string | null>(null)

  const [reflexOn, setReflexOn] = useState(false)
  const [reflexCadenceMs, setReflexCadenceMs] = useState(1500)
  const [reflexLoading, setReflexLoading] = useState(false)
  const [reflexCue, setReflexCue] = useState<string | null>(null)
  const [reflexFocus, setReflexFocus] = useState<string | null>(null)
  const [reflexAtMs, setReflexAtMs] = useState<number | null>(null)

  const [trackOn, setTrackOn] = useState(false)
  const [trackTarget, setTrackTarget] = useState('lowered lead hand')
  const [trackCadenceMs, setTrackCadenceMs] = useState(1200)
  const [trackLoading, setTrackLoading] = useState(false)
  const [trackBox, setTrackBox] = useState<TrackBoxResponse | null>(null)
  const [trackAtMs, setTrackAtMs] = useState<number | null>(null)

  const reflexInFlightRef = useRef(false)
  const reflexTimerRef = useRef<number | null>(null)
  const reflexAbortRef = useRef<AbortController | null>(null)
  const lastReflexReqMsRef = useRef<number>(0)
  const lastReflexToastMsRef = useRef<number>(0)

  const trackInFlightRef = useRef(false)
  const trackTimerRef = useRef<number | null>(null)
  const trackAbortRef = useRef<AbortController | null>(null)
  const lastTrackReqMsRef = useRef<number>(0)
  const lastTrackToastMsRef = useRef<number>(0)

  const [poseOverlayOn, setPoseOverlayOn] = useState(true)
  // Off by default — raw bw/bw-per-second numbers are meaningless to a fighter
  // reading feedback. Opt-in only, via the checkbox in Advanced Controls.
  const [kinematicsHudOn, setKinematicsHudOn] = useState(false)
  const [kinematicsUi, setKinematicsUi] = useState<KinematicsSnapshot | null>(null)
  const kinematicsRef = useRef<KinematicsSnapshot | null>(null)
  const [latestPose, setLatestPose] = useState<{ A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null }>({
    A: null,
    B: null,
  })
  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<FrameAnalysis | null>(null)
  const [analysisSource, setAnalysisSource] = useState<AnalysisSource | null>(null)
  const [analysisAtTime, setAnalysisAtTime] = useState<number | null>(null)
  const [selectedFighterId, setSelectedFighterId] = useState<string | null>(null)
  const [focusTarget, setFocusTarget] = useState<FocusTarget>('both')
  // Sport selection step — routes the coach-brain sport file on the server.
  // '' = auto-detect (global coach rules only). Persisted so returning
  // athletes don't re-pick every clip; the picker still opens per upload.
  const [selectedSport, setSelectedSport] = useState<string>('')
  const selectedSportRef = useRef(selectedSport)
  selectedSportRef.current = selectedSport
  const [selectedClipType, setSelectedClipType] = useState<string>('')
  const selectedClipTypeRef = useRef(selectedClipType)
  selectedClipTypeRef.current = selectedClipType
  const [sportPickerOpen, setSportPickerOpen] = useState(false)
  // Fresh uploads prefer a validated physical tier-window artifact. The
  // original file and chosen timestamps stay available as an explicit server
  // trim fallback when a phone cannot safely encode the local artifact.
  const [trimSelection, setTrimSelection] = useState<{
    file: File
    opts?: ClipPickOptions
  } | null>(null)
  // Fresh uploads wait for the confirmed ruleset before choosing a pipeline.
  // BJJ, wrestling, and judo use tape-first analysis rather than pose mapping.
  const pendingBootFileRef = useRef<File | null>(null)
  const currentFightClipAiMetadata = useCallback(
    () =>
      buildFightClipAiMetadata({
        sport: selectedSportRef.current,
        clipType: selectedClipTypeRef.current,
      }),
    [],
  )
  const isPoseQualitySpendBlocked = useCallback(() => {
    if (poseQualityOverrideRef.current) return false
    return poseEngineInfoRef.current?.quality?.recommendation === 'request_better_clip'
  }, [])
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('musashiSelectedSport')
      if (stored) setSelectedSport(stored)
      const storedClipType = window.localStorage.getItem('musashiSelectedClipType')
      if (storedClipType) setSelectedClipType(storedClipType)
    } catch { /* private mode */ }
  }, [])
  const pickSport = useCallback((sport: string) => {
    // A quick tap on a sport followed by “Start review” must not read the
    // previous render's value.
    selectedSportRef.current = sport
    setSelectedSport(sport)
    try {
      if (sport) window.localStorage.setItem('musashiSelectedSport', sport)
      else window.localStorage.removeItem('musashiSelectedSport')
    } catch { /* private mode */ }

    if (isVisionFirstSport(sport)) {
      // Grappling: skeleton is noise on the ground — tape is the coaching source.
      // Upload is kicked by the vision-first effect once duration is known.
      setPoseOverlayOn(false)
      visionUploadAttemptedRef.current = false
    } else if (sport) {
      // Striking / MMA: keep prior skeleton-on default.
      setPoseOverlayOn(true)
    }
  }, [])
  const pickClipType = useCallback((clipType: string) => {
    selectedClipTypeRef.current = clipType
    setSelectedClipType(clipType)
    try {
      if (clipType) window.localStorage.setItem('musashiSelectedClipType', clipType)
      else window.localStorage.removeItem('musashiSelectedClipType')
    } catch { /* private mode */ }
  }, [])
  // Click-to-select fighters (opt-in). OFF by default → normal playback is
  // untouched, so this cannot regress existing behavior.
  const [selectMode, setSelectMode] = useState(false)
  const [myCorner, setMyCorner] = useState<Corner>('blue')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [coachingLoading, setCoachingLoading] = useState(false)
  const [chatInput, setChatInput] = useState('')
  const [noClipChatCredits, setNoClipChatCredits] = useState<NoClipChatBalance | null>(null)
  // Target for the idle no-clip chat portal (see idleChatSlotId) — looked up
  // client-side since the slot is a plain DOM node the host page renders.
  const [idleChatSlotEl, setIdleChatSlotEl] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!idleChatSlotId) return
    setIdleChatSlotEl(document.getElementById(idleChatSlotId))
  }, [idleChatSlotId])
  const [initialAnalysisLoading, setInitialAnalysisLoading] = useState(false)
  const [initialAnalysisReady, setInitialAnalysisReady] = useState(false)
  const [initialAnalysisStatus, setInitialAnalysisStatus] = useState<string | null>(null)
  const [speakReplies, setSpeakReplies] = useState(false)
  const [voiceListening, setVoiceListening] = useState(false)
  const [voiceInterim, setVoiceInterim] = useState('')
  // Resolved in an effect (not at render time) so SSR markup and first client
  // render agree — avoids a hydration mismatch on the mic button.
  const [voiceSupported, setVoiceSupported] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  // Text already committed to the chat input before/at the start of this voice
  // session; final+interim transcripts get appended after it.
  const voiceBaseTextRef = useRef('')
  const voiceFinalTextRef = useRef('')
  const [localSessions, setLocalSessions] = useState<LocalFightSession[]>([])
  const [localSessionId, setLocalSessionId] = useState('')
  const localSessionIdRef = useRef('')
  const [localStatus, setLocalStatus] = useState<string | null>(null)
  const [clipLoadSource, setClipLoadSource] = useState<ClipLoadSource>('none')
  const clipLoadSourceRef = useRef<ClipLoadSource>('none')
  const [demoClipLoading, setDemoClipLoading] = useState(false)
  const autoRestoreAttemptedRef = useRef(false)
  const clipPersistInFlightRef = useRef(false)
  const [localRecordOn, setLocalRecordOn] = useState(false)
  const [localRawLandmarksOn, setLocalRawLandmarksOn] = useState(false)
  const localImportInputRef = useRef<HTMLInputElement | null>(null)
  const localKinematicsSeriesRef = useRef<KinematicsSnapshot[]>([])
  const localPoseFramesRef = useRef<any[]>([])
  const lastLocalKinMsRef = useRef(0)
  const lastLocalPoseRawMsRef = useRef(0)
  const autoExchangeDoneRef = useRef(false)
  const presetTemplates = useRef<PresetTemplates | null>(null)
  const { user } = useAuth()
  const isShogun = user?.role === 'shogun'
  const [isPro, setIsPro] = useState(false)
  // Local auth-bypass (`id: 'dev'`) is shogun for admin APIs but must still
  // respect the free/pro analysis-window cap on long clips.
  const maxClipSec =
    user?.id === 'dev'
      ? PRO_MAX_VIDEO_SEC
      : isShogun
        ? SHOGUN_MAX_VIDEO_SEC
        : isPro
          ? PRO_MAX_VIDEO_SEC
          : FREE_MAX_VIDEO_SEC
  const [videoCredits, setVideoCredits] = useState<VideoCreditBalance | null>(null)
  const [analysisWindow, setAnalysisWindow] = useState({ startSec: 0, endSec: 0 })
  const analysisWindowRef = useRef({ startSec: 0, endSec: 0 })
  analysisWindowRef.current = analysisWindow

  const applyAnalysisWindow = useCallback((startSec: number, endSec: number) => {
    const next = { startSec, endSec }
    analysisWindowRef.current = next
    setAnalysisWindow(next)
  }, [])

  const ensureAnalysisWindow = useCallback((fileDurationSec?: number) => {
    if (analysisWindowRef.current.endSec > analysisWindowRef.current.startSec) return
    const dur =
      Number(fileDurationSec) > 0
        ? Number(fileDurationSec)
        : Number(videoRef.current?.duration) || clipDurationSec || maxClipSec
    const win = defaultTrimWindow(dur, maxClipSec)
    applyAnalysisWindow(win.start, win.end)
  }, [applyAnalysisWindow, clipDurationSec, maxClipSec])

  const selectedWindowDurationSec = useCallback(() => {
    ensureAnalysisWindow()
    return clipWindowDurationSec(
      analysisWindowRef.current.startSec,
      analysisWindowRef.current.endSec,
      Number(videoRef.current?.duration) || clipDurationSec,
    )
  }, [clipDurationSec, ensureAnalysisWindow])

  useEffect(() => {
    if (!user || user.role === 'shogun') {
      setIsPro(user?.role === 'shogun')
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/billing/status', { credentials: 'include' })
        if (!res.ok) {
          if (!cancelled) setIsPro(false)
          return
        }
        const data = (await res.json()) as { active?: boolean }
        if (!cancelled) setIsPro(Boolean(data.active))
      } catch {
        if (!cancelled) setIsPro(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user])

  const refreshVideoCredits = useCallback(async () => {
    if (!user) {
      setVideoCredits(null)
      return
    }
    try {
      const res = await fetch('/api/video-credits', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json() as Partial<VideoCreditBalance>
      if (
        typeof data.limit === 'number' &&
        typeof data.used === 'number' &&
        typeof data.reserved === 'number' &&
        typeof data.remaining === 'number' &&
        (data.tier === 'free' || data.tier === 'pro' || data.tier === 'shogun')
      ) {
        setVideoCredits(data as VideoCreditBalance)
      }
    } catch {
      // Quota display is informational; the server remains the source of truth.
    }
  }, [user])

  useEffect(() => {
    void refreshVideoCredits()
  }, [refreshVideoCredits])

  const refreshNoClipChatCredits = useCallback(async () => {
    if (!user) {
      setNoClipChatCredits(null)
      return
    }
    try {
      const res = await fetch('/api/chat-credits', { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json() as Partial<NoClipChatBalance>
      const nullableNumber = (value: unknown) => value === null || typeof value === 'number'
      if (
        (data.tier === 'free' || data.tier === 'pro' || data.tier === 'shogun') &&
        nullableNumber(data.limit) &&
        typeof data.used === 'number' &&
        nullableNumber(data.remaining) &&
        typeof data.day === 'string' &&
        typeof data.resetsAt === 'string'
      ) {
        setNoClipChatCredits(data as NoClipChatBalance)
      }
    } catch {
      // Informational display only; the POST route remains authoritative.
    }
  }, [user])

  useEffect(() => {
    void refreshNoClipChatCredits()
  }, [refreshNoClipChatCredits])

  // YouTube-style breakdown
  const [breakdownLoading, setBreakdownLoading] = useState(false)
  const [breakdownResult, setBreakdownResult] = useState<{
    videoTitle?: string; introHook?: string; conclusion?: string;
    keyTakeaways?: string[]; fullScript?: string;
    segments?: Array<{ id: string; startMs: number; endMs: number; title: string; narration: string; onScreenText: string; focusActor: string; tags: string[] }>;
  } | null>(null)
  const [breakdownStyle, setBreakdownStyle] = useState<'commentary' | 'coaching' | 'scouting'>('commentary')

  const [coachingMode, setCoachingMode] = useState<CoachingMode>('reflex')
  const [strategyLoading, setStrategyLoading] = useState(false)
  const [currentStrategy, setCurrentStrategy] = useState<StrategyResponse | null>(null)
  
  // Phase 2: Exchange and Pattern Analysis
  const [exchangeTimeline, setExchangeTimeline] = useState<ExchangeTimeline | null>(null)
  const [patternAnalysis, setPatternAnalysis] = useState<PatternAnalysisResult | null>(null)
  const [analyzingExchanges, setAnalyzingExchanges] = useState(false)
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [uploadByteProgress, setUploadByteProgress] = useState<UploadProgress | null>(null)
  const [ingestionStage, setIngestionStage] = useState<VideoIngestionStage>('selected')
  const nativeUploadErrorRef = useRef<string | null>(null)
  const nativeUploadAbortRef = useRef<AbortController | null>(null)
  const [geminiFileUri, setGeminiFileUri] = useState<string | null>(null)
  const geminiFileUriRef = useRef<string | null>(null)
  /** Prevents vision-first upload effect from retry-spamming after a failure. */
  const visionUploadAttemptedRef = useRef(false)
  /** Always points at the latest uploadVideoForNativeAnalysis (defined later in this component). */
  const uploadVideoForNativeAnalysisRef = useRef<
    (fileOverride?: File, opts?: { silentToast?: boolean }) => Promise<string | null | undefined>
  >(async () => null)
  /** Stable across retries for one picked clip; created client-side, enforced server-side. */
  const videoAnalysisSessionIdRef = useRef<string | null>(null)
  const videoFileRef = useRef<File | null>(null)
  // The object URL currently backing the player — revoked on re-pick/unmount
  // so repeated uploads don't leak whole clips in memory.
  const videoObjectUrlRef = useRef<string | null>(null)
  // Isolated + fail-safe: R2 asset ref for the current clip, so it's reviewable/labelable later.
  const clipAssetRefRef = useRef<string | null>(null)
  const [clipStorageStatus, setClipStorageStatus] = useState<'idle' | 'saving' | 'saved' | 'unavailable'>('idle')
  const [compiledLedger, setCompiledLedger] = useState<Record<string, unknown> | null>(null)

  // Streaming auto-analysis (SSE from /api/fight action:analyze_video_stream)
  const [streamAnalysisPhase, setStreamAnalysisPhase] = useState<'idle' | 'analyzing' | 'complete' | 'error'>('idle')
  const [streamAnalysisText, setStreamAnalysisText] = useState('')
  const [streamEvidenceLedger, setStreamEvidenceLedger] = useState<Record<string, unknown> | null>(null)
  const streamAbortRef = useRef<AbortController | null>(null)

  // Retrieval results from streaming analysis (Gemini Embed + D1 knowledge base)
  type RetrievalSnippet = { docId: string; namespace: string; score: number; text: string; title: string | null; segmentStartMs: number | null; segmentEndMs: number | null }
  const [autoRetrieval, setAutoRetrieval] = useState<{ snippets: RetrievalSnippet[]; queryEmbeddingModel?: string } | null>(null)

  // MediaPipe PoseLandmarker initialization and pose detection are fully
  // handled by FightAnalyzer — the legacy initPoseLandmarker and
  // detectSecondFighter have been removed.

  useEffect(() => {
    autoExchangeDoneRef.current = false
  }, [videoUrl])

  // Detect Web Speech API support on the client and tear down any live
  // recognition session on unmount.
  useEffect(() => {
    setVoiceSupported(!!getSpeechRecognitionCtor())
    return () => {
      const rec = recognitionRef.current
      recognitionRef.current = null
      if (rec) {
        try {
          rec.onresult = null
          rec.onend = null
          rec.onerror = null
          rec.abort()
        } catch {
          void 0
        }
      }
    }
  }, [])

  // Load preset prompt templates once. The /api/shogun/prompts GET is
  // shogun-only, so non-shogun users (or any fetch failure) silently keep the
  // built-in defaults.
  useEffect(() => {
    if (!isShogun) return
    let cancelled = false
    const load = async () => {
      const loaded: Partial<PresetTemplates> = {}
      await Promise.all(
        (Object.keys(PRESET_TEMPLATE_KEYS) as Array<keyof PresetTemplates>).map(async (kind) => {
          try {
            const res = await fetch(`/api/shogun/prompts?key=${encodeURIComponent(PRESET_TEMPLATE_KEYS[kind])}`)
            if (!res.ok) return
            const bundle = (await res.json()) as { active?: { content?: string } | null }
            const content = typeof bundle?.active?.content === 'string' ? bundle.active.content.trim() : ''
            if (content) loaded[kind] = content
          } catch {
            void 0
          }
        })
      )
      if (!cancelled && Object.keys(loaded).length > 0) {
        presetTemplates.current = { ...DEFAULT_PRESET_TEXTS, ...presetTemplates.current, ...loaded }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [isShogun])

  // Power-user keyboard shortcuts: Space=play/pause, Arrows=seek, F=fullscreen
  useVideoKeyboardShortcuts({
    videoRef,
    enabled: !!videoUrl && playbackUnlocked,
    onPlayPause: () => {
      const v = videoRef.current
      if (!v) return
      if (v.paused) {
        v.play().catch(() => { /* AbortError if pause() races */ })
      } else {
        v.pause()
      }
    },
    seekSeconds: 5,
  })

  const syncPlaybackState = useCallback((video: HTMLVideoElement | null = videoRef.current) => {
    if (!video) {
      setPlaybackState(EMPTY_PLAYBACK_SNAPSHOT)
      return
    }
    setPlaybackState({
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      paused: video.paused,
      ended: video.ended,
      readyState: video.readyState,
      videoWidth: video.videoWidth || 0,
      videoHeight: video.videoHeight || 0,
      bufferedPct: getBufferedPercent(video),
    })
  }, [])

  useEffect(() => {
    if (!videoUrl) {
      setPlaybackState(EMPTY_PLAYBACK_SNAPSHOT)
      return
    }
    const v = videoRef.current
    if (!v) return
    const sync = () => syncPlaybackState(v)
    const events = [
      'loadedmetadata',
      'loadeddata',
      'canplay',
      'progress',
      'timeupdate',
      'play',
      'playing',
      'pause',
      'seeked',
      'ended',
      'volumechange',
      'error',
    ] as const
    events.forEach((eventName) => v.addEventListener(eventName, sync))
    sync()
    return () => {
      events.forEach((eventName) => v.removeEventListener(eventName, sync))
    }
  }, [syncPlaybackState, videoUrl])

  // Until playback is unlocked, keep the element paused. Listeners read playbackUnlockedRef
  // SYNCHRONOUSLY so there's no React-state race. We attach them ONCE per videoUrl (not once per
  // lock toggle) so they survive the transition from locked → unlocked without a gap.
  useEffect(() => {
    if (!videoUrl) return
    const v = videoRef.current
    if (!v) return

    const hardPause = () => {
      if (playbackUnlockedRef.current) return
      try {
        v.pause()
      } catch {
        void 0
      }
    }

    // Force-pause on EVERY event the browser might use to advance playback.
    const events = ['play', 'playing', 'loadeddata', 'canplay', 'canplaythrough', 'timeupdate'] as const
    events.forEach((ev) => v.addEventListener(ev, hardPause))

    // Initial enforcement (covers the case where the element mounted already primed to play).
    hardPause()

    return () => {
      events.forEach((ev) => v.removeEventListener(ev, hardPause))
    }
  }, [videoUrl])

  // When playbackUnlocked flips false (New Video / error), make sure the element is paused right now.
  useLayoutEffect(() => {
    const v = videoRef.current
    if (!v || !videoUrl || playbackUnlocked) return
    try {
      v.pause()
    } catch {
      void 0
    }
  }, [videoUrl, playbackUnlocked])

  useEffect(() => {
    if (!autoPlayOnReady || !videoUrl || !bootPipelineReady || playbackUnlocked) return
    const v = videoRef.current
    if (!v) return
    let cancelled = false
    let retryTimer: number | null = null
    applyPlaybackLock(true)
    setVideoMuted(true)
    v.muted = true
    try {
      if (v.currentTime > 0) v.currentTime = 0
    } catch {
      void 0
    }

    const tryPlay = () => {
      if (cancelled) return
      const current = videoRef.current
      if (!current) return
      current.muted = true
      if (current.readyState < 2) {
        retryTimer = window.setTimeout(tryPlay, 250)
        return
      }
      current.play().catch(() => {
        // Dev fixture autoplay can still be blocked briefly while the browser
        // settles the blob video. Keep retrying so the test URL starts without
        // needing a manual click, but only for this explicit fixture mode.
        if (!cancelled) retryTimer = window.setTimeout(tryPlay, 500)
      })
    }

    tryPlay()
    return () => {
      cancelled = true
      if (retryTimer !== null) window.clearTimeout(retryTimer)
    }
  }, [applyPlaybackLock, autoPlayOnReady, bootPipelineReady, playbackUnlocked, videoUrl])

  /** Records last-pass progress so verifyBootReadiness can confirm the boot
   *  pre-scan actually completed. */
  const recordPreScanFrame = useCallback(
    (info: { passIndex: number; passCount: number; stepIndex: number; totalSteps: number; videoTimeSec: number }) => {
      bootProgressAtRef.current = Date.now()
      if (info.passIndex !== info.passCount - 1) return
      // The dense tracking pass reports a larger totalSteps than the sparse
      // pass — track the largest so progress reads N/dense-total, not N/24.
      // A larger total means a NEW pass just started: use this frame's own
      // stepIndex as the completed count (not an accumulator carried over
      // from the previous pass), or the sparse pass's tail frames inflate
      // the dense-pass percentage and the overlay reads "100%" while the
      // dense loop still has frames left to process.
      if (info.totalSteps > bootLastPassTotalStepsRef.current) {
        bootLastPassTotalStepsRef.current = info.totalSteps
      }
      bootLastPassFramesCompletedRef.current = info.stepIndex + 1
      setPreScanProgress({
        passIndex: info.passIndex,
        passCount: info.passCount,
        stepIndex: info.stepIndex,
        totalSteps: info.totalSteps,
        completed: bootLastPassFramesCompletedRef.current,
      })
    },
    []
  )

  // Compute the video's visible content rect inside its CSS box (accounts for
  // letterboxing from object-fit:contain and browser controls bar).
  const getVideoContentRect = useCallback(() => {
    const video = videoRef.current
    if (!video) return null
    const vw = video.videoWidth
    const vh = video.videoHeight
    const cw = video.clientWidth
    const ch = video.clientHeight
    if (!vw || !vh || !cw || !ch) return null

    const scale = Math.min(cw / vw, ch / vh)
    const drawnW = vw * scale
    const drawnH = vh * scale
    const offsetX = (cw - drawnW) / 2
    const offsetY = (ch - drawnH) / 2
    return { offsetX, offsetY, drawnW, drawnH, cw, ch, vw, vh, scale }
  }, [])

  // Legacy drawAlignedSkeleton, drawCachedPose, renderPoseOnce, runPoseDetection
  // have been removed — FightAnalyzer + FightOverlay handle all pose drawing now.



  // Pose detection + kinematics is handled by `FightAnalyzer`.

  // Helpers (minimal stubs for reflex loop)
  const captureFrameAsBlob = useCallback(async (opts?: { purpose?: 'reflex' | 'track' }): Promise<Blob> => {
    const video = videoRef.current
    if (!video) throw new Error('Video not ready')
    const vw = Math.max(1, video.videoWidth || 0)
    const vh = Math.max(1, video.videoHeight || 0)

    const shouldCrop = Boolean(opts?.purpose === 'reflex' && aiCropOn && aiFocusPose !== 'both')
    const pose = shouldCrop ? latestPoseRef.current[aiFocusPose === 'A' ? 'A' : 'B'] : null

    const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
    const bboxFromPose = (lms: NormalizedLandmark[]) => {
      let minX = 1,
        minY = 1,
        maxX = 0,
        maxY = 0
      for (const lm of lms) {
        if (!lm) continue
        if (lm.visibility != null && lm.visibility < 0.35) continue
        minX = Math.min(minX, lm.x)
        minY = Math.min(minY, lm.y)
        maxX = Math.max(maxX, lm.x)
        maxY = Math.max(maxY, lm.y)
      }
      if (!(maxX > minX && maxY > minY)) return null
      const padX = (maxX - minX) * 0.2
      const padY = (maxY - minY) * 0.25
      const x1 = clamp(minX - padX, 0, 1)
      const y1 = clamp(minY - padY, 0, 1)
      const x2 = clamp(maxX + padX, 0, 1)
      const y2 = clamp(maxY + padY, 0, 1)
      return { x1, y1, x2, y2 }
    }

    const bbox = pose ? bboxFromPose(pose) : null
    const sx = bbox ? Math.floor(bbox.x1 * vw) : 0
    const sy = bbox ? Math.floor(bbox.y1 * vh) : 0
    const sw = bbox ? Math.max(1, Math.floor((bbox.x2 - bbox.x1) * vw)) : vw
    const sh = bbox ? Math.max(1, Math.floor((bbox.y2 - bbox.y1) * vh)) : vh

    const canvas = document.createElement('canvas')
    canvas.width = sw
    canvas.height = sh
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh)
    const blob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to capture frame'))), 'image/jpeg', 0.9)
    })
    return blob
  }, [aiCropOn, aiFocusPose])
  const kinematicsForAi = (): KinematicsSnapshot | null => kinematicsRef.current
  const redirectToLoginIfUnauthorized = (res: Response): boolean => {
    if (res.status !== 401) return false
    if (typeof window !== 'undefined') {
      window.location.href = '/welcome'
    }
    return true
  }
  const speakText = useCallback((text: string) => {
    if (!speakReplies) return
    if (typeof window === 'undefined') return
    const w = window as any
    if (!w.speechSynthesis) return
    const t = String(text || '').trim()
    if (!t) return
    try {
      w.speechSynthesis.cancel()
      const utter = new SpeechSynthesisUtterance(t)
      utter.rate = 1.03
      utter.pitch = 0.92
      w.speechSynthesis.speak(utter)
    } catch {
      void 0
    }
  }, [speakReplies])
  const onPickVideo = (file: File, opts?: ClipPickOptions) => {
    nativeUploadAbortRef.current?.abort()
    nativeUploadAbortRef.current = null
    setUploadingVideo(false)
    setUploadProgress(0)
    setUploadByteProgress(null)
    const source: ClipLoadSource = opts?.source ?? 'upload'
    const sessionId = opts?.sessionId ?? `local-${Date.now()}`
    videoAnalysisSessionIdRef.current =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `video-${Date.now()}-${Math.random().toString(36).slice(2)}`
    clipProcessingMinUntilRef.current = Date.now() + CLIP_PROCESSING_MIN_MS

    // Lock playback before attaching blob URL so the first paint never shows an unlocked player.
    applyPlaybackLock(false)
    // Slo-mo is an opt-in replay aid. Never carry it from a previous clip into
    // a new upload, where it makes the boot/preparation state look broken.
    setBreakdownSlowMo(false)
    try {
      const previousVideo = videoRef.current
      if (previousVideo) {
        previousVideo.pause()
        previousVideo.playbackRate = 1
      }
    } catch {
      void 0
    }
    setBootPipelineReady(false)
    setIngestionStage('selected')
    nativeUploadErrorRef.current = null
    setClipLoadSource(source)
    clipLoadSourceRef.current = source
    setBootPipelineMessage(
      source === 'restored'
        ? 'Restoring your last clip…'
        : source === 'demo'
          ? 'Loading demo clip…'
          : 'Starting…'
    )

    if (!opts?.skipToast) {
      toast({
        title:
          source === 'restored'
            ? 'Restored your last clip'
            : source === 'demo'
              ? 'Demo clip loaded'
              : 'Clip selected',
        description:
          source === 'restored'
            ? `${file.name} — running pre-scan, then click Play`
            : `${file.name.slice(0, 80)}${file.name.length > 80 ? '…' : ''} — preparing…`,
      })
    }

    setVideoFile(file)
    videoFileRef.current = file
    // The background archive starts only after the ruleset is confirmed. That
    // prevents a BJJ upload from racing its required tape-first upload.
    clipAssetRefRef.current = null
    const visionFirstPick = isVisionFirstSport(selectedSportRef.current)
    setClipStorageStatus('idle')
    setGeminiFileUri(null)
    geminiFileUriRef.current = null
    visionUploadAttemptedRef.current = false
    if (videoObjectUrlRef.current) {
      try { URL.revokeObjectURL(videoObjectUrlRef.current) } catch { void 0 }
    }
    const url = URL.createObjectURL(file)
    videoObjectUrlRef.current = url
    setVideoUrl(url)
    setVideoMuted(false)
    setFightEvidenceLedger(createEmptyLedger())
    lastLedgerIngestMsRef.current = 0

    // THE SIZZLE - Auto-enable magic
    // Vision-first sports (BJJ / wrestling / judo): skeleton OFF — tape coaches.
    // Striking / MMA / auto-detect: skeleton ON as before.
    setPoseOverlayOn(!visionFirstPick)
    setSkeletonVisible({ A: true, B: true })  // Show both fighters
    setFocusTarget('both')                     // AI watches both
    setAiFocusPose('both')                     // Overlay focus resets to both
    setReflexOn(false)                         // Keep API-backed loops opt-in per clip
    setTrackOn(false)
    setTrackBox(null)
    setTrackAtMs(null)
    setCoachingEnabled(false)
    setLlmCallCount(0)
    setKinematicsHudOn(false)                  // Raw bw/bw-per-second numbers are dev-only; opt-in via Advanced Controls

    // Reset analysis
    setAnalysis(null)
    setAnalysisSource(null)
    setAnalysisAtTime(null)
    setSelectedFighterId(null)
    setMessages([])
    setCurrentStrategy(null)
    setExchangeTimeline(null)
    setPatternAnalysis(null)
    setChatInput('')
    setInitialAnalysisReady(false)
    setInitialAnalysisStatus(null)
    setLocalSessionId(sessionId)
    localSessionIdRef.current = sessionId
    poseEngineInfoRef.current = null
    setPoseEngineInfo(null)
    setPoseQualityOverride(false)
    fightLangPoseFramesRef.current = []
    lastFightLangVideoBucketRef.current = null
    clipEndPassCountRef.current = 0
    lastFullClipEndRunRef.current = 0
    earlyCompileOnceRef.current = false
    autoCoachPromptShownRef.current = false
    setClipDurationSec(0)
    // Do NOT clear analysisWindow here — ClipTimeWindowSlider sets
    // source start/end timestamps immediately before calling onPickVideo.
    // Clearing to 0,0 made selectedWindowDurationSec() fall back to full-file
    // length and triggered VIDEO_DURATION_EXCEEDED ("clip too long") on upload.
    setCoachPreviewCoaching(null)
    setEmbedSnippetCount(null)
    fightLangFastErrorToastRef.current = false
    setFightLangPreScanBusy(false)
    setPipelineStats(null)
    setPlaybackState(EMPTY_PLAYBACK_SNAPSHOT)
    setPreScanProgress(null)
    setPreScanDetections({ samples: 0, A: 0, B: 0, both: 0 })
    setPoseFrameCount(0)
    setLastPoseSampleMs(null)
    setBootWarnings([])
    setMediaErrorMessage(null)
    setLastCompileError(null)
    clipAnalysisPipelineStartedRef.current = false
    setBootVerificationSummary(null)

    // A fresh upload must wait for its ruleset so a BJJ selection reliably
    // takes the tape-first path. Restored/demo clips keep the saved selection.
    if (source === 'upload') {
      pendingBootFileRef.current = file
      setSportPickerOpen(true)
      return
    }

    // First-frame skeleton: FightAnalyzer preScanOnLoad after boot enables it.
    // Local prep runs in runBootPipeline; play stays locked until then.
    // Use setTimeout (not requestAnimationFrame): rAF does not run while the tab/app is in the background,
    // which would block upload/pre-scan until the user returns.
    setTimeout(() => {
      void runBootPipeline(file)
    }, 0)
  }

  const onPickVideoRef = useRef(onPickVideo)
  onPickVideoRef.current = onPickVideo

  useEffect(() => () => {
    nativeUploadAbortRef.current?.abort()
    nativeUploadAbortRef.current = null
    if (videoObjectUrlRef.current) {
      try { URL.revokeObjectURL(videoObjectUrlRef.current) } catch { void 0 }
      videoObjectUrlRef.current = null
    }
  }, [])

  /**
   * Fresh uploads open the lightweight time-window slider only (timestamps).
   * The original phone file is uploaded direct-to-R2; Modal/FFmpeg performs the
   * physical trim. Never use canvas/MediaRecorder re-encode on the client.
   */
  const requestVideoPick = useCallback(
    (file: File, opts?: ClipPickOptions) => {
      const source = opts?.source ?? 'upload'
      if (source !== 'upload') {
        // Restored/demo clips already have a defined source; do not interrupt
        // them with the fresh-upload trimming step.
        applyAnalysisWindow(0, 0)
        onPickVideoRef.current(file, opts)
        return
      }

      setTrimSelection({ file, opts })
    },
    [applyAnalysisWindow],
  )

  const requestVideoPickRef = useRef(requestVideoPick)
  requestVideoPickRef.current = requestVideoPick

  const persistClipSession = useCallback(async (file: File, sessionId: string) => {
    if (clipPersistInFlightRef.current) return
    clipPersistInFlightRef.current = true
    try {
      const existing = await getSession(sessionId)
      const videoBlob = await file.arrayBuffer()
      await putSession({
        id: sessionId,
        videoFileName: file.name,
        videoMimeType: file.type || 'video/mp4',
        videoBlob,
        videoUrl: null,
        analysis: analysis ?? existing?.analysis ?? null,
        messages: messages.length > 0 ? messages : existing?.messages ?? [],
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      })
      const sessions = await listSessions()
      setLocalSessions(sessions)
    } catch (error) {
      console.warn('[clip persist]', error)
    } finally {
      clipPersistInFlightRef.current = false
    }
  }, [analysis, messages])

  const loadDemoClip = useCallback(async () => {
    if (demoClipLoading) return
    setDemoClipLoading(true)
    try {
      const res = await fetch(DEMO_CLIP_URL)
      if (!res.ok) {
        throw new Error('Demo clip not found. Add public/test-videos/test-video-for-app.mp4 or upload your own clip.')
      }
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.startsWith('video/')) {
        throw new Error('Demo URL did not return a video file.')
      }
      const blob = await res.blob()
      if (blob.size < 1024) {
        throw new Error('Demo clip file is empty.')
      }
      const name = DEMO_CLIP_URL.split('/').pop() || 'test-video-for-app.mp4'
      const file = new File([blob], name, { type: blob.type || 'video/mp4' })
      onPickVideoRef.current(file, { source: 'demo' })
    } catch (error) {
      toast({
        title: 'Demo clip unavailable',
        description: error instanceof Error ? error.message : 'Upload your own clip instead.',
        variant: 'destructive',
      })
    } finally {
      setDemoClipLoading(false)
    }
  }, [demoClipLoading, toast])

  useEffect(() => {
    if (bootstrapVideoFile || autoRestoreAttemptedRef.current) return
    autoRestoreAttemptedRef.current = true

    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return
        try {
          // Populate the saved-session list so a previous clip can be re-opened
          // manually, but do NOT auto-load it — every reload should land on the
          // clip picker so a clip can be selected (or uploaded) fresh each time.
          const sessions = await listSessions()
          if (!cancelled) setLocalSessions(sessions)
        } catch (error) {
          console.warn('[clip restore]', error)
        }
      })()
    }, 200)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [bootstrapVideoFile])

  useEffect(() => {
    if (!bootstrapVideoFile) return
    autoRestoreAttemptedRef.current = true
    void requestVideoPickRef.current(bootstrapVideoFile, { source: 'upload' })
    onBootstrapConsumed?.()
  }, [bootstrapVideoFile, onBootstrapConsumed])

  const analyzeCurrentFrame = async () => {
    if (!videoRef.current) return
    
    // Validate video is ready and has valid dimensions
    const video = videoRef.current
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      console.warn('Video not ready for frame capture')
      return
    }
    
    setAnalyzing(true)
    try {
      // Capture current frame
      const blob = await captureFrameAsBlob({ purpose: 'reflex' })
      
      // Validate we got actual frame data
      if (!blob || blob.size === 0) {
        throw new Error('Failed to capture video frame')
      }
      
      // Convert to base64 for Gemini
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
      })
      
      // Get kinematics context
      const kinematicsContext = kinematicsRef.current ? {
        fighters: kinematicsRef.current.fighters,
        range: kinematicsRef.current.range
      } : null
      
      // Call unified API endpoint with action 'chat'
      const response = await fetch('/api/fight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          messages: [
            { 
              role: 'user', 
              content: `Analyze this fight frame and identify the fighters. Return a JSON response with:
              
fighterA: { id: "A", label: "Descriptive name based on appearance (e.g., 'Fighter in Red Shorts')", description: "Brief description" }
fighterB: { id: "B", label: "Descriptive name based on appearance", description: "Brief description" }

Then provide your analysis of the scene, techniques, and tactical situation.

IMPORTANT: Map fighters by their horizontal position in the frame - left side is Fighter A, right side is Fighter B.` 
            }
          ],
          context: {
            image: base64,
            kinematics: kinematicsContext,
            frameAnalysis: true,
            fighterIdentification: true,
            focusTarget,
            ...currentFightClipAiMetadata(),
          }
        })
      })
      
      const result = await parseApiResponse(response) as { message: string }
      
      if (result.message) {
        // Parse fighter identification from response
        let candidates: FighterCandidate[] = []
        let sceneSummary = result.message
        
        try {
          // Extract JSON from response if present
          const jsonMatch = result.message.match(/\{[\s\S]*\}/)
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0])
            if (parsed.fighterA) {
              candidates.push({
                id: 'A',
                label: parsed.fighterA.label || 'Fighter A',
                description: parsed.fighterA.description || ''
              })
            }
            if (parsed.fighterB) {
              candidates.push({
                id: 'B',
                label: parsed.fighterB.label || 'Fighter B',
                description: parsed.fighterB.description || ''
              })
            }
            // Remove JSON from summary
            sceneSummary = result.message.replace(jsonMatch[0], '').trim()
          }
        } catch (e) {
          // If JSON parsing fails, create generic candidates
          candidates = [
            { id: 'A', label: 'Fighter A (Left)', description: 'Left position fighter' },
            { id: 'B', label: 'Fighter B (Right)', description: 'Right position fighter' }
          ]
        }
        
        setAnalysis({
          personCount: candidates.length,
          candidates,
          sceneSummary,
          ruleset: { value: 'unknown', confidence: 0.5 }
        })
        setAnalysisSource('single_frame')
        setAnalysisAtTime(video.currentTime)
        
        toast({
          title: "Frame analyzed",
          description: `Identified ${candidates.length} fighter${candidates.length !== 1 ? 's' : ''}`,
        })
      }
    } catch (error) {
      console.error('Frame analysis failed:', error)
      toast({
        title: "Analysis failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive"
      })
    } finally {
      setAnalyzing(false)
    }
  }

  // Fast compile-only: on-screen annotations (no LLM). mode 'full' = deduped whole timeline (replay / end).
  const compileFightLangFast = useCallback(
    async (opts?: { mode?: 'window' | 'full'; windowMs?: number }) => {
      const frames = fightLangPoseFramesRef.current
      const video = videoRef.current
      const durMs = video && video.duration > 0 ? Math.round(video.duration * 1000) : 0
      const mode = opts?.mode ?? 'window'
      const windowMs =
        opts?.windowMs ?? (durMs > 0 && durMs < 22_000 ? durMs : 10_000)
      const slice =
        mode === 'full' && durMs > 0
          ? slicePoseFramesFullClip(frames, durMs)
          : slicePoseFramesWindow(frames, windowMs)
      if (slice.length < 4) return

      try {
        const res = await fetch('/api/fight/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            poseFrames: slice,
            llm: { enabled: false },
            clip: { durationMs: mode === 'full' && durMs > 0 ? durMs : windowMs, ...(clipAssetRefRef.current ? { assetRef: clipAssetRefRef.current } : {}) },
          }),
        })
        const json = await parseApiResponse<any>(res)
        const snip = json?.retrieval?.snippets
        if (Array.isArray(snip)) {
          setEmbedSnippetCount(snip.length)
        }
        if (json?.pipelineStats) {
          setPipelineStats(json.pipelineStats)
        }
        setLastCompileError(null)
        if (json?.ledger) {
          setCoachPreviewCoaching(buildPreviewCoachingFromLedger(json.ledger))
          setCompiledLedger(json.ledger as Record<string, unknown>)
        }
        if (Array.isArray(json?.overlayAnnotations)) {
          setFightLangOverlayAnnotations(json.overlayAnnotations)
        }
      } catch (e) {
        console.warn('[FightLang fast]', e)
        setLastCompileError(e instanceof Error ? e.message : 'Local FightLang compile failed')
        // Don't show scary "API key" toast — this is just the local compiler
        // failing, usually because not enough pose data yet. Silent fail is fine.
      }
    },
    []
  )

  // LLM coaching + merged overlays. replayPass > 1 = viewer re-watched; ask for denser recap.
  // Monotonically increasing token — only the latest analyze call's result
  // is allowed to update React state. Prevents stale coaching payloads from
  // overwriting fresh ones when multiple requests overlap (the old pipeline
  // could race when the user triggered "FightLang 15s" during an auto-loop
  // call still in flight, producing flickering/rewound coaching text).
  const analyzeRaceIdRef = useRef(0)

  const analyzeFightLangWindow = useCallback(
    async (opts?: { mode?: 'window' | 'full'; windowMs?: number; replayPass?: number }): Promise<boolean> => {
      // Vision-first sports coach from tape — pose quality must not block the card path.
      if (isPoseQualitySpendBlocked() && !isVisionFirstSport(selectedSportRef.current)) return false

      const frames = fightLangPoseFramesRef.current
      const video = videoRef.current
      const durMs = video && video.duration > 0 ? Math.round(video.duration * 1000) : 0
      const durSec = video && video.duration > 0 ? video.duration : 0
      const mode = opts?.mode ?? 'window'
      const windowMs =
        opts?.windowMs ?? (durMs > 0 && durMs < 22_000 ? durMs : 15_000)
      const rawSlice =
        mode === 'full' && durMs > 0
          ? slicePoseFramesFullClip(frames, durMs)
          : slicePoseFramesWindow(frames, windowMs)
      const slice = filterFramesByVisibility(
        rawSlice as Array<{
          tMs: number
          actors?: Partial<Record<'A' | 'B', Array<{ visibility?: number }>>>
        }>,
        {
          discipline: selectedSportRef.current,
          clipType: selectedClipTypeRef.current,
          focusTarget,
        },
      )

      const clipMeta = currentFightClipAiMetadata()
      const visionFirst =
        isVisionFirstSport(selectedSportRef.current) || isVisionFirstSport(clipMeta.sport)
      const grappling = isGrapplingClip({
        discipline: clipMeta.sport,
        clipType: clipMeta.clipType,
      })

      // Vision-first / grappling Coach Cards need the actual video — skeleton has no hands.
      // Upload once so analyze can forward videoFileUri (shared across cards + chat).
      if ((visionFirst || grappling) && videoFileRef.current && !geminiFileUriRef.current) {
        try {
          visionUploadAttemptedRef.current = true
          await uploadVideoForNativeAnalysisRef.current(undefined, { silentToast: !visionFirst })
        } catch (uploadErr) {
          console.warn('[FightLang] Vision-first video attach failed:', uploadErr)
          if (visionFirst) {
            toast({
              title: 'Tape upload failed',
              description: 'Could not prepare the clip for analysis. Retry Analyze.',
              variant: 'destructive',
            })
            return false
          }
        }
      }

      const visionFirstTape = visionFirst && Boolean(geminiFileUriRef.current)

      // Pose gate: striking still needs frames. Vision-first with tape attached may proceed empty.
      if (!visionFirstTape && slice.length < 4) return false

      if (visionFirst && !geminiFileUriRef.current) {
        toast({
          title: 'Preparing tape…',
          description: 'Wait for upload to finish, then hit Analyze again.',
        })
        return false
      }

      const raceId = ++analyzeRaceIdRef.current
      const isStale = () => raceId !== analyzeRaceIdRef.current

      const replayPass = opts?.replayPass ?? 0
      const short = durSec > 0 && durSec <= 14
      const dense =
        short || replayPass > 1
          ? ' OUTPUT: maximum information per word. Compressed ringside commentary. quickCue headlines ≤12 words. mainDiagnosis ≤28 words. No generic labels like "guard low" without naming the tactical consequence (who can punish, how).'
          : ''
      const replay =
        replayPass > 1
          ? ' Timeline was re-sampled across a full replay — tighten the narrative and note any pattern that only shows across the whole clip.'
          : ''

      const first = slice[0]
      const last = slice[slice.length - 1]
      const kinSlice = localKinematicsSeriesRef.current.filter((k) => {
        const start = first?.tMs ?? 0
        const end = last?.tMs ?? Infinity
        return k.capturedAtMs >= start - 500 && k.capturedAtMs <= end + 500
      })
      const kinForPeak = kinSlice.length >= 4 ? kinSlice : localKinematicsSeriesRef.current

      let temporalBurst: MotionBurstEvidence | undefined
      if (!visionFirstTape) {
        try {
          const peak = findPeakMotionMs(kinForPeak, { grappling })
          const minScore = grappling
            ? PEAK_MOTION_THRESHOLDS.MIN_BURST_SCORE_GRAPPLING
            : PEAK_MOTION_THRESHOLDS.MIN_BURST_SCORE
          if (peak && peak.score >= minScore) {
            const { A, B } = poseFramesToLandmarkHistories(frames)
            const burstFocus =
              focusTarget === 'A' ? 'A' : focusTarget === 'B' ? 'B' : ('both' as const)
            const raw = captureBurstFromBuffer(A, B, peak.tMs, burstFocus, 'peak-motion', 'peak-motion')
            temporalBurst = {
              burstId: raw.burstId,
              centerMs: raw.centerMs,
              focusTarget: raw.focusTarget,
              captureReason: 'peak-motion',
              peakScore: peak.score,
              eventKind: 'peak-motion',
              frames: raw.poseFrames.map((f) => ({
                seq: f.seq,
                dtMs: f.dtMs,
                landmarks: f.landmarks,
                landmarksB: f.landmarksB,
              })),
            }
          }
        } catch (burstErr) {
          console.warn('[FightLang] Auto-burst capture failed (non-fatal):', burstErr)
        }
      }

    setFightLangLoading(true)
    try {
      const first = slice[0]
      const last = slice[slice.length - 1]
      // Stable fingerprint of the actual request payload. Two scheduler ticks
      // that resolve to the exact same slice + intent now share one POST.
      const dedupeKey = `flw:${fingerprintSlice([
        mode,
        visionFirstTape ? 'vision' : slice.length,
        first?.tMs ?? '',
        last?.tMs ?? '',
        windowMs,
        replayPass,
        focusTarget,
        selectedSportRef.current,
        selectedClipTypeRef.current,
        geminiFileUriRef.current ?? '',
        temporalBurst?.centerMs ?? '',
      ])}`

      const pose3dSlice =
        !visionFirstTape && pose3DFramesRef.current.length >= 4
          ? mode === 'full' && durMs > 0
            ? slicePoseFramesFullClip(pose3DFramesRef.current, durMs)
            : slicePoseFramesWindow(pose3DFramesRef.current, windowMs)
          : []

      const result = await dedupeInflight(dedupeKey, () =>
        fetchAndParseApiResponse<any>('/api/fight/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            // Vision-first: empty pose forces the server vision-only coaching path.
            poseFrames: visionFirstTape ? [] : slice,
            ...(!visionFirstTape && kinSlice.length >= 4 ? { kinematics: kinSlice } : {}),
            ...(!visionFirstTape && temporalBurst ? { temporalBurst } : {}),
            ...(!visionFirstTape && pose3dSlice.length >= 4 ? { pose3DFrames: pose3dSlice } : {}),
            userIntent: visionFirstTape
              ? `Watch the attached tape and give sport-true tactical coaching for this clip. Ground every claim in what you see (positions, grips, transitions, faults).${dense}${replay}`
              : `Give tactical coaching: openings, counters, habits, and who is controlling space. Ground every claim in the ledger.${dense}${replay}`,
            focusTarget,
            llm: { enabled: true },
            // Sport + clip context route the coach-brain sport file and context notes server-side.
            ...currentFightClipAiMetadata(),
            // Which engine ACTUALLY produced the dense track feeding the ledger
            // (reported by FightAnalyzer.onDenseTrackReady): rtmpose-cloud is
            // the primary for uploads, mediapipe-local the preview/fallback.
            // The coach brain converts this into caution wording. Before the
            // deep track is ready, fall back to the live-path heuristic.
            pose: visionFirstTape
              ? { engine: 'vision-first', quality: 'video' }
              : poseEngineInfoRef.current
                ? {
                    engine: poseEngineInfoRef.current.engine,
                    ...(poseEngineInfoRef.current.quality
                      ? { quality: poseEngineInfoRef.current.quality.overall }
                      : {}),
                  }
                : { engine: rtmposeRequested() && isRtmposeReady() ? 'rtmpose' : 'mediapipe' },
            clip: {
              durationMs: mode === 'full' && durMs > 0
                ? Math.round(selectedWindowDurationSec() * 1000) || durMs
                : windowMs,
              ...(clipAssetRefRef.current ? { assetRef: clipAssetRefRef.current } : {}),
            },
            ...(geminiFileUriRef.current
              ? {
                  videoFileUri: geminiFileUriRef.current,
                  // Gemini always receives the normalized H.264/AAC asset,
                  // even when the phone source was a HEVC .mov.
                  videoMimeType: 'video/mp4',
                  startSec: analysisWindowRef.current.startSec,
                  endSec: analysisWindowRef.current.endSec,
                }
              : {}),
          }),
        })
      )

      if (result.kind === 'guard') {
        if (isStale()) return false
        const guardBody = result.body
        if (result.status === 401) setAiQuotaState({ kind: 'auth' })
        else if (result.status === 402) setAiQuotaState({ kind: 'quota_exhausted' })
        else if (result.status === 429) setAiQuotaState({ kind: 'rate_limited', retryAfterSec: result.retryAfter })
        else if (result.status === 503 && guardBody?.code === 'AI_KILL_SWITCH') {
          setAiQuotaState({ kind: 'kill_switch', hint: guardBody.hint })
        }
        return false
      }

      setAiQuotaState(null)
      const json = result.data
      // Race-ID gate: if a newer analyze call superseded us, drop this result.
      if (isStale()) {
        console.log('[FightLang] Dropping stale analyze result')
        return false
      }
        const snip = json?.retrieval?.snippets
        if (Array.isArray(snip)) {
          setEmbedSnippetCount(snip.length)
        }
        if (json?.pipelineStats) {
          setPipelineStats(json.pipelineStats)
        }
        if (!hasUsableCoachCards(json?.coaching)) {
          throw new Error('Coach Cards response was incomplete. Please retry the analysis.')
        }
        setFightLangCoaching(json.coaching)
        setFightLangRatingContext(
          json?.coaching && typeof json?.savedLedgerId === 'string'
            ? { ledgerId: json.savedLedgerId, aiModel: json?.model ?? null, discipline: selectedSportRef.current || null }
            : null
        )
        setFightLangLlmIssues(Array.isArray(json?.llmIssues) ? json.llmIssues : null)
        if (json?.ledger) {
          setCompiledLedger(json.ledger as Record<string, unknown>)
        }
        if (Array.isArray(json?.overlayAnnotations)) {
          setFightLangOverlayAnnotations(json.overlayAnnotations)
        }
        return true
      } catch (err) {
        if (!isStale()) {
          console.warn('[FightLang analyze]', err)
          toast({
            title: 'Analysis failed',
            description: err instanceof Error ? err.message : 'Could not load coaching',
            variant: 'destructive',
          })
        }
        return false
      } finally {
        if (!isStale()) setFightLangLoading(false)
      }
    },
    [currentFightClipAiMetadata, focusTarget, isPoseQualitySpendBlocked, selectedWindowDurationSec, toast]
  )
  const styleScanThreeFrames = async () => {
    if (!videoRef.current) return
    
    const video = videoRef.current
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      toast({ title: 'Video not ready', variant: 'destructive' })
      return
    }
    
    setAnalyzing(true)
    try {
      // Capture 3 frames at 0%, 50%, 100% of video
      const frames: string[] = []
      const positions = [0, 0.5, 1.0]
      
      for (const pos of positions) {
        const targetTime = video.duration * pos
        video.currentTime = targetTime
        await new Promise(resolve => setTimeout(resolve, 100))
        
        const blob = await captureFrameAsBlob({ purpose: 'reflex' })
        const base64 = await new Promise<string>((resolve) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.readAsDataURL(blob)
        })
        frames.push(base64)
      }
      
      // Analyze style from 3 frames
      const response = await fetch('/api/fight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          messages: [{
            role: 'user',
            content: 'Analyze these 3 frames from a fight. Identify the fighting styles, stances, and techniques being used. Return fighter identifications and style classifications.'
          }],
          context: { frames }
        })
      })
      
      const result = await parseApiResponse(response) as { message: string }
      if (result.message) {
        toast({ title: 'Style scan complete', description: 'Fighting styles identified' })
      }
    } catch (error) {
      toast({
        title: 'Style scan failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    } finally {
      setAnalyzing(false)
    }
  }
  const generateCoaching = async () => {
    if (!analysis || !videoRef.current) return
    
    setCoachingLoading(true)
    try {
      const blob = await captureFrameAsBlob({ purpose: 'reflex' })
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.readAsDataURL(blob)
      })
      
      const kinematicsContext = kinematicsRef.current ? {
        fighters: kinematicsRef.current.fighters,
        range: kinematicsRef.current.range
      } : null
      
      // Generate coaching based on current state
      const response = await fetch('/api/fight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          messages: [{
            role: 'user',
            content: 'Generate coaching advice for this moment. Include immediate cues, tactical adjustments, and a drill recommendation.'
          }],
          context: {
            image: base64,
            ...currentFightClipAiMetadata(),
            kinematics: kinematicsContext,
            analysis: analysis,
            focusTarget: focusTarget
          }
        })
      })
      
      const result = await parseApiResponse(response) as { message: string }
      const coachingText = asChatContent(result.message)
      if (coachingText) {
        setMessages((prev) => [...prev, { role: 'assistant', content: coachingText }])
        speakText(coachingText)
      }
    } catch (error) {
      toast({
        title: 'Coaching generation failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    } finally {
      setCoachingLoading(false)
    }
  }
  const sendChat = async () => {
    if (!chatInput.trim()) return

    if (!videoUrl && noClipChatCredits?.tier === 'free' && noClipChatCredits.remaining === 0) {
      toast({
        title: 'Free question limit reached',
        description: 'Upload a clip for video-grounded coaching, upgrade to Pro, or return after the daily reset.',
        variant: 'destructive',
      })
      return
    }

    const userMessage = chatInput.trim()

    try {
      // A question shown as clip-aware must be grounded in the active tape.
      // Never silently fall through to a generic answer while bytes are still
      // uploading or after tape preparation failed.
      if (videoUrl && !geminiFileUriRef.current) {
        if (uploadingVideo) {
          toast({
            title: 'Tape is still uploading',
            description: 'Wait for the upload to finish, then send your question.',
          })
          return
        }
        if (!videoFileRef.current) {
          toast({
            title: 'Tape is not attached',
            description: 'Re-upload the clip so the coach can ground its answer in the video.',
            variant: 'destructive',
          })
          return
        }
        setChatLoading(true)
        const tapeUri = await uploadVideoForNativeAnalysis(undefined, { silentToast: true })
        if (!tapeUri || !geminiFileUriRef.current) {
          toast({
            title: 'Tape upload failed',
            description: nativeUploadErrorRef.current || 'Retry the upload before asking about this clip.',
            variant: 'destructive',
          })
          return
        }
      }

      setChatInput('')
      setMessages((prev: any[]) => [...prev, { role: 'user', content: userMessage }])

      // Get current context
      const kinematicsContext = kinematicsRef.current ? {
        fighters: kinematicsRef.current.fighters,
        range: kinematicsRef.current.range
      } : null
      
      // Set loading state based on mode
      if (coachingMode === 'strategy') {
        setStrategyLoading(true)
      } else {
        setChatLoading(true)
      }
      
      // Call unified API endpoint with action 'strategy' or 'chat'
      const action = coachingMode === 'strategy' ? 'strategy' : 'chat'
      const response = await fetch('/api/fight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          messages: [...messages, { role: 'user', content: userMessage }],
          context: {
            analysisStyle: 'comet',
            ...currentFightClipAiMetadata(),
            // Evidence summary for the server's empty-evidence honesty gate:
            // with a clip loaded but nothing actually observable, the model
            // must say so instead of inventing clip content.
            evidence: {
              clipLoaded: Boolean(videoUrl),
              videoAttached: Boolean(geminiFileUriRef.current),
              poseFrames: fightLangPoseFramesRef.current.length,
              ledgerEvents: Array.isArray((compiledLedger as { events?: unknown[] } | null)?.events)
                ? ((compiledLedger as { events?: unknown[] }).events as unknown[]).length
                : 0,
              playbackStarted: playbackUnlocked,
            },
            nativeVideo: Boolean(geminiFileUriRef.current),
            ...(geminiFileUriRef.current ? {
              videoFileUri: geminiFileUriRef.current,
              videoMimeType: 'video/mp4',
              clipDuration: selectedWindowDurationSec(),
              startSec: analysisWindowRef.current.startSec,
              endSec: analysisWindowRef.current.endSec,
              videoAnalysisSessionId: videoAnalysisSessionIdRef.current,
              requestedFPS: 5,
            } : {}),
            kinematics: kinematicsContext,
            analysis: {
              ...analysis,
              factualLedger: compiledLedger || undefined,
            },
            strategy: currentStrategy,
            focusTarget: focusTarget,
            fighterLabels: analysis?.candidates ? {
              A: analysis.candidates.find(c => c.id === 'A'),
              B: analysis.candidates.find(c => c.id === 'B')
            } : null,
            patterns: patternAnalysis && patternAnalysis.topPatterns.length > 0
              ? exportPatternsForAI(patternAnalysis)
              : compiledLedger && (compiledLedger as any)?.patterns
                ? (compiledLedger as any).patterns.map((p: any) => p?.summary || p?.kind || String(p)).join('\n')
                : null,
          }
        })
      })
      
      const parsed = await parseApiResponse(response)
      // Failed calls (quota, verification, guard statuses) return {error,hint}
      // with no message/gameplan — surface the reason IN the chat thread.
      // Silently dropping it left users staring at their own unanswered message.
      const failure = parsed as { error?: string; hint?: string }
      if (!response.ok || (failure.error && !(parsed as { message?: string }).message)) {
        const reason =
          [failure.error, failure.hint].filter(Boolean).join(' ') ||
          `Coaching failed (status ${response.status}). Please try again.`
        setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ ${reason}` }])
        return
      }
      if (coachingMode === 'strategy') {
        const strategy = parsed as StrategyResponse
        setCurrentStrategy(strategy)
        setMessages((prev) => [...prev, {
          role: 'assistant',
          content: `Strategy generated:\nGameplan: ${strategy.gameplan}\nCounters: ${(strategy.counters || []).join(', ')}`
        }])
      } else {
        const chat = parsed as { message: string }
        // Guard: a leaked internal coaching-JSON payload becomes clean prose.
        const chatText = asChatContent(chat.message)
        if (chatText) {
          setMessages((prev) => [...prev, { role: 'assistant', content: chatText }])
          speakText(chatText)
        } else {
          setMessages((prev) => [...prev, { role: 'assistant', content: '⚠️ The coach returned an empty reply — please ask again.' }])
        }
      }
    } catch (error) {
      console.error('Chat failed:', error)
      const msg = error instanceof Error ? error.message : 'Unknown error'
      setMessages((prev) => [...prev, { role: 'assistant', content: `⚠️ Coaching failed: ${msg}` }])
      toast({
        title: "Chat failed",
        description: msg,
        variant: "destructive"
      })
    } finally {
      setChatLoading(false)
      setStrategyLoading(false)
      if (!videoUrl) void refreshNoClipChatCredits()
    }
  }
  const stopVoice = useCallback(() => {
    const rec = recognitionRef.current
    recognitionRef.current = null
    setVoiceListening(false)
    setVoiceInterim('')
    if (rec) {
      try {
        rec.onresult = null
        rec.onend = null
        rec.onerror = null
        rec.stop()
      } catch {
        void 0
      }
    }
  }, [])
  const startVoice = useCallback(() => {
    if (recognitionRef.current) return
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      toast({ title: 'Voice input not supported in this browser', variant: 'destructive' })
      return
    }
    let rec: SpeechRecognitionLike
    try {
      rec = new Ctor()
    } catch {
      toast({ title: 'Voice input not supported in this browser', variant: 'destructive' })
      return
    }
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
    rec.continuous = true
    rec.interimResults = true
    voiceBaseTextRef.current = chatInput ? `${chatInput.replace(/\s+$/, '')} ` : ''
    voiceFinalTextRef.current = ''
    rec.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result?.[0]?.transcript ?? ''
        if (result?.isFinal) {
          voiceFinalTextRef.current += transcript
        } else {
          interim += transcript
        }
      }
      setVoiceInterim(interim)
      setChatInput(`${voiceBaseTextRef.current}${voiceFinalTextRef.current}${interim}`.trimStart())
    }
    rec.onend = () => {
      // Fires on natural end (silence) and after stop(); commit final text only.
      if (recognitionRef.current === rec) {
        recognitionRef.current = null
        setVoiceListening(false)
        setVoiceInterim('')
        setChatInput(`${voiceBaseTextRef.current}${voiceFinalTextRef.current}`.trimStart())
      }
    }
    rec.onerror = (event) => {
      if (recognitionRef.current === rec) {
        recognitionRef.current = null
        setVoiceListening(false)
        setVoiceInterim('')
      }
      if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
        toast({ title: 'Microphone blocked', description: 'Allow microphone access to use voice input.', variant: 'destructive' })
      }
    }
    try {
      rec.start()
      recognitionRef.current = rec
      setVoiceListening(true)
    } catch {
      toast({ title: 'Could not start voice input', variant: 'destructive' })
    }
  }, [chatInput, toast])
  const applyPreset = (text: string) => {
    setChatInput(text)
  }
  const applyCoachingPreset = (kind: 'gameplan' | 'counters' | 'corner') => {
    // Vision-first: presets need a successful Analyze so the tape is attached
    // and Coach Cards exist — otherwise chat essays empty-tape fluff.
    if (isVisionFirstSport(selectedSport) && videoUrl && !fightLangCoaching) {
      toast({
        title: 'Run Analyze first',
        description:
          resolveSportKey(selectedSport) === 'bjj_grappling'
            ? 'Hit “Analyze this roll” so Corner advice can use the tape.'
            : 'Hit “Analyze this match” so Corner advice can use the tape.',
      })
      return
    }
    applyPreset(buildPresetText(kind))
  }
  const buildPresetText = (kind: 'gameplan' | 'counters' | 'corner'): string => {
    const fallback = DEFAULT_PRESET_TEXTS[kind]
    const raw = presetTemplates.current?.[kind]
    if (!raw) return fallback
    const substituted = raw
      .replace(/\{\{\s*pov\s*\}\}/gi, `the ${myCorner} corner fighter`)
      .replace(/\{\{\s*context\s*\}\}/gi, 'what you have seen in this clip')
      // Any other unresolved {{placeholder}} we can't sensibly fill — drop it.
      .replace(/\{\{[^}]*\}\}/g, '')
      .replace(/[ \t]{2,}/g, ' ')
      .trim()
    return substituted.length >= 20 ? substituted : fallback
  }
  const saveLocalSession = async () => {
    if (!localSessionId) return
    
    try {
      let videoBlob: ArrayBuffer | null = null
      const videoMimeType: string | null = videoFile?.type ?? null
      if (videoFile) {
        try {
          videoBlob = await videoFile.arrayBuffer()
        } catch {
          videoBlob = null
        }
      }
      const sessionData = {
        id: localSessionId,
        videoUrl: videoUrl,
        videoFileName: videoFile?.name || 'unknown',
        videoBlob,
        videoMimeType,
        analysis: analysis,
        messages: messages,
        kinematicsSeries: localKinematicsSeriesRef.current,
        poseFrames: localRawLandmarksOn ? localPoseFramesRef.current : [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      
      await putSession(sessionData as any)
      setLocalStatus('Session saved')
      toast({ title: 'Session saved', description: `ID: ${localSessionId.slice(0, 8)}...` })
      
      // Refresh session list
      const sessions = await listSessions()
      setLocalSessions(sessions)
    } catch (error) {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    }
  }
  const onExportLocal = async () => {
    try {
      const data = await exportAll()
      const json = JSON.stringify(data, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `musashi-sessions-${Date.now()}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast({ title: 'Export complete', description: 'Sessions exported to file' })
    } catch (error) {
      toast({
        title: 'Export failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    }
  }
  const onImportLocal = async (file: File) => {
    try {
      const text = await file.text()
      const count = await importAll(text)
      const sessions = await listSessions()
      setLocalSessions(sessions)
      toast({ title: 'Import complete', description: `Imported ${count} sessions` })
    } catch (error) {
      toast({
        title: 'Import failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    }
  }
  const loadLocalSession = async (id: string) => {
    try {
      const session = await getSession(id)
      if (!session) {
        toast({ title: 'Session not found', variant: 'destructive' })
        return
      }
      
      setLocalSessionId(id)
      setAnalysis(session.analysis as any)
      setMessages(normalizeChatMessages(session.messages))
      
      // Prefer persisted bytes — blob: URLs from a prior tab are revoked after reload.
      if (session.videoBlob && session.videoBlob.byteLength > 0) {
        const name = session.videoFileName || 'restored-clip.mp4'
        const mime = session.videoMimeType || 'video/mp4'
        const file = new File([session.videoBlob], name, { type: mime })
        onPickVideo(file, { source: 'restored', sessionId: id })
      } else if (session.videoUrl) {
        setVideoUrl(session.videoUrl)
        setVideoMuted(false)
        applyPlaybackLock(false)
        setBootPipelineReady(false)
        setBootPipelineMessage('Restoring clip…')
        const file = videoFileRef.current
        if (file) {
          setTimeout(() => {
            void runBootPipeline(file)
          }, 0)
        } else {
          toast({
            title: 'Re-upload required',
            description:
              'This saved session does not include the video file. Upload the clip again to restore skeleton tracking.',
            variant: 'destructive',
          })
        }
      }
      
      toast({ title: 'Session loaded', description: `ID: ${id.slice(0, 8)}...` })
    } catch (error) {
      toast({
        title: 'Load failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    }
  }
  const removeLocalSession = async (id: string) => {
    try {
      await deleteSession(id)
      const sessions = await listSessions()
      setLocalSessions(sessions)
      toast({ title: 'Session deleted', description: `ID: ${id.slice(0, 8)}...` })
    } catch (error) {
      toast({
        title: 'Delete failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    }
  }
  
  // Phase 2: Exchange Segmentation and Pattern Detection
  const analyzeExchangesAndPatterns = async () => {
    if (localKinematicsSeriesRef.current.length < 30) {
      toast({
        title: 'Insufficient data',
        description: 'Record more video to detect exchanges and patterns',
        variant: 'destructive'
      })
      return
    }
    
    setAnalyzingExchanges(true)
    try {
      const videoId = localSessionId || `video_${Date.now()}`
      
      // Segment exchanges
      const timeline = segmentExchanges(localKinematicsSeriesRef.current, videoId, 30)
      setExchangeTimeline(timeline)
      
      toast({
        title: 'Exchanges detected',
        description: `Found ${timeline.exchanges.length} engagement windows`
      })
      
      // Detect patterns if we have enough exchanges
      if (timeline.exchanges.length >= 2) {
        const patterns = detectPatterns(timeline, localKinematicsSeriesRef.current)
        setPatternAnalysis(patterns)
        
        if (patterns.topPatterns.length > 0) {
          toast({
            title: 'Patterns identified',
            description: `Top pattern: ${patterns.topPatterns[0].title} (${(patterns.topPatterns[0].confidence * 100).toFixed(0)}%)`
          })
        }
      }
    } catch (error) {
      toast({
        title: 'Analysis failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    } finally {
      setAnalyzingExchanges(false)
    }
  }
  
  // Phase 2: Upload video to Gemini for native video analysis
  const uploadVideoForNativeAnalysis = async (fileOverride?: File, opts?: { silentToast?: boolean }) => {
    // OFFLINE MODE — skip Gemini Files upload entirely. Skeleton tracking
    // (MediaPipe) runs 100% locally; only the LLM cloud tier needs the
    // fileUri. This lets users test the app with zero paid API spend.
    if (process.env.NEXT_PUBLIC_OFFLINE_MODE === '1') {
      console.log('[offline] Skipping Gemini video upload (NEXT_PUBLIC_OFFLINE_MODE=1)')
      return null
    }
    const sourceFile = fileOverride ?? videoFile
    if (!sourceFile) {
      toast({
        title: 'No video file',
        description: 'Please upload a video first',
        variant: 'destructive'
      })
      return
    }

    setUploadingVideo(true)
    setUploadProgress(0)
    setUploadByteProgress(null)
    setIngestionStage('uploading_original')
    nativeUploadErrorRef.current = null
    setInitialAnalysisStatus('Uploading original video securely...')
    const silentToast = Boolean(opts?.silentToast)
    nativeUploadAbortRef.current?.abort()
    const uploadAbort = new AbortController()
    nativeUploadAbortRef.current = uploadAbort

    try {
      // Quota / Gemini offsets key on the selected analysis window, not full file length.
      // Auto-clamp to ≤maxClipSec — never hard-block long phone files as "too long".
      const fileDur = Number(videoRef.current?.duration) || clipDurationSec || maxClipSec
      ensureAnalysisWindow(fileDur)
      let duration = selectedWindowDurationSec()
      if (!Number.isFinite(duration) || duration <= 0 || duration > maxClipSec + VIDEO_DURATION_TOLERANCE_SEC) {
        const clamped = defaultTrimWindow(fileDur > 0 ? fileDur : maxClipSec, maxClipSec)
        applyAnalysisWindow(clamped.start, clamped.end)
        duration = clamped.end - clamped.start
      }
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error('Video is still loading. Wait for the video to become ready, then try analysis again.')
      }
      const videoAnalysisSessionId = videoAnalysisSessionIdRef.current || (
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `video-${Date.now()}-${Math.random().toString(36).slice(2)}`
      )
      videoAnalysisSessionIdRef.current = videoAnalysisSessionId

      // Direct-to-R2: ticket → browser PUT to R2 hostname → /complete.
      // Raw video bytes never enter /api/fight or any Worker request body.
      let assetId = parseAssetRef(clipAssetRefRef.current || '')
      if (!assetId) {
        try {
          const asset = await uploadMarketplaceFile({
            file: sourceFile,
            purpose: 'analysis_clip',
            signal: uploadAbort.signal,
            onUploadProgress: (progress) => {
              setUploadByteProgress(progress)
              if (progress.percent !== null) setUploadProgress(Math.round(progress.percent))
            },
          })
          setUploadProgress(100)
          setUploadByteProgress({
            loadedBytes: sourceFile.size,
            totalBytes: sourceFile.size,
            percent: 100,
            lengthComputable: true,
          })
          assetId = asset.id
          clipAssetRefRef.current = toAssetRef(asset.id)
          setClipStorageStatus('saved')
        } catch (storageErr) {
          console.warn('[video ingestion] original R2 upload failed', storageErr)
          setClipStorageStatus('unavailable')
          const detail = storageErr instanceof Error ? storageErr.message : 'Unknown upload error'
          throw new Error(`Original upload failed: ${detail}`)
        }
      }

      const sourceStartSec = analysisWindowRef.current.startSec
      const sourceEndSec = analysisWindowRef.current.endSec
      const windowDurationSec =
        Number.isFinite(sourceEndSec) && sourceEndSec > sourceStartSec
          ? sourceEndSec - sourceStartSec
          : duration

      setIngestionStage('original_uploaded')
      setInitialAnalysisStatus('Server is normalizing your video for AI…')
      setIngestionStage('normalizing')
      const res = await fetch('/api/fight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: uploadAbort.signal,
        body: JSON.stringify({
          action: 'upload_video',
          assetId,
          videoAnalysisSessionId,
          // Metadata only — never the video File / FormData.
          sourceStartSec,
          sourceEndSec,
          requestedDurationSec: windowDurationSec,
          clipDurationSec: windowDurationSec,
          sport: selectedSportRef.current || undefined,
          clipType: selectedClipTypeRef.current || undefined,
          ...currentFightClipAiMetadata(),
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: `Server error ${res.status}` })) as { error?: string }
        throw new Error(errData.error || `Upload failed with status ${res.status}`)
      }

      const data = await res.json() as {
        fileUri?: string
        credits?: VideoCreditBalance
        effectiveDurationSec?: number
        normalizedAssetId?: string
      }
      const fileUri = data.fileUri

      if (!fileUri) {
        throw new Error('No file URI returned from server')
      }

      setGeminiFileUri(fileUri)
      geminiFileUriRef.current = fileUri
      const effectiveDurationSec = Number(data.effectiveDurationSec)
      if (Number.isFinite(effectiveDurationSec) && effectiveDurationSec > 0) {
        applyAnalysisWindow(0, effectiveDurationSec)
        setClipDurationSec(effectiveDurationSec)
      }
      if (data.normalizedAssetId && videoFileRef.current === sourceFile) {
        // The server-normalized H.264/AAC asset is the playback source too.
        // This replaces an undecodable HEVC/VFR phone preview without ever
        // asking the browser to seek, canvas-render, or re-encode the file.
        const objectUrl = videoObjectUrlRef.current
        videoObjectUrlRef.current = null
        setVideoUrl(`/api/uploads/${encodeURIComponent(data.normalizedAssetId)}/content`)
        if (objectUrl) {
          try { URL.revokeObjectURL(objectUrl) } catch { void 0 }
        }
      }
      if (data.credits) setVideoCredits(data.credits)
      else void refreshVideoCredits()
      setUploadProgress(100)
      setIngestionStage('gemini_ready')
      setInitialAnalysisStatus('Video ready. Starting full analysis...')

      if (!silentToast) {
        toast({
          title: 'Video ready',
          description: 'Video processed and ready for AI analysis'
        })
      }

      // Can now use fileUri in strategy endpoint
      return fileUri

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown upload error'
      nativeUploadErrorRef.current = message
      setIngestionStage('failed')
      setInitialAnalysisStatus(message)
      if (!silentToast) {
        toast({
          title: 'Upload failed',
          description: message,
          variant: 'destructive'
        })
      }
      return null
    } finally {
      if (nativeUploadAbortRef.current === uploadAbort) {
        nativeUploadAbortRef.current = null
        setUploadingVideo(false)
      }
    }
  }
  uploadVideoForNativeAnalysisRef.current = uploadVideoForNativeAnalysis

  const runInitialClipAnalysis = async (fileUri: string, sourceFile: File): Promise<boolean> => {
    setInitialAnalysisLoading(true)
    setInitialAnalysisReady(false)
    setInitialAnalysisStatus('Quick scan — identifying fighters and key moments...')

    try {
      const response = await fetch('/api/fight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'chat',
          messages: [{ role: 'user', content: INITIAL_CLIP_ANALYSIS_REQUEST }],
          context: {
            analysisStyle: 'comet',
            ...currentFightClipAiMetadata(),
            nativeVideo: true,
            initialVideoAnalysis: true,
            videoFileUri: fileUri,
            videoMimeType: 'video/mp4',
            clipDuration: selectedWindowDurationSec(),
            startSec: analysisWindowRef.current.startSec,
            endSec: analysisWindowRef.current.endSec,
            videoAnalysisSessionId: videoAnalysisSessionIdRef.current,
            requestedFPS: 5,
            focusTarget,
          }
        })
      })

      setInitialAnalysisStatus('Deep analysis — breaking down the exchange...')
      const result = await parseApiResponse(response) as { message?: string; error?: string }
      if (!response.ok) throw new Error(result.error || 'Full clip analysis failed')

      const message = asChatContent(result.message || '')
      if (!message) throw new Error('The coach returned an empty initial analysis.')
      setMessages([{ role: 'assistant', content: message }])
      setInitialAnalysisReady(true)
      setInitialAnalysisStatus(null)
      speakText(message)

      toast({
        title: 'Analysis ready',
        description: 'Full clip breakdown complete. Ask follow-up questions below.',
      })
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Full clip analysis failed'
      setInitialAnalysisStatus(null)
      setMessages(prev => {
        // Only show error if no assistant message was already added by streaming
        if (prev.some(m => m.role === 'assistant')) return prev
        return [{ role: 'assistant', content: `⚠️ Full clip analysis failed.\n\n${message}\n\nThe tape is attached; retry analysis or ask a focused question.` }]
      })
      toast({
        title: 'Analysis failed',
        description: message,
        variant: 'destructive'
      })
      return false
    } finally {
      setInitialAnalysisLoading(false)
    }
  }

  const prepareClipForFullAnalysis = async (fileOverride?: File) => {
    const sourceFile = fileOverride ?? videoFile
    if (!sourceFile) return
    if (!geminiFileUri && videoCredits && videoCredits.remaining <= 0) {
      toast({
        title: 'AI video credits used',
        description: videoCredits.tier === 'free'
          ? 'Free includes 3 successful AI video analyses. Local playback and skeleton tracking still work.'
          : 'Your current video-analysis allowance is used. Please try again after it resets.',
        variant: 'destructive',
      })
      return
    }

    const fileUri = fileOverride ? await uploadVideoForNativeAnalysis(sourceFile) : (geminiFileUri || await uploadVideoForNativeAnalysis())
    if (!fileUri) return

    const [initialOk, streamOk] = await Promise.all([
      runInitialClipAnalysis(fileUri, sourceFile),
      runStreamingAnalysis(fileUri, sourceFile),
    ])
    setInitialAnalysisReady(initialOk || streamOk)
    if (!initialOk && !streamOk) {
      setInitialAnalysisStatus('Analysis did not complete. Retry Full Clip Analysis.')
    }
  }

  /** After file pick: buffer media, multi-pass pose pre-scan, then surface ▶ Play. */
  const runBootPipeline = async (file: File) => {
    if (bootPipelineRunningRef.current) return
    bootPipelineRunningRef.current = true
    applyPlaybackLock(false)
    setBootPipelineReady(false)
    setBootPipelineMessage('Reviewing your clip…')
    prescanBootResolveRef.current = null
    bootMediaOutcomeRef.current = null
    bootLastPassTotalStepsRef.current = 0
    bootLastPassFramesCompletedRef.current = 0
    setPreScanProgress(null)
    setPreScanDetections({ samples: 0, A: 0, B: 0, both: 0 })
    setBootWarnings([])
    setMediaErrorMessage(null)
    setLastCompileError(null)
    setBootVerificationSummary(null)

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
    const stillThisClip = () => videoFileRef.current === file

    try {
      const visionFirstBoot = isVisionFirstSport(selectedSportRef.current)
      if (visionFirstBoot) {
        // BJJ/wrestling/judo do not depend on browser decode of the original
        // phone clip. Send the R2 asset to the server normalizer first, then
        // attach the resulting H.264/AAC tape before any player or AI work.
        clipAnalysisPipelineStartedRef.current = true
        visionUploadAttemptedRef.current = true
        setBootPipelineMessage('Uploading original video for your coach…')
        const fileUri = await uploadVideoForNativeAnalysisRef.current?.(file, { silentToast: true })
        if (!fileUri) {
          visionUploadAttemptedRef.current = false
          throw new Error(nativeUploadErrorRef.current || 'Gemini tape upload failed. Please retry the analysis.')
        }
        if (!stillThisClip()) return

        setBootPipelineMessage('Loading the normalized video…')
        const normalizedDeadline = Date.now() + 45_000
        let normalizedVideo: HTMLVideoElement | null = null
        while (Date.now() < normalizedDeadline) {
          const candidate = videoRef.current
          if (
            candidate &&
            candidate.readyState >= HTMLMediaElement.HAVE_METADATA &&
            Number.isFinite(candidate.duration) &&
            candidate.duration > 0 &&
            candidate.videoWidth > 0 &&
            candidate.videoHeight > 0
          ) {
            normalizedVideo = candidate
            break
          }
          await sleep(80)
        }
        if (!normalizedVideo) {
          throw new Error('Server processing finished, but the normalized video could not be opened.')
        }
        ensureAnalysisWindow(normalizedVideo.duration)
        setClipDurationSec(normalizedVideo.duration)
        try {
          normalizedVideo.currentTime = 0
          normalizedVideo.pause()
        } catch {
          void 0
        }

        setIngestionStage('analyzing')
        setBootPipelineMessage('Deep review — finding positions and key moments…')
        const [initialOk, streamOk] = await Promise.all([
          runInitialClipAnalysis(fileUri, file),
          runStreamingAnalysis(fileUri, file),
        ])
        if (!stillThisClip()) return
        if (!initialOk && !streamOk) {
          throw new Error('The tape uploaded, but the first coaching analysis did not complete. Retry analysis.')
        }

        setBootPipelineMessage('Building Coach Cards…')
        const coachCardsReady = await analyzeFightLangWindow({ mode: 'full' })
        if (!stillThisClip()) return
        if (!coachCardsReady) {
          throw new Error('The tape was reviewed, but Coach Cards were not returned. Retry analysis.')
        }

        try { videoRef.current?.pause() } catch { void 0 }
        setInitialAnalysisReady(true)
        setIngestionStage('complete')
        setBootPipelineReady(true)
        setBootPipelineMessage('')
        setBootVerificationSummary('Tape reviewed and Coach Cards prepared before playback.')
        toast({
          title: 'Ready — click play',
          description: 'Your tape review and first Coach Cards are ready.',
        })
        void persistClipSession(file, localSessionIdRef.current || `local-${Date.now()}`)
        return false
      }

      const deadline = Date.now() + 30000
      let pollCount = 0
      while (Date.now() < deadline) {
        const v = videoRef.current
        pollCount++
        if (pollCount === 1 || pollCount === 5 || pollCount === 50) {
        }
        // Some mobile containers report Infinity until metadata settles; resolve
        // that edge case below without generating or re-encoding a browser file.
        if (
          v &&
          v.readyState >= HTMLMediaElement.HAVE_METADATA &&
          (v.duration === Infinity || (Number.isFinite(v.duration) && v.duration > 0))
        ) {
          break
        }
        await sleep(80)
      }
      const v = videoRef.current
      if (!v || v.readyState < HTMLMediaElement.HAVE_METADATA) {
        throw new Error('Could not read video metadata — try MP4 (H.264) or WebM.')
      }
      if (v.duration === Infinity) {
        setBootPipelineMessage('Resolving clip duration…')
        const fixed = await resolveVideoDuration(v)
        if (fixed > 0) {
          ensureAnalysisWindow(fixed)
          setClipDurationSec(fixed)
        }
      }
      if (!Number.isFinite(v.duration) || v.duration <= 0) {
        throw new Error('Could not read video metadata — try MP4 (H.264) or WebM.')
      }
      if (v.videoWidth === 0 || v.videoHeight === 0) {
        // Never let a pictureless (corrupt / audio-only / failed-trim) file
        // reach Ready — that's the "black player with 0 pose frames" state.
        throw new Error('This video decoded with no picture — the trim/upload likely failed. Re-trim or use a different format.')
      }

      // Ensure a ≤maxClipSec window before any setClipDurationSec that can
      // kick the vision-first Gemini upload effect (quota uses window length).
      ensureAnalysisWindow(v.duration)

      const minLeft = clipProcessingMinUntilRef.current - Date.now()
      if (minLeft > 0) {
        setBootPipelineMessage('Preparing decode…')
        await sleep(minLeft)
      }

      setBootPipelineMessage('Buffering video…')
      let mediaOutcome = await Promise.race([
        waitForMediaPreloaded(v, () => !stillThisClip()),
        new Promise<MediaPreloadOutcome>((resolve) => setTimeout(() => resolve('timeout'), 5000)),
      ])
      if (mediaOutcome === 'timeout' && mediaBufferedEnough(v)) {
        mediaOutcome = 'buffered'
      }
      bootMediaOutcomeRef.current = mediaOutcome

      // Non-grappling uploads retain their non-blocking R2 review archive, but
      // it now begins only after the athlete confirmed this is not tape-first.
      if (clipLoadSourceRef.current === 'upload') {
        setClipStorageStatus('saving')
        void (async () => {
          try {
            const asset = await uploadMarketplaceFile({ file, purpose: 'analysis_clip' })
            if (!stillThisClip()) return
            clipAssetRefRef.current = toAssetRef(asset.id)
            setClipStorageStatus('saved')
          } catch (err) {
            console.warn('[clip upload]', err)
            if (stillThisClip()) setClipStorageStatus('unavailable')
          }
        })()
      }

      // ============================================================
      // BOOT PIPELINE — local systems run in unison while playback is locked:
      //   1. MediaPipe pose pre-scan (FightAnalyzer)
      //   2. FightLang compiler warmup
      // Gemini upload/analysis stays manual so opening a clip is zero-spend.
      // ============================================================

      setBootPipelineMessage('Mapping fighters (MediaPipe pose)…')

      const prescanDone = new Promise<void>((resolve) => {
        prescanBootResolveRef.current = resolve
      })

      await sleep(0)

      // Step 3: Wait for the pose pass to finish. The deep tracking pass
      // legitimately takes minutes (it analyzes every frame of the clip), so
      // Ready must NEVER fire on a fixed timer — releasing the gate early
      // drops playback onto the much weaker live-tracking path. We wait for
      // real completion and bail only if progress STALLS for 90s (hung
      // decoder / crashed WASM), surfacing live progress in the boot message.
      // A full paused scan is optional enrichment, never a prerequisite for
      // playback. Give it a short head start, then keep mapping in background.
      let prescanFinished = false
      await Promise.race([prescanDone, sleep(BOOT_PLAYABLE_WAIT_MS)])
      void prescanDone.then(() => {
        prescanFinished = true
      })
      bootProgressAtRef.current = Date.now()
      while (!prescanFinished && stillThisClip()) {
        await Promise.race([prescanDone, sleep(2000)])
        if (prescanFinished) break
        if (Date.now() - bootProgressAtRef.current > 90000) {
          console.warn('[boot] pose pass stalled >90s — releasing gate (live-tracking fallback)')
          break
        }
        const total = bootLastPassTotalStepsRef.current
        const done = Math.min(bootLastPassFramesCompletedRef.current, total)
        // Only ever show a frame count for the DEEP pass (total = the clip's real
        // per-frame count, e.g. 428/696). The brief ~24-frame keyframe bootstrap
        // shows "Preparing…" with NO number — its tiny "/24" was being misread as
        // the deep load only covering 24 frames.
        setBootPipelineMessage(
          total >= 60 ? `Deep tracking ${done}/${total} frames…` : 'Preparing deep track…'
        )
      }
      if (!stillThisClip()) return

      const total = bootLastPassTotalStepsRef.current
      const done = Math.min(bootLastPassFramesCompletedRef.current, total)
      const preScanFinished = total > 0 && done >= total

      // Step 4: Warm the local FightLang compiler in the background so overlays
      // and summaries are available quickly without silently spending on APIs.
      clipAnalysisPipelineStartedRef.current = true
      setBootPipelineMessage('Background: FightLang compile…')
      void compileFightLangFast({ mode: 'full' }).catch((err) => {
        console.warn('[boot] First FightLang compile failed:', err)
      })

      setBootPipelineMessage('Finishing…')
      await sleep(100)

      const rawVerification = verifyBootReadiness({
        media: bootMediaOutcomeRef.current ?? 'cancelled',
        lastPassTotalSteps: bootLastPassTotalStepsRef.current,
        lastPassFramesCompleted: bootLastPassFramesCompletedRef.current,
      })
      const ver = preScanFinished
        ? rawVerification
        : {
            ok: true,
            summary: total > 0
              ? `Video decoded. Background pose mapping ${done}/${total} frames.`
              : 'Video decoded. Background pose mapping is starting.',
            warnings: [] as string[],
          }
      setBootVerificationSummary(ver.summary)
      setBootWarnings(ver.warnings)
      if (process.env.NODE_ENV === 'development') {
        console.info('[boot] verification', ver)
      }
      if (!ver.ok) {
        console.warn('[boot] verification failed', ver.warnings)
      }
      // Final sanity gate: pause the element one last time, keep playback LOCKED.
      // The user must click the explicit ▶ Play button in the overlay to unlock —
      // only then does applyPlaybackLock(true) fire. This prevents the prior auto-play bug.
      try { videoRef.current?.pause() } catch { void 0 }
      setBootPipelineReady(true)
      setBootPipelineMessage('')

      const toastDesc = [
        `Pre-scan (${BOOT_PIPELINE_PASSES} passes).`,
        ver.summary,
        ver.warnings[0],
      ]
        .filter(Boolean)
        .join(' ')
      toast({
        title: ver.ok ? 'Ready — click play' : 'Ready with warnings — click play',
        description: toastDesc,
        variant: ver.ok ? 'default' : 'destructive',
      })

      void persistClipSession(file, localSessionIdRef.current || `local-${Date.now()}`)

      // Streaming narration is started from the ▶ Play button click handler rather than here,
      // so network + CPU isn't spent on an SSE stream before the user actually watches.
    } catch (e) {
      if (isVisionFirstSport(selectedSportRef.current)) setIngestionStage('failed')
      console.warn('[boot pipeline]', e)
      // Error path: keep playback LOCKED so the video never plays while systems are in a broken state.
      // The user can click "New Video" to retry or use the explicit retry button in the overlay.
      applyPlaybackLock(false)
      setBootPipelineReady(false)
      setBootPipelineMessage(
        e instanceof Error ? `Setup failed: ${e.message}` : 'Setup failed - pick a new clip to retry.'
      )
      setBootWarnings([e instanceof Error ? e.message : 'Setup failed. Pick a new clip to retry.'])
      toast({
        title: 'Setup failed — video stays paused',
        description: e instanceof Error ? e.message : 'Try a different clip (MP4 / H.264 recommended).',
        variant: 'destructive',
      })
      // AI analysis is NOT auto-triggered on error either. User must click "Analyze with AI".
    } finally {
      bootPipelineRunningRef.current = false
    }
  }

  const startPendingUploadBoot = () => {
    const file = pendingBootFileRef.current
    if (!file) {
      setSportPickerOpen(false)
      return
    }
    pendingBootFileRef.current = null
    setSportPickerOpen(false)
    // Match the old deferred start: React gets a paint to attach the video
    // element before metadata polling begins.
    setTimeout(() => {
      void runBootPipeline(file)
    }, 0)
  }

  const cancelPendingUploadBoot = () => {
    pendingBootFileRef.current = null
    setSportPickerOpen(false)
    setVideoFile(null)
    videoFileRef.current = null
    setVideoUrl(null)
    setClipLoadSource('none')
    clipLoadSourceRef.current = 'none'
    setClipStorageStatus('idle')
    setBootPipelineReady(false)
    setBootPipelineMessage('')
    if (videoObjectUrlRef.current) {
      try { URL.revokeObjectURL(videoObjectUrlRef.current) } catch { void 0 }
      videoObjectUrlRef.current = null
    }
  }

  const handleSportPickerOpenChange = (open: boolean) => {
    if (open || !pendingBootFileRef.current) {
      setSportPickerOpen(open)
      return
    }
    // Closing the mandatory fresh-upload picker means choosing another file;
    // never leave a selected video permanently locked with no boot pipeline.
    cancelPendingUploadBoot()
  }

  const runStreamingAnalysis = async (fileUri: string, sourceFile: File): Promise<boolean> => {
    if (streamAnalysisPhase === 'analyzing') return false
    streamAbortRef.current?.abort()
    const abort = new AbortController()
    streamAbortRef.current = abort

    setStreamAnalysisPhase('analyzing')
    setStreamAnalysisText('')
    setStreamEvidenceLedger(null)

    try {
      const poseEvidence = fightLangPoseFramesRef.current.length > 4
        ? fightLangPoseFramesRef.current.slice(-120)
        : undefined

      const res = await fetch('/api/fight', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'analyze_video_stream',
          videoFileUri: fileUri,
          videoMimeType: 'video/mp4',
          clipDuration: selectedWindowDurationSec(),
          startSec: analysisWindowRef.current.startSec,
          endSec: analysisWindowRef.current.endSec,
          videoAnalysisSessionId: videoAnalysisSessionIdRef.current,
          focusTarget,
          poseEvidence,
          ...currentFightClipAiMetadata(),
          poseEngine: rtmposeRequested() && isRtmposeReady() ? 'rtmpose' : 'mediapipe',
        }),
        signal: abort.signal,
      })

      if (!res.ok || !res.body) {
        throw new Error(`Stream analysis failed (${res.status})`)
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let fullText = ''
      let completed = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''

        for (const eventStr of events) {
          if (!eventStr.trim()) continue
          const lines = eventStr.split('\n')
          let eventType = ''
          let eventData = ''
          for (const line of lines) {
            if (line.startsWith('event: ')) eventType = line.slice(7).trim()
            else if (line.startsWith('data: ')) eventData = line.slice(6).trim()
          }
          if (!eventType || !eventData) continue

          let data: any
          try { data = JSON.parse(eventData) } catch { continue }

          switch (eventType) {
            case 'status':
              if (data.phase === 'scanning' || data.phase === 'verifying' || data.phase === 'analyzing') {
                setStreamAnalysisPhase('analyzing')
              }
              break
            case 'facts_complete':
            case 'scan_complete':
              if (data && Object.keys(data).length > 0) {
                setStreamEvidenceLedger(data)
                setCompiledLedger(data)
              }
              break
            case 'retrieval_complete':
              if (data && typeof data === 'object' && Array.isArray(data.snippets)) {
                setAutoRetrieval({
                  snippets: data.snippets.map((s: any) => ({
                    docId: String(s?.docId ?? ''),
                    namespace: String(s?.namespace ?? ''),
                    score: typeof s?.score === 'number' ? s.score : 0,
                    text: typeof s?.text === 'string' ? s.text : '',
                    title: s?.title ?? null,
                    segmentStartMs: typeof s?.segmentStartMs === 'number' ? s.segmentStartMs : null,
                    segmentEndMs: typeof s?.segmentEndMs === 'number' ? s.segmentEndMs : null,
                  })),
                  queryEmbeddingModel:
                    typeof data.queryEmbeddingModel === 'string' ? data.queryEmbeddingModel : undefined,
                })
              }
              break
            case 'chunk':
              if (data.text) {
                fullText += data.text
                setStreamAnalysisText(fullText)
              }
              break
            case 'complete':
              fullText = sanitizeCoachText(data.full_text || fullText)
              setStreamAnalysisText(fullText)
              if (fullText) {
                completed = true
                setStreamAnalysisPhase('complete')
              }
              // Feed the streaming result into the chat as the first assistant message
              if (fullText) {
                setMessages(prev => {
                  // Only add if no assistant message exists yet (avoid duplication with runInitialClipAnalysis)
                  if (prev.some(m => m.role === 'assistant')) return prev
                  return [{ role: 'assistant', content: fullText }]
                })
                setInitialAnalysisReady(true)
              }
              break
            case 'error':
              throw new Error(data.message || 'Stream analysis failed')
          }
        }
      }

      if (!fullText.trim()) {
        throw new Error('The streaming coach returned no analysis text.')
      }

      if (!completed) {
        fullText = sanitizeCoachText(fullText)
        setStreamAnalysisText(fullText)
        setStreamAnalysisPhase('complete')
        setMessages(prev => {
          if (prev.some(m => m.role === 'assistant')) return prev
          return [{ role: 'assistant', content: fullText }]
        })
        setInitialAnalysisReady(true)
      }
      return true
    } catch (err) {
      if ((err as Error).name === 'AbortError') return false
      console.warn('[Stream Analysis]', err)
      setStreamAnalysisPhase('error')
      setInitialAnalysisStatus(`Streaming analysis failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
      return false
    }
  }

  // Phase 2: Strategy analysis with pattern context
  const analyzeStrategyWithPatterns = async () => {
    if (!videoRef.current || !analysis) {
      toast({ title: 'No analysis available', variant: 'destructive' })
      return
    }
    
    setStrategyLoading(true)
    try {
      // Use native video if available, otherwise fall back to frames
      const requestBody: any = {
        focusTarget,
        analysis,
        kinematics: kinematicsRef.current,
        ...currentFightClipAiMetadata(),
        ...(geminiFileUri ? { videoFileUri: geminiFileUri } : {})
      }
      
      if (!geminiFileUri) {
        // Frame-based fallback
        const frames: string[] = []
        for (let i = 0; i < 5; i++) {
          const blob = await captureFrameAsBlob({ purpose: 'reflex' })
          const base64 = await new Promise<string>((resolve) => {
            const reader = new FileReader()
            reader.onload = () => resolve((reader.result as string).split(',')[1])
            reader.readAsDataURL(blob)
          })
          frames.push(base64)
        }
        requestBody.frames = frames
      }
      
      // Add pattern context if available
      if (patternAnalysis && patternAnalysis.topPatterns.length > 0) {
        requestBody.patterns = exportPatternsForAI(patternAnalysis)
      }
      
      // Add exchange timeline context
      if (exchangeTimeline && exchangeTimeline.exchanges.length > 0) {
        requestBody.exchangeSummary = {
          totalExchanges: exchangeTimeline.exchanges.length,
          avgDuration: exchangeTimeline.metadata.avgExchangeDuration,
          phases: exchangeTimeline.exchanges.map(e => e.phase)
        }
      }
      
      const response = await fetch('/api/fight/analyze-strategy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      })
      
      const data = await parseApiResponse(response) as { success?: boolean; error?: string; analysis?: { gameplan?: { priority1?: string; priority2?: string; priority3?: string; roundStrategy?: string }; weaknesses?: { tactical?: string[]; technical?: string[]; physical?: string[] }; strengths?: { identified?: string[]; leverage?: string } } }
      if (!response.ok) throw new Error(data.error || 'Strategy analysis failed')
      if (!data.success || !data.analysis) throw new Error(data.error || 'No analysis returned')
      const gp = data.analysis.gameplan
      const result: StrategyResponse = {
        gameplan: gp ? [gp.priority1, gp.priority2, gp.priority3, gp.roundStrategy].filter(Boolean).join('\n\n') : '',
        counters: data.analysis.strengths?.identified || [],
        weaknesses: [
          ...(data.analysis.weaknesses?.tactical || []),
          ...(data.analysis.weaknesses?.technical || []),
          ...(data.analysis.weaknesses?.physical || [])
        ],
        opportunities: data.analysis.strengths?.identified || []
      }
      setCurrentStrategy(result)
      
      toast({
        title: 'Strategy generated',
        description: 'AI tactical analysis complete with pattern insights'
      })
      
    } catch (error) {
      toast({
        title: 'Strategy analysis failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    } finally {
      setStrategyLoading(false)
    }
  }
  // YouTube-style breakdown generation
  const runBreakdown = async () => {
    const frames = fightLangPoseFramesRef.current
    if (frames.length < 4) {
      toast({ title: 'Not enough data', description: 'Play more of the clip first.', variant: 'destructive' })
      return
    }
    setBreakdownLoading(true)
    setBreakdownResult(null)
    try {
      const durMs = clipDurationSec > 0 ? Math.round(clipDurationSec * 1000) : undefined
      const slice = durMs ? slicePoseFramesFullClip(frames, durMs) : frames.slice(-200)
      const res = await fetch('/api/fight/breakdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          poseFrames: slice,
          clip: { durationMs: durMs },
          style: breakdownStyle,
          focusActor: focusTarget,
          ...currentFightClipAiMetadata(),
        }),
      })
      const json = await parseApiResponse<any>(res)
      if (!res.ok) throw new Error(json?.error || 'Breakdown failed')
      setBreakdownResult(json?.breakdown ?? null)
      // Merge breakdown overlay annotations with existing ones
      if (Array.isArray(json?.overlayAnnotations) && json.overlayAnnotations.length > 0) {
        setFightLangOverlayAnnotations((prev) => [
          ...(prev || []),
          ...json.overlayAnnotations,
        ])
      }
      toast({ title: 'Breakdown ready', description: json?.breakdown?.videoTitle || 'YouTube-style analysis complete.' })
    } catch (e) {
      toast({ title: 'Breakdown failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setBreakdownLoading(false)
    }
  }

  const hasA = Boolean(analysis?.candidates?.some((c: any) => c.id === 'A'))
  const hasB = Boolean(analysis?.candidates?.some((c: any) => c.id === 'B'))

  useEffect(() => {
    const stop = () => {
      if (reflexTimerRef.current != null) {
        window.clearTimeout(reflexTimerRef.current)
        reflexTimerRef.current = null
      }
      try {
        reflexAbortRef.current?.abort()
      } catch {
        void 0
      }
      reflexAbortRef.current = null
      reflexInFlightRef.current = false
      setReflexLoading(false)
    }

    const runOnce = async () => {
      if (!reflexOn) return
      const video = videoRef.current
      if (!video || !videoUrl) return
      if (video.readyState < 2) return
      if (video.paused) return

      const nowMs = Date.now()
      const minGap = Math.max(650, Math.floor(reflexCadenceMs * 0.75))
      if (nowMs - lastReflexReqMsRef.current < minGap) return
      if (reflexInFlightRef.current) return

      reflexInFlightRef.current = true
      lastReflexReqMsRef.current = nowMs
      setReflexLoading(true)

      const ctrl = new AbortController()
      try {
        reflexAbortRef.current?.abort()
      } catch {
        void 0
      }
      reflexAbortRef.current = ctrl

      try {
        const frameBlob = await captureFrameAsBlob({ purpose: 'reflex' })
        const form = new FormData()
        form.append('action', 'reflex')
        form.append('image', frameBlob, 'frame.jpg')
        const kin = kinematicsForAi()
        const context = {
          videoTimeSec:
            typeof video.currentTime === 'number' && Number.isFinite(video.currentTime) ? video.currentTime : null,
          analysisSource,
          selectedFighterId,
          focusTarget,
          pov: { myCorner, cornerForFighter: CORNER_FOR_FIGHTER },
          kinematics: kin,
          poseFocus: aiFocusPose,
          ...currentFightClipAiMetadata(),
        }
        form.append('context', JSON.stringify(context))

        const res = await fetch('/api/fight', {
          method: 'POST',
          body: form,
          signal: ctrl.signal,
        })

        if (redirectToLoginIfUnauthorized(res)) {
          throw new Error('Login required')
        }

        const data: any = await parseApiResponse(res)
        if (!res.ok) {
          throw new Error(String(data?.error || 'Reflex failed'))
        }

        const parsed = data as ReflexResponse
        const cue = typeof (parsed as any)?.cue === 'string' ? String((parsed as any).cue).trim() : ''
        const focus = typeof (parsed as any)?.focus === 'string' ? String((parsed as any).focus).trim() : ''

        if (cue) {
          setReflexCue(cue)
          setReflexFocus(focus || null)
          setReflexAtMs(Date.now())
          speakText(cue)
        }
      } catch (e) {
        if (ctrl.signal.aborted) return
        const msg = e instanceof Error ? e.message : 'Unknown error'
        const t = Date.now()
        if (t - lastReflexToastMsRef.current > 8000) {
          lastReflexToastMsRef.current = t
          toast({ variant: 'destructive', title: 'Reflex', description: msg })
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setReflexLoading(false)
        }
        reflexInFlightRef.current = false
      }
    }

    const schedule = () => {
      if (!reflexOn) return
      reflexTimerRef.current = window.setTimeout(async () => {
        await runOnce()
        schedule()
      }, reflexCadenceMs)
    }

    stop()
    if (reflexOn) schedule()
    return () => {
      stop()
    }
  }, [analysisSource, aiFocusPose, captureFrameAsBlob, currentFightClipAiMetadata, focusTarget, myCorner, reflexCadenceMs, reflexOn, selectedFighterId, speakText, toast, videoUrl])

  useEffect(() => {
    const stop = () => {
      if (trackTimerRef.current != null) {
        window.clearTimeout(trackTimerRef.current)
        trackTimerRef.current = null
      }
      try {
        trackAbortRef.current?.abort()
      } catch {
        void 0
      }
      trackAbortRef.current = null
      trackInFlightRef.current = false
      setTrackLoading(false)
    }

    const runOnce = async () => {
      if (!trackOn) return
      const target = trackTarget.trim()
      if (!target) return
      const video = videoRef.current
      if (!video || !videoUrl) return
      if (video.readyState < 2) return

      const nowMs = Date.now()
      const minGap = Math.max(600, Math.floor(trackCadenceMs * 0.75))
      if (nowMs - lastTrackReqMsRef.current < minGap) return
      if (trackInFlightRef.current) return

      trackInFlightRef.current = true
      lastTrackReqMsRef.current = nowMs
      setTrackLoading(true)

      const ctrl = new AbortController()
      try {
        trackAbortRef.current?.abort()
      } catch {
        void 0
      }
      trackAbortRef.current = ctrl

      try {
        const frameBlob = await captureFrameAsBlob({ purpose: 'track' })
        const form = new FormData()
        form.append('action', 'track')
        form.append('image', frameBlob, 'frame.jpg')
        form.append('target', target)

        const res = await fetch('/api/fight', {
          method: 'POST',
          body: form,
          signal: ctrl.signal,
        })

        if (redirectToLoginIfUnauthorized(res)) {
          throw new Error('Login required')
        }

        const data: any = await parseApiResponse(res)
        if (!res.ok) {
          throw new Error(String(data?.error || 'Smart Track failed'))
        }

        const parsed = data as TrackBoxResponse
        const hasBox =
          typeof parsed?.ymin === 'number' &&
          typeof parsed?.xmin === 'number' &&
          typeof parsed?.ymax === 'number' &&
          typeof parsed?.xmax === 'number'
        if (!hasBox) {
          throw new Error('Smart Track returned invalid coordinates')
        }

        const clamp = (n: number): number => Math.max(0, Math.min(1000, Number(n)))
        const normalized: TrackBoxResponse = {
          ymin: clamp(parsed.ymin),
          xmin: clamp(parsed.xmin),
          ymax: clamp(parsed.ymax),
          xmax: clamp(parsed.xmax),
          confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
          label: typeof parsed.label === 'string' ? parsed.label : undefined,
          notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
        }

        setTrackBox(normalized)
        setTrackAtMs(Date.now())
      } catch (e) {
        if (ctrl.signal.aborted) return
        const msg = e instanceof Error ? e.message : 'Unknown error'
        const t = Date.now()
        if (t - lastTrackToastMsRef.current > 8000) {
          lastTrackToastMsRef.current = t
          toast({ variant: 'destructive', title: 'Smart Track', description: msg })
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setTrackLoading(false)
        }
        trackInFlightRef.current = false
      }
    }

    const schedule = () => {
      if (!trackOn) return
      trackTimerRef.current = window.setTimeout(async () => {
        await runOnce()
        schedule()
      }, trackCadenceMs)
    }

    stop()
    if (trackOn) schedule()
    return () => {
      stop()
    }
  }, [captureFrameAsBlob, toast, trackCadenceMs, trackOn, trackTarget, videoUrl])

  useEffect(() => {
    if (!trackOn) {
      setTrackBox(null)
      setTrackAtMs(null)
    }
  }, [trackOn])

  // Fast compile: interval scales down for ≤12s clips; first tick runs as soon as playback is unlocked.
  useEffect(() => {
    if (!videoUrl || !playbackUnlocked) return
    const sched = getFightLangSchedule(clipDurationSec)
    let fastTimer: ReturnType<typeof setInterval> | null = null
    let stopped = false
    fastCompileHashRef.current = null

    const tryFastCompile = () => {
      if (stopped) return
      const frames = fightLangPoseFramesRef.current
      if (frames.length < sched.minFramesFast) return
      const lastFrame = frames[frames.length - 1]
      const frameBucket = Math.floor(frames.length / 8)
      const hash = `${frameBucket}:${Math.floor((lastFrame?.videoTimeSec ?? 0) * 2)}`
      if (hash === fastCompileHashRef.current) return
      fastCompileHashRef.current = hash
      const video = videoRef.current
      const durMs = video && video.duration > 0 ? Math.round(video.duration * 1000) : 0
      const windowMs = durMs > 0 && durMs < 22_000 ? durMs : 10_000
      void compileFightLangFast({ mode: 'window', windowMs })
    }

    const startDelay = setTimeout(() => {
      if (stopped) return
      tryFastCompile()
      fastTimer = setInterval(tryFastCompile, sched.fastIntervalMs)
    }, sched.fastDelayMs)

    return () => {
      stopped = true
      clearTimeout(startDelay)
      if (fastTimer) clearInterval(fastTimer)
    }
  }, [videoUrl, clipDurationSec, playbackUnlocked, compileFightLangFast])

  // LLM coaching auto-loop — COST-GATED.
  //   Only runs when the user has explicitly opted in (coachingEnabled) AND
  //   we're still under the per-session hard cap. This used to run from the
  //   moment playback unlocked and burned through Gemini 3.1 Pro calls every
  //   3.2s whether the user wanted coaching or not.
  useEffect(() => {
    if (!videoUrl || !playbackUnlocked || !coachingEnabled) return
    if (llmCallCount >= LLM_CALL_CAP) {
      console.warn('[FightCoach] Session LLM cap reached, auto-loop stopped')
      return
    }
    const sched = getFightLangSchedule(clipDurationSec)
    let llmTimer: ReturnType<typeof setInterval> | null = null
    let stopped = false
    let lastLedgerHash: string | null = null

    const hashLedger = () => {
      const frames = fightLangPoseFramesRef.current
      // Cheap identity signal: last-frame timestamp + count. Any new frame changes it.
      return `${frames.length}:${frames[frames.length - 1]?.tMs ?? 0}`
    }

    const tryFullAnalyze = () => {
      if (stopped) return
      if (isPoseQualitySpendBlocked()) return
      const frames = fightLangPoseFramesRef.current
      if (frames.length < sched.minFramesLlm) return
      // Dedup: skip calls when the underlying evidence hasn't changed.
      const h = hashLedger()
      if (h === lastLedgerHash) return
      lastLedgerHash = h
      setLlmCallCount((n) => n + 1)
      const video = videoRef.current
      const durMs = video && video.duration > 0 ? Math.round(video.duration * 1000) : 0
      const windowMs = durMs > 0 && durMs < 22_000 ? durMs : 15_000
      void analyzeFightLangWindow({ mode: 'window', windowMs, replayPass: clipEndPassCountRef.current })
    }

    const startDelay = setTimeout(() => {
      if (stopped) return
      tryFullAnalyze()
      llmTimer = setInterval(tryFullAnalyze, sched.llmIntervalMs)
    }, 0)

    return () => {
      stopped = true
      clearTimeout(startDelay)
      if (llmTimer) clearInterval(llmTimer)
    }
  }, [videoUrl, clipDurationSec, playbackUnlocked, coachingEnabled, llmCallCount, analyzeFightLangWindow, isPoseQualitySpendBlocked])

  // Auto-trigger strategy once initial clip analysis finishes (after playback gate opens)
  useEffect(() => {
    if (initialAnalysisReady && !currentStrategy && playbackUnlocked) {
      void analyzeStrategyWithPatterns()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAnalysisReady, playbackUnlocked])

  // First compile ASAP once pose frames exist (after boot unlock) for on-video annotations + preview strip
  useEffect(() => {
    if (!videoUrl || !playbackUnlocked) return
    earlyCompileOnceRef.current = false
    let stopped = false
    const id = window.setInterval(() => {
      if (stopped || earlyCompileOnceRef.current) return
      if (fightLangPoseFramesRef.current.length < 4) return
      earlyCompileOnceRef.current = true
      const v = videoRef.current
      const durMs = v && v.duration > 0 ? Math.round(v.duration * 1000) : 0
      const w = durMs > 0 && durMs < 22_000 ? durMs : 10_000
      void compileFightLangFast({ mode: 'window', windowMs: w })
    }, 70)
    const t = window.setTimeout(() => {
      stopped = true
      window.clearInterval(id)
    }, 14_000)
    return () => {
      stopped = true
      window.clearInterval(id)
      window.clearTimeout(t)
    }
  }, [videoUrl, playbackUnlocked, compileFightLangFast])

  // Slow motion during active FightLang annotations (lets lines / callouts read on-screen)
  useEffect(() => {
    const v = videoRef.current
    if (!v || !videoUrl) return
    if (!breakdownSlowMo) {
      v.playbackRate = 1
      return
    }
    const RATE_FOCUS = 0.52
    const RATE_NORMAL = 1
    const lingerMs = 1500
    const fadeMs = 300
    const tick = () => {
      const anns = fightLangOverlayAnnotations
      if (!anns?.length) {
        v.playbackRate = RATE_NORMAL
        return
      }
      const nowMs = Math.round((v.currentTime || 0) * 1000)
      const active = anns.filter(
        (a) => nowMs >= a.time.startMs - fadeMs && nowMs <= a.time.endMs + lingerMs
      )
      v.playbackRate = active.length > 0 ? RATE_FOCUS : RATE_NORMAL
    }
    v.addEventListener('timeupdate', tick)
    v.addEventListener('seeked', tick)
    tick()
    return () => {
      v.removeEventListener('timeupdate', tick)
      v.removeEventListener('seeked', tick)
      v.playbackRate = RATE_NORMAL
    }
  }, [videoUrl, breakdownSlowMo, fightLangOverlayAnnotations])

  // Cycle coaching banner: preview or LLM cues
  useEffect(() => {
    const llm = fightLangCoaching?.quickCues
    const prev = coachPreviewCoaching?.quickCues
    const cues = llm?.length ? llm : prev
    if (!cues || cues.length === 0) return
    setCoachBannerIdx(0)
    const ms = clipDurationSec > 0 && clipDurationSec <= 14 ? 2000 : 4200
    const timer = setInterval(() => {
      setCoachBannerIdx((p: number) => (p + 1) % cues.length)
    }, ms)
    return () => clearInterval(timer)
  }, [fightLangCoaching, coachPreviewCoaching, clipDurationSec])

  const replayClip = useCallback(() => {
    if (!videoUrl || !bootPipelineReady) return
    const video = videoRef.current
    if (!video) return
    applyPlaybackLock(true)
    try {
      video.currentTime = 0
      video.playbackRate = 1
    } catch {
      void 0
    }
    video.play().catch(() => {
      toast({
        title: 'Playback blocked',
        description: 'Click the video player once, then press Replay again.',
        variant: 'destructive',
      })
    })
    syncPlaybackState(video)
  }, [applyPlaybackLock, bootPipelineReady, syncPlaybackState, toast, videoUrl])

  const preScanCompleted = preScanProgress
    ? Math.min(preScanProgress.completed, preScanProgress.totalSteps)
    : bootLastPassFramesCompletedRef.current
  const preScanTotal = preScanProgress?.totalSteps ?? bootLastPassTotalStepsRef.current
  const preScanLabel = preScanTotal > 0 ? `${preScanCompleted}/${preScanTotal}` : 'waiting'
  const visionFirstActive = isVisionFirstSport(selectedSport)
  const clipPipelineStep: 'idle' | 'buffering' | 'prescanning' | 'ready' | 'playing' = !videoUrl
    ? 'idle'
    : playbackUnlocked
      ? 'playing'
      : bootPipelineReady
        ? 'ready'
        : visionFirstActive && (ingestionStage === 'gemini_ready' || ingestionStage === 'analyzing')
          ? 'prescanning'
          : fightLangPreScanBusy || /mapping fighters/i.test(bootPipelineMessage)
          ? 'prescanning'
          : 'buffering'

  const visionAnalyzeCtaLabel =
    resolveSportKey(selectedSport) === 'bjj_grappling' ? 'Analyze this roll' : 'Analyze this match'
  const visionTapeReady = Boolean(geminiFileUri)
  // Keep clickable when tape isn't ready so a failed upload can be retried via Analyze.
  const visionAnalyzeDisabled = !videoFile || uploadingVideo || fightLangLoading
  const ingestionStageLabel: Record<VideoIngestionStage, string> = {
    selected: 'Video selected',
    uploading_original: 'Uploading original video…',
    original_uploaded: 'Original video uploaded',
    normalizing: 'Server is normalizing your video…',
    normalized: 'Normalized video ready',
    uploading_to_gemini: 'Sending normalized video to Gemini…',
    gemini_processing: 'Gemini is processing the tape…',
    gemini_ready: 'Tape ready for AI coaching',
    analyzing: 'Building coaching feedback…',
    complete: 'Coaching complete',
    failed: 'Video processing failed',
  }
  const uploadTransferLabel = uploadByteProgress
    ? `${formatUploadBytes(uploadByteProgress.loadedBytes)} / ${formatUploadBytes(uploadByteProgress.totalBytes)} (${uploadProgress}%)`
    : uploadProgress > 0
      ? `${uploadProgress}%`
      : 'starting…'
  const ingestionStatusText = ingestionStage === 'uploading_original'
    ? `${ingestionStageLabel[ingestionStage]} ${uploadTransferLabel}`
    : ingestionStageLabel[ingestionStage]
  const bootPipelineFailed = ingestionStage === 'failed' || /^Setup failed:/i.test(bootPipelineMessage)

  // Idle-collapsed: no visible surface at all — the page's own uploader (home
  // hero) is the single upload terminal until a clip loads. min-h-screen would
  // otherwise leave a giant empty block under the hero.
  const idleCollapsed = collapseWhenIdle && !videoUrl
  const noClipLimitReached = !videoUrl && noClipChatCredits?.tier === 'free' && noClipChatCredits.remaining === 0

  return (
    <div className={idleCollapsed ? 'w-full' : 'min-h-screen w-full bg-background'}>
      {trimSelection ? (
        <ClipTimeWindowSlider
          file={trimSelection.file}
          maxSec={maxClipSec}
          onConfirm={(window: ClipTimeWindow) => {
            const pending = trimSelection
            setTrimSelection(null)
            // Timestamps only — upload the original bytes direct-to-R2.
            // Modal physically trims [startSec, endSec] server-side.
            setTimeout(() => {
              applyAnalysisWindow(window.startSec, window.endSec)
              onPickVideoRef.current(pending.file, pending.opts)
            }, 180)
          }}
          onCancel={() => setTrimSelection(null)}
        />
      ) : null}
      {/* Clip context step — starts the correct pipeline after a fresh upload. */}
      <Dialog open={sportPickerOpen} onOpenChange={handleSportPickerOpenChange}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>What type of fight clip is this?</DialogTitle>
            <DialogDescription>
              Pick the ruleset and context, then start the correct coaching path. BJJ, wrestling, and judo review the tape first; striking clips map movement first.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ruleset</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SPORT_OPTIONS.map((sport) => (
                <button
                  key={sport.value}
                  type="button"
                  onClick={() => pickSport(sport.value)}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-left transition-colors',
                    selectedSport === sport.value
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border/60 bg-card/60 hover:border-primary/50 hover:bg-primary/10',
                  )}
                >
                  <span className="block text-sm font-semibold">{sport.label}</span>
                  <span className="block text-[10px] text-muted-foreground">{sport.hint}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => pickSport('')}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-center text-xs font-semibold transition-colors',
                selectedSport === ''
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border/60 text-muted-foreground hover:border-primary/50 hover:bg-primary/10',
              )}
            >
              Auto-detect ruleset from the tape
            </button>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Clip context</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {CLIP_TYPE_OPTIONS.map((clipType) => (
                <button
                  key={clipType.value}
                  type="button"
                  onClick={() => pickClipType(clipType.value)}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-left transition-colors',
                    selectedClipType === clipType.value
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border/60 bg-card/60 hover:border-primary/50 hover:bg-primary/10',
                  )}
                >
                  <span className="block text-sm font-semibold">{clipType.label}</span>
                  <span className="block text-[10px] text-muted-foreground">{clipType.hint}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => pickClipType('')}
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-center text-xs font-semibold transition-colors',
                selectedClipType === ''
                  ? 'border-primary bg-primary/15 text-primary'
                  : 'border-border/60 text-muted-foreground hover:border-primary/50 hover:bg-primary/10',
              )}
            >
              No extra context
            </button>
          </div>

          {pendingBootFileRef.current ? (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={cancelPendingUploadBoot} className="w-full sm:w-auto">
                Choose another video
              </Button>
              <Button type="button" onClick={startPendingUploadBoot} className="w-full sm:w-auto">
                Start review
              </Button>
            </div>
          ) : (
            <Button type="button" onClick={() => setSportPickerOpen(false)} className="w-full">
              Use these settings
            </Button>
          )}
        </DialogContent>
      </Dialog>
      {!hideShellHeader && (
        <div className="border-b border-border/40 bg-card/30 backdrop-blur-xl">
          <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary/80 to-primary text-sm font-black text-primary-foreground shadow-lg">M</div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">Musashi</h1>
                <p className="text-[11px] text-muted-foreground">AI Fight Coach</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {videoUrl && (
                <Button size="sm" variant="outline" onClick={() => setSportPickerOpen(true)} title="Change the sport the coach uses for this clip">
                  Sport: {sportLabelFor(selectedSport)}
                  {selectedClipType ? ` · ${clipTypeLabelFor(selectedClipType)}` : ''}
                </Button>
              )}
              {videoUrl ? (
                <Button size="sm" variant="outline" onClick={() => { pendingBootFileRef.current = null; setVideoUrl(null); setVideoFile(null); videoFileRef.current = null; geminiFileUriRef.current = null; setGeminiFileUri(null); setMessages([]); setFightLangCoaching(null); setAiQuotaState(null); setFightLangOverlayAnnotations(null); setCompiledLedger(null); setInitialAnalysisReady(false); setStreamAnalysisPhase('idle'); setStreamAnalysisText(''); setAutoRetrieval(null); setStreamEvidenceLedger(null); applyPlaybackLock(false); setBootPipelineReady(false); setBootPipelineMessage(''); setClipLoadSource('none'); clipLoadSourceRef.current = 'none'; }}>
                  New Video
                </Button>
              ) : (
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0]
                      if (f) void requestVideoPick(f)
                      e.target.value = ''
                    }}
                  />
                  <div className="inline-flex h-9 items-center gap-2 rounded-md border border-primary/35 bg-primary/10 px-3 text-xs font-semibold text-primary transition-colors hover:bg-primary/20">
                    <Upload className="h-3.5 w-3.5" />
                    Choose Video
                  </div>
                </label>
              )}
            </div>
          </div>
        </div>
      )}

      {idleCollapsed ? (
        // No clip loaded: the full video/pose UI stays hidden (the page's own
        // uploader is the single upload terminal). General Q&A chat still
        // works, but it's portaled into the host page's own chat card
        // (idleChatSlotId) instead of drawing a second box here — one chat
        // surface, not two.
        idleChatSlotEl &&
        createPortal(
          <>
            {messages.length > 0 && (
              <div className="max-h-[320px] space-y-2 overflow-y-auto px-3 pt-3">
                {messages.map((m, idx) => (
                  <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={cn(
                        'max-w-[90%] rounded-xl px-3 py-2 text-sm',
                        m.role === 'user'
                          ? 'whitespace-pre-wrap bg-primary text-primary-foreground'
                          : 'bg-muted/60 border border-border/50 text-foreground',
                      )}
                    >
                      {m.role === 'assistant' ? <ChatMarkdown text={m.content ?? ''} /> : (m.content ?? '')}
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-3 py-2">
                      <div className="flex items-center gap-1">
                        <span className="animate-bounce">●</span>
                        <span className="animate-bounce" style={{ animationDelay: '100ms' }}>●</span>
                        <span className="animate-bounce" style={{ animationDelay: '200ms' }}>●</span>
                        <span className="ml-1 text-xs text-muted-foreground">Coaching…</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 px-3 py-[11px]">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-border/60 bg-background/30 px-[13px] py-[11px] text-[13.5px] outline-none focus:border-primary/50"
                placeholder={noClipLimitReached ? 'Upload a clip to keep chatting…' : 'Ask anything — no clip needed'}
                disabled={chatLoading || noClipLimitReached}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void sendChat() } }}
              />
              <Button
                size="icon"
                onClick={() => void sendChat()}
                disabled={!chatInput.trim() || chatLoading || noClipLimitReached}
                className="shrink-0 h-9 w-9"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            {!isShogun && (
              <p className="px-3 pb-3 text-[11px] text-muted-foreground">
                {!noClipChatCredits
                  ? 'Checking today’s free question balance…'
                  : noClipChatCredits.tier === 'pro'
                    ? 'No-video coaching is included with Pro.'
                    : noClipLimitReached
                      ? 'Daily free question limit reached — upload a clip or upgrade to Pro.'
                      : `${noClipChatCredits.remaining} free question${noClipChatCredits.remaining === 1 ? '' : 's'} left today without a clip.`}
              </p>
            )}
          </>,
          idleChatSlotEl,
        )
      ) : (
      <div className="mx-auto w-full max-w-7xl px-4 py-6">
        {/* Single column always: the whole (app) group renders inside
            MobileShell's phone-width frame (max-w-[440px], overflow-x-hidden).
            A viewport-based lg: two-column grid (1fr + 420px) can never fit in
            that container — it pushed the chat panel outside the frame on
            desktop, where it was clipped and unreachable. Video stacks above,
            chat + coaching below, at every screen size. */}
        <div className="grid grid-cols-1 gap-6">
            {/* LEFT: Video Player */}
            <div className="min-w-0 space-y-4">
              {/* Video Container */}
              <div className="overflow-hidden rounded-2xl border border-border/50 bg-black shadow-2xl">
                {videoUrl && videoFile && (
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/45 bg-card/95 px-4 py-3 backdrop-blur-sm">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/12">
                        <FileVideo className="h-4 w-4 text-primary" aria-hidden />
                      </div>
                      <div className="min-w-0 text-left">
                        <p className="font-display truncate text-sm tracking-wide text-foreground sm:text-base">
                          {videoFile.name}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {playbackUnlocked
                            ? poseOverlayOn
                              ? 'Playback unlocked — skeleton tracking live'
                              : 'Playback unlocked — skeleton overlay is off'
                            : bootPipelineReady
                              ? clipLoadSource === 'restored'
                                ? 'Restored your last clip — click Play'
                                : 'Ready — press the play button on the video'
                              : clipLoadSource === 'restored'
                                ? 'Restoring your last clip…'
                                : bootPipelineMessage || 'Preparing local pose mapping…'}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSportPickerOpen(true)}
                      title="Change the sport the coach uses for this clip"
                      className="shrink-0 rounded-full border border-border/60 bg-card/70 px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                    >
                      Sport: {sportLabelFor(selectedSport)}
                      {selectedClipType ? ` · ${clipTypeLabelFor(selectedClipType)}` : ''}
                    </button>
                    <CompactFocusToggle
                      currentFocus={focusTarget === 'A' ? 'blue' : focusTarget === 'B' ? 'red' : focusTarget === 'unsure' ? 'unsure' : 'both'}
                      onFocusChange={(focus) => {
                        if (focus === 'blue') { setFocusTarget('A'); setSelectedFighterId('A'); setAiFocusPose('A') }
                        else if (focus === 'red') { setFocusTarget('B'); setSelectedFighterId('B'); setAiFocusPose('B') }
                        else if (focus === 'unsure') { setFocusTarget('unsure'); setSelectedFighterId(null); setAiFocusPose('both') }
                        else { setFocusTarget('both'); setSelectedFighterId(null); setAiFocusPose('both') }
                        setSkeletonVisible({ A: true, B: true })
                      }}
                      showLabels
                    />
                    {visionFirstActive && videoUrl && (
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 shrink-0 text-xs font-semibold"
                        disabled={visionAnalyzeDisabled}
                        onClick={() => void analyzeFightLangWindow({ mode: 'full' })}
                        title={
                          !visionTapeReady
                            ? 'Preparing tape for vision analysis…'
                            : visionAnalyzeCtaLabel
                        }
                      >
                        {fightLangLoading ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                            Analyzing…
                          </>
                        ) : uploadingVideo ? (
                          <>
                            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                            Preparing tape…
                            {uploadProgress > 0 ? ` ${uploadProgress}%` : ''}
                          </>
                        ) : !visionTapeReady ? (
                          'Preparing tape…'
                        ) : (
                          visionAnalyzeCtaLabel
                        )}
                      </Button>
                    )}
                    <Badge
                      variant="secondary"
                      className={cn(
                        'shrink-0 border-0 text-[11px] font-semibold uppercase tracking-wide',
                        !bootPipelineReady && 'bg-sky-500/15 text-sky-200',
                        bootPipelineReady && !playbackUnlocked && 'bg-primary/20 text-primary',
                        playbackUnlocked && 'bg-emerald-500/15 text-emerald-200',
                      )}
                    >
                      {!bootPipelineReady ? (
                        <>
                          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" aria-hidden />
                          Preparing
                        </>
                      ) : playbackUnlocked ? (
                        <>
                          <CheckCircle2 className="mr-1.5 h-3 w-3" aria-hidden />
                          Live
                        </>
                      ) : (
                        <>
                          <Play className="mr-1.5 h-3 w-3 fill-current" aria-hidden />
                          Ready
                        </>
                      )}
                    </Badge>
                  </div>
                )}
                <div className="relative" style={{ lineHeight: 0 }}>
                  {videoUrl && playbackUnlocked && (
                    <div
                      className={cn(
                        'absolute left-2 top-2 z-30 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide shadow-md backdrop-blur-sm',
                        poseOverlayOn
                          ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100'
                          : 'border-border/60 bg-background/75 text-muted-foreground',
                      )}
                      aria-live="polite"
                    >
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full',
                          poseOverlayOn ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground/50',
                        )}
                        aria-hidden
                      />
                      {poseOverlayOn ? 'Skeleton ON' : 'Skeleton OFF'}
                    </div>
                  )}
                  {videoUrl && playbackUnlocked && poseEngineInfo && (
                    <div className="absolute bottom-2 left-2 z-30">
                      <PoseQualityBadge
                        info={poseEngineInfo}
                        blocked={poseEngineInfo.quality?.recommendation === 'request_better_clip'}
                        overrideActive={poseQualityOverride}
                        onOverride={() => setPoseQualityOverride(true)}
                      />
                    </div>
                  )}
                  {/* Mute + Slow-Mo buttons */}
                  <div className="absolute right-2 top-2 z-30 flex flex-col gap-1.5">
                    <Button type="button" size="icon" variant="secondary" disabled={!videoUrl} className="h-8 w-8 rounded-full border border-border/60 bg-background/70 shadow-md backdrop-blur-sm disabled:opacity-50" title={videoMuted ? 'Unmute' : 'Mute'} onClick={() => setVideoMuted((m) => !m)}>
                      {videoMuted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    </Button>
                    <Button type="button" size="icon" variant={breakdownSlowMo ? 'default' : 'secondary'} disabled={!videoUrl} className="h-8 w-8 rounded-full border border-border/60 bg-background/70 shadow-md backdrop-blur-sm disabled:opacity-50" title="Auto slo-mo during callouts" onClick={() => setBreakdownSlowMo((s) => !s)}>
                      <Gauge className="h-3.5 w-3.5" />
                    </Button>
                  </div>

                  {videoUrl ? (
                    <video
                      ref={videoRef}
                      src={videoUrl}
                      controls={playbackUnlocked}
                      muted={videoMuted || !playbackUnlocked}
                      autoPlay={false}
                      playsInline
                      preload={playbackUnlocked ? 'metadata' : 'auto'}
                      tabIndex={playbackUnlocked ? 0 : -1}
                      onVolumeChange={(e) => setVideoMuted(e.currentTarget.muted)}
                      onPlay={(e) => {
                        // Synchronous gate: use the ref (not React state) so this fires the same
                        // microtask the browser dispatches the event. Prevents any frame from rendering.
                        if (!playbackUnlockedRef.current) {
                          try { e.currentTarget.pause() } catch { void 0 }
                          try { if (e.currentTarget.currentTime > 0) e.currentTarget.currentTime = 0 } catch { void 0 }
                          return
                        }
                        // First legit play of this clip: surface the AI-coaching consent
                        // dialog immediately instead of leaving it buried in Advanced
                        // Controls, so feedback starts the moment the user presses play.
                        // Still requires the one-tap consent — this is real Gemini spend.
                        if (!visionFirstActive && !autoCoachPromptShownRef.current && !coachingEnabled) {
                          autoCoachPromptShownRef.current = true
                          setCoachingConfirmOpen(true)
                        }
                      }}
                      onPlaying={(e) => {
                        if (!playbackUnlockedRef.current) {
                          try { e.currentTarget.pause() } catch { void 0 }
                        }
                      }}
                      onLoadedMetadata={(e) => {
                        const d = e.currentTarget.duration
                        if (Number.isFinite(d) && d > 0) {
                          // Window before duration state — vision-first upload
                          // effect keys off clipDurationSec and must not see a
                          // missing window (full-file fallback → "too long").
                          ensureAnalysisWindow(d)
                          setClipDurationSec(d)
                        }
                      }}
                      onError={(e) => {
                        if (isVisionFirstSport(selectedSportRef.current) && !geminiFileUriRef.current) {
                          // HEVC/VFR phone originals may be undecodable by the
                          // browser. Keep the BJJ tape pipeline alive: it will
                          // replace this preview with the server-normalized MP4.
                          setMediaErrorMessage('Original preview needs server normalization. Preparing a mobile-safe video…')
                          setBootPipelineMessage('Original preview needs server normalization…')
                          return
                        }
                        // Media error: keep playback locked, reset analyzer, show message.
                        applyPlaybackLock(false)
                        setBootPipelineReady(false)
                        setBootPipelineMessage('Could not open this video - try a different file.')
                        setMediaErrorMessage('The browser could not decode this video. Try MP4 (H.264/AAC) or WebM.')
                        toast({
                          title: 'Could not open this video',
                          description: 'Try MP4 (H.264/AAC) or WebM. Some phone clips need re-encoding.',
                          variant: 'destructive',
                        })
                      }}
                      onEnded={() => {
                        const video = videoRef.current
                        if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
                        const durMs = Math.round(video.duration * 1000)
                        const frames = fightLangPoseFramesRef.current
                        if (!hasNearFullClipCoverage(frames, durMs)) return
                        const now = Date.now()
                        if (now - lastFullClipEndRunRef.current < 1200) return
                        lastFullClipEndRunRef.current = now
                        clipEndPassCountRef.current += 1
                        void compileFightLangFast({ mode: 'full' })
                        if (coachingEnabled && llmCallCount < LLM_CALL_CAP && !isPoseQualitySpendBlocked()) {
                          setLlmCallCount((n) => n + 1)
                          void analyzeFightLangWindow({ mode: 'full', replayPass: clipEndPassCountRef.current })
                        }
                      }}
                      className={cn('w-full block', !playbackUnlocked && 'pointer-events-none select-none')} style={{ objectFit: 'contain', pointerEvents: playbackUnlocked ? 'auto' : 'none' }}
                      onPause={() => {
                        if (!autoAnalyzeOnPause) return
                        if (analyzing) return
                        setTimeout(() => {
                          const video = videoRef.current
                          if (!video) return
                          const t = video.currentTime
                          if (typeof t !== 'number') return
                          if (analysisSource === 'style_scan' && typeof analysisAtTime === 'number' && Math.abs(t - analysisAtTime) < 0.45) return
                          if (Math.abs(t - lastAutoAnalyzeTimeRef.current) < 0.35) return
                          if (video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) {
                            lastAutoAnalyzeTimeRef.current = t
                            void analyzeCurrentFrame()
                          }
                        }, 100)
                      }}
                    />
                  ) : (
                    <div className="flex w-full aspect-video flex-col items-center justify-center gap-4 bg-zinc-950 px-6 text-center">
                      <p className="text-sm font-medium text-foreground">No clip loaded yet</p>
                      <p className="max-w-sm text-xs text-muted-foreground">
                        Or try the demo clip — choose a clip each time, nothing auto-loads on reload.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-10 border-white/15 bg-white/5 text-foreground hover:bg-white/10"
                        disabled={demoClipLoading}
                        onClick={() => void loadDemoClip()}
                      >
                        {demoClipLoading ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Play className="mr-2 h-4 w-4" />
                        )}
                        Try demo clip
                      </Button>
                    </div>
                  )}

                  {/* Boot pipeline gate: fully-opaque overlay until the user clicks ▶ Play.
                      Two visual states:
                        - !bootPipelineReady → spinner + progress message
                        - bootPipelineReady  → big ▶ Play button, user must click to unlock
                      pointer-events: auto + stopPropagation on spinner state swallows clicks
                      so nothing bubbles to the video. The Play-button state has its own onClick. */}
                  {!playbackUnlocked && videoUrl && (
                    <div
                      className="absolute inset-0 z-[60] flex flex-col items-center justify-center gap-5 bg-black px-6 text-center"
                      style={{ pointerEvents: 'auto' }}
                      onClick={(e) => { if (!bootPipelineReady) { e.preventDefault(); e.stopPropagation() } }}
                      onMouseDown={(e) => { if (!bootPipelineReady) { e.preventDefault(); e.stopPropagation() } }}
                      onKeyDown={(e) => { if (!bootPipelineReady) { e.preventDefault(); e.stopPropagation() } }}
                    >
                      {!bootPipelineReady ? (
                        <>
                          {bootPipelineFailed
                            ? <AlertTriangle className="h-10 w-10 text-amber-400" />
                            : <Loader2 className="h-10 w-10 animate-spin text-primary" />}
                          <p className="font-display text-lg tracking-wide text-white">
                            {clipLoadSource === 'restored' ? 'Restoring your last clip' : 'Preparing your clip'}
                          </p>
                          <p className="max-w-xs text-sm text-white/75">{bootPipelineMessage || 'Starting…'}</p>
                          <div className="flex flex-wrap items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-wide">
                            {(['buffering', 'prescanning', 'ready'] as const).map((step) => {
                              const labels = {
                                buffering: visionFirstActive ? '1 · Upload tape' : '1 · Buffer',
                                prescanning: visionFirstActive ? '2 · Review tape' : `2 · Pre-scan ${preScanLabel}`,
                                ready: visionFirstActive ? '3 · Coach Cards' : '3 · Ready',
                              } as const
                              const active =
                                clipPipelineStep === step ||
                                (step === 'buffering' && clipPipelineStep === 'buffering') ||
                                (step === 'prescanning' && clipPipelineStep === 'prescanning')
                              const done =
                                (step === 'buffering' && (clipPipelineStep === 'prescanning' || clipPipelineStep === 'ready')) ||
                                (step === 'prescanning' && clipPipelineStep === 'ready')
                              return (
                                <span
                                  key={step}
                                  className={cn(
                                    'rounded-full px-2.5 py-1',
                                    done && 'bg-emerald-500/20 text-emerald-100',
                                    active && !done && 'bg-primary/25 text-primary-foreground',
                                    !active && !done && 'bg-white/10 text-white/45',
                                  )}
                                >
                                  {labels[step]}
                                </span>
                              )
                            })}
                          </div>
                          <div className="h-2 w-64 overflow-hidden rounded-full bg-white/15">
                            <div className="musashi-boot-bar h-full w-1/3 rounded-full bg-primary" />
                          </div>
                          <p className="max-w-sm text-xs text-white/55">
                            {visionFirstActive
                              ? uploadingVideo
                                ? ingestionStatusText
                                : 'Vision coaching reviews the tape directly; grappling does not use a pose-frame counter. When Ready, hit Play.'
                              : 'MediaPipe pose tracking runs locally while paused. When you see Ready, click Play for skeleton overlays.'}
                          </p>
                          {bootPipelineFailed && videoFile && (
                            <Button
                              type="button"
                              variant="outline"
                              onMouseDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                nativeUploadErrorRef.current = null
                                setBootWarnings([])
                                setIngestionStage('selected')
                                void runBootPipeline(videoFile)
                              }}
                            >
                              Retry upload &amp; analysis
                            </Button>
                          )}
                          <RotatingWisdom sport={selectedSport} />
                        </>
                      ) : (
                        <>
                          <div className="relative">
                            <div className="absolute inset-0 rounded-full bg-primary/20 blur-2xl" aria-hidden />
                            <button
                            type="button"
                            aria-label="Play video"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              // User consent to play — flip the lock, then call play().
                              applyPlaybackLock(true)
                              const v = videoRef.current
                              if (!v) {
                                toast({
                                  title: "Couldn't play this clip",
                                  description: 'Video player not ready. Try New clip or re-upload.',
                                  variant: 'destructive',
                                })
                                applyPlaybackLock(false)
                                return
                              }
                              try {
                                if (v.currentTime > 0) v.currentTime = 0
                              } catch { void 0 }
                              void v.play().then(() => {
                                // Bad trim/output can "play" with no picture — fail loudly.
                                window.setTimeout(() => {
                                  const el = videoRef.current
                                  if (!el || !playbackUnlockedRef.current) return
                                  if (el.videoWidth === 0 || el.videoHeight === 0) {
                                    applyPlaybackLock(false)
                                    setBootPipelineReady(false)
                                    setBootPipelineMessage('This clip has no picture — re-trim or try MP4 (H.264).')
                                    toast({
                                      title: "Couldn't play this clip",
                                      description: 'The trim/upload likely produced an unplayable file. Re-trim or use MP4 (H.264).',
                                      variant: 'destructive',
                                    })
                                  }
                                }, 500)
                              }).catch((err) => {
                                applyPlaybackLock(false)
                                const msg = err instanceof Error ? err.message : 'Playback blocked'
                                toast({
                                  title: "Couldn't play this clip",
                                  description: `${msg}. Try MP4 (H.264) or re-trim.`,
                                  variant: 'destructive',
                                })
                              })
                              // Kick off long-form streaming narration after a short delay.
                              const uri = geminiFileUriRef.current
                              if (!visionFirstActive && uri && videoFileRef.current) {
                                setTimeout(() => {
                                  if (videoFileRef.current) void runStreamingAnalysis(uri, videoFileRef.current)
                                }, 1500)
                              }
                            }}
                            className="musashi-ready-play group relative flex h-28 w-28 items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/50"
                          >
                            <Play className="h-14 w-14 fill-current" strokeWidth={0} />
                          </button>
                          </div>
                          <Badge className="border-0 bg-emerald-500/20 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-emerald-100">
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                            Ready — click to play
                          </Badge>
                          {visionFirstActive && (
                            <Button
                              type="button"
                              size="lg"
                              className="mt-1 min-w-[220px] font-semibold"
                              disabled={visionAnalyzeDisabled}
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                void analyzeFightLangWindow({ mode: 'full' })
                              }}
                            >
                              {fightLangLoading ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                                  Analyzing…
                                </>
                              ) : uploadingVideo ? (
                                <>
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                                  Preparing tape…
                                  {uploadProgress > 0 ? ` ${uploadProgress}%` : ''}
                                </>
                              ) : !visionTapeReady ? (
                                'Preparing tape…'
                              ) : (
                                visionAnalyzeCtaLabel
                              )}
                            </Button>
                          )}
                          <p className="max-w-md text-sm text-white/80">
                            {visionFirstActive
                              ? visionTapeReady
                                ? 'Tape is ready. Analyze fills Coach Cards from the video + sport brain — skeleton stays off.'
                                : 'Preparing tape for vision coaching… Analyze unlocks when upload finishes.'
                              : clipLoadSource === 'restored'
                                ? 'Your last clip is ready. Press play to start skeleton tracking.'
                                : 'Your video is ready. Skeleton mapping can continue while you play.'}{' '}
                            Deeper AI analysis only runs when you choose it.
                          </p>
                          {bootVerificationSummary && (
                            <p className="max-w-md text-xs text-white/50">{bootVerificationSummary}</p>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Pre-scan overlay */}
                  {fightLangPreScanBusy && playbackUnlocked && (
                    <div className="pointer-events-none absolute right-3 top-12 z-[25] flex items-center gap-2 rounded-full border border-primary/30 bg-background/85 px-3 py-2 shadow-lg backdrop-blur">
                      <Loader2 className="h-7 w-7 animate-spin text-primary" />
                      <p className="text-xs font-medium text-foreground">Mapping fighters across the clip…</p>
                    </div>
                  )}

                  {/* COMET scan-line animation during streaming analysis */}
                  {streamAnalysisPhase === 'analyzing' && (
                    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden rounded-t-lg">
                      <div className="absolute inset-0 bg-black/10" />
                      <div
                        className="musashi-scan-line"
                        style={{
                          background: 'linear-gradient(90deg, transparent, hsl(var(--primary)), transparent)',
                          boxShadow: '0 0 12px hsl(var(--primary)), 0 0 24px color-mix(in srgb, hsl(var(--primary)) 30%, transparent)',
                        }}
                      />
                      <div className="absolute top-3 left-3 flex items-center gap-2 rounded-lg border border-primary/50 bg-black/75 px-3 py-1.5 text-xs font-semibold text-primary backdrop-blur-sm">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                        Analyzing…
                      </div>
                    </div>
                  )}

                  {/* FightAnalyzer (pose detection engine) */}
                  <FightAnalyzer
                    videoRef={videoRef}
                    enabled={Boolean(videoUrl) && !visionFirstActive}
                    preScanOnLoad
                    preScanPasses={BOOT_PIPELINE_PASSES}
                    preScanResetKey={videoUrl ?? ''}
                    onPreScanComplete={() => {
                      prescanBootResolveRef.current?.()
                      prescanBootResolveRef.current = null
                    }}
                    onPreScanFrame={recordPreScanFrame}
                    onPreScanPoseDetected={(detected) => {
                      setPreScanDetections((prev) => ({
                        samples: prev.samples + 1,
                        A: prev.A + (detected.A ? 1 : 0),
                        B: prev.B + (detected.B ? 1 : 0),
                        both: prev.both + (detected.A && detected.B ? 1 : 0),
                      }))
                    }}
                    onPreScanActiveChange={setFightLangPreScanBusy} focus={aiFocusPose}
                    onDenseTrackReady={(n, info) => {
                      setDeepTrackFrames(n)
                      if (info) {
                        poseEngineInfoRef.current = info
                        setPoseEngineInfo(info)
                        setPoseQualityOverride(false)
                      }
                    }}
                    onPose3DTrackReady={(frames) => {
                      pose3DFramesRef.current = frames
                    }}
                    onPoseVideoTime={(videoTimeMs) => {
                      latestPoseVideoTimeMsRef.current = videoTimeMs
                    }}
                    onPose={(pose) => {
                      setLatestPose(pose)
                      latestPoseRef.current = pose
                      overlayRedrawRef.current?.()
                      const video = videoRef.current
                      const videoTimeSec = video && typeof video.currentTime === 'number' ? video.currentTime : null
                      const videoMs = Math.round((videoTimeSec ?? 0) * 1000)
                      if (localRawLandmarksOn) {
                        const now = Date.now()
                        if (now - lastLocalPoseRawMsRef.current >= 100) {
                          lastLocalPoseRawMsRef.current = now
                          localPoseFramesRef.current.push({
                            tMs: videoMs,
                            videoTimeSec,
                            landmarks: { A: pose.A, B: pose.B },
                          })
                          const cutoff = videoMs - 120000
                          while (localPoseFramesRef.current.length > 0 && localPoseFramesRef.current[0]!.tMs < cutoff) {
                            localPoseFramesRef.current.shift()
                          }
                        }
                      }
                      const toLm = (lm: NormalizedLandmark): FightLangPoseLandmark => ({ x: lm.x, y: lm.y, z: typeof lm.z === 'number' ? lm.z : undefined, visibility: typeof lm.visibility === 'number' ? lm.visibility : undefined })
                      const bucket = Math.floor(videoMs / 100) * 100
                      if (lastFightLangVideoBucketRef.current === bucket) return
                      lastFightLangVideoBucketRef.current = bucket
                      const frame: FightLangPoseFrame = { tMs: videoMs, videoTimeSec, actors: { ...(pose.A ? { A: pose.A.map(toLm) } : {}), ...(pose.B ? { B: pose.B.map(toLm) } : {}) } }
                      const buf = fightLangPoseFramesRef.current
                      buf.push(frame)
                      const cutoff = videoMs - 30000
                      while (buf.length > 0 && buf[0]!.tMs < cutoff) buf.shift()
                      setPoseFrameCount(buf.length)
                      setLastPoseSampleMs(videoMs)
                      setMediaErrorMessage(null)
                    }}
                    onPoseDetected={setPoseDetected}
                    onFrameEvidence={(frame) => {
                      const now = performance.now()
                      // Throttle ledger re-renders to ~4/s (250ms). Was 140ms — too many React
                      // re-renders steal decode time and cause video stutter.
                      if (now - lastLedgerIngestMsRef.current < 250) return
                      lastLedgerIngestMsRef.current = now
                      setFightEvidenceLedger((prev) => ingestFrameEvidence(prev ?? createEmptyLedger(), frame))
                    }}
                    onKinematics={(snapshot) => {
                      // Always update the ref (cheap, no re-render) for anything that reads kinematicsRef.
                      kinematicsRef.current = snapshot
                      // Throttle the UI state update to ~4/s so React re-renders don't stall video.
                      const now = performance.now()
                      const shouldPublishKinematics = now - lastLocalKinMsRef.current > 250
                      if (shouldPublishKinematics) {
                        lastLocalKinMsRef.current = now
                        setKinematicsUi(snapshot)
                      }
                      if (localRecordOn && shouldPublishKinematics) {
                          localKinematicsSeriesRef.current.push(snapshot)
                          if (localKinematicsSeriesRef.current.length >= 30 && !autoExchangeDoneRef.current) {
                            autoExchangeDoneRef.current = true
                            queueMicrotask(() => {
                              void analyzeExchangesAndPatterns()
                            })
                          }
                      }
                    }}
                  />

                  {/* FightOverlay (skeleton + annotation rendering) */}
                  <FightOverlay videoRef={videoRef} canvasRef={overlayCanvasRef} enabled={poseOverlayOn} latestPose={latestPose} latestPoseLiveRef={latestPoseRef} latestPoseVideoTimeMsRef={latestPoseVideoTimeMsRef} registerRedraw={(fn) => { overlayRedrawRef.current = fn }} skeletonVisible={skeletonVisible} aiFocusPose={aiFocusPose} myCorner={myCorner} ledger={fightEvidenceLedger} overlayAnnotations={fightLangOverlayAnnotations} />

                  {/* Callout count badge */}
                  {fightLangOverlayAnnotations && fightLangOverlayAnnotations.length > 0 && (
                    <div className="pointer-events-none absolute left-2 top-2 z-20 flex items-center gap-1.5 rounded-full border border-cyan-500/40 bg-cyan-950/80 px-2.5 py-1 backdrop-blur-sm">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400 shadow-[0_0_6px_rgba(34,211,238,0.6)]" />
                      <span className="text-[11px] font-semibold text-cyan-200">{fightLangOverlayAnnotations.length} callouts</span>
                    </div>
                  )}

                  {/* Reflex cue overlay */}
                  {reflexOn && reflexCue && (
                    <div className="pointer-events-none absolute bottom-3 left-1/2 w-[92%] -translate-x-1/2 rounded-xl border border-border/60 bg-background/60 px-4 py-2 text-center text-sm font-medium text-foreground backdrop-blur-xl">
                      {reflexFocus ? `${reflexFocus.toUpperCase()}: ` : ''}{reflexCue}
                    </div>
                  )}

                  {/* Track box overlay */}
                  {trackOn && trackBox && (
                    <div className="pointer-events-none absolute inset-0">
                      <div className="absolute rounded-xl border-2 border-emerald-400/80 bg-emerald-400/10 text-[10px] font-medium uppercase tracking-wide text-emerald-100"
                        style={{ top: `${trackBox.ymin / 10}%`, left: `${trackBox.xmin / 10}%`, width: `${Math.max(2, (trackBox.xmax - trackBox.xmin) / 10)}%`, height: `${Math.max(2, (trackBox.ymax - trackBox.ymin) / 10)}%` }}>
                        <div className="px-1 py-0.5">{(trackBox.label || trackTarget).toUpperCase()}</div>
                      </div>
                    </div>
                  )}

                  {playbackUnlocked && playbackState.ended && videoUrl && (
                    <div className="absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
                      <button
                        type="button"
                        onClick={replayClip}
                        className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-black/75 px-4 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-md transition hover:bg-black/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Replay with live CV
                      </button>
                    </div>
                  )}

                  {/* Click-to-select fighters (opt-in, OFF by default). When on, a
                      tap maps to the nearest fighter and focuses the skeleton on
                      them (empty space → both). Does not touch tracking. */}
                  {videoUrl && (
                    <button
                      type="button"
                      onClick={() => setSelectMode((m) => !m)}
                      className={`absolute bottom-2 left-2 z-40 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm transition ${selectMode ? 'border-primary bg-primary/85 text-white' : 'border-white/25 bg-black/70 text-white/85 hover:bg-black/85'}`}
                    >
                      ◎ {selectMode ? 'Tap a fighter…' : 'Select'}
                    </button>
                  )}
                  {selectMode && (
                    <div
                      className="absolute inset-0 z-30 cursor-crosshair"
                      onClick={(e) => {
                        const v = videoRef.current
                        const rect = e.currentTarget.getBoundingClientRect()
                        const cw = rect.width
                        const ch = rect.height
                        const vw = v?.videoWidth || cw
                        const vh = v?.videoHeight || ch
                        const scale = Math.min(cw / vw, ch / vh)
                        const dispW = vw * scale
                        const dispH = vh * scale
                        const nx = (e.clientX - rect.left - (cw - dispW) / 2) / dispW
                        const ny = (e.clientY - rect.top - (ch - dispH) / 2) / dispH
                        if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return
                        const lp = latestPoseRef.current
                        const cands: { box: { left: number; top: number; right: number; bottom: number }; center: { x: number; y: number } }[] = []
                        const slots: ('A' | 'B')[] = []
                        for (const slot of ['A', 'B'] as const) {
                          const p = lp[slot]
                          if (!p) continue
                          const hx = ((p[23]?.x ?? 0.5) + (p[24]?.x ?? 0.5)) / 2
                          const hy = ((p[23]?.y ?? 0.5) + (p[24]?.y ?? 0.5)) / 2
                          cands.push({ box: { left: hx, top: hy, right: hx, bottom: hy }, center: { x: hx, y: hy } })
                          slots.push(slot)
                        }
                        const i = pickByClick(cands, { x: nx, y: ny }, 0.18)
                        if (i < 0) {
                          setAiFocusPose('both')
                          setFocusTarget('both')
                          setSelectedFighterId(null)
                        } else {
                          const s = slots[i]
                          setAiFocusPose(s)
                          setFocusTarget(s)
                          setSelectedFighterId(s)
                        }
                        setSelectMode(false)
                      }}
                    />
                  )}
                </div>
              </div>

              {/* Compact Controls Bar */}
              <div className="flex flex-wrap items-center gap-2">
                {hideShellHeader && videoUrl && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs shrink-0"
                    onClick={() => {
                      setVideoUrl(null)
                      setVideoFile(null)
                      videoFileRef.current = null
                      geminiFileUriRef.current = null
                      setGeminiFileUri(null)
                      setMessages([])
                      setFightLangCoaching(null)
                      setFightLangOverlayAnnotations(null)
                      setCompiledLedger(null)
                      setInitialAnalysisReady(false)
                      setStreamAnalysisPhase('idle')
                      setStreamAnalysisText('')
                      setAutoRetrieval(null)
                      setStreamEvidenceLedger(null)
                      applyPlaybackLock(false)
                      setBootPipelineReady(false)
                      setBootPipelineMessage('')
                      setClipLoadSource('none')
                    }}
                  >
                    New clip
                  </Button>
                )}
                <Button size="sm" variant={poseOverlayOn ? 'secondary' : 'ghost'} className="h-8 text-xs" onClick={() => setPoseOverlayOn((p) => !p)}>
                  {poseOverlayOn ? 'Skeleton ON' : 'Skeleton OFF'}
                </Button>
                <Button size="sm" variant={reflexOn ? 'default' : 'ghost'} className="h-8 text-xs" onClick={() => setReflexOn((r) => !r)}>
                  {reflexOn ? 'Reflex ON' : 'Reflex'}
                </Button>
                {kinematicsUi?.range && (
                  <span className="text-[11px] text-muted-foreground ml-auto">Range: {kinematicsUi.range.band}</span>
                )}
              </div>

              {/* AI Coaching Panel */}
              <div>
                {fightLangLoading && (
                  <div className="mb-3 flex items-center gap-2 rounded-xl border border-cyan-500/30 bg-cyan-950/40 px-4 py-3">
                    <Loader2 className="h-4 w-4 animate-spin text-cyan-400" />
                    <span className="text-sm font-medium text-cyan-100">AI analyzing your clip…</span>
                  </div>
                )}
                <CoachingPanel
                  payload={fightLangCoaching}
                  llmIssues={fightLangLlmIssues ?? undefined}
                  overlayCount={fightLangOverlayAnnotations?.length ?? 0}
                  quotaState={aiQuotaState}
                  ratingContext={fightLangRatingContext}
                  clipDurationMs={
                    (() => {
                      const winMs = Math.round(selectedWindowDurationSec() * 1000)
                      return winMs > 0 ? winMs : clipDurationSec > 0 ? Math.round(clipDurationSec * 1000) : null
                    })()
                  }
                  isAdmin={isShogun}
                />
              </div>

              {/* Pipeline Stats (compact) */}
              {pipelineStats && (
                <div className="rounded-xl border border-border/40 bg-card/30 p-3 text-[11px] text-muted-foreground">
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="font-medium text-foreground">Frames:</span> {pipelineStats.poseFrames}</div>
                    <div><span className="font-medium text-foreground">Events:</span> {pipelineStats.events}</div>
                    <div><span className="font-medium text-foreground">Faults:</span> {pipelineStats.faults}</div>
                    <div><span className="font-medium text-foreground">Callouts:</span> {pipelineStats.overlayAnnotations}</div>
                  </div>
                  {pipelineStats.retrievalSnippets > 0 && (
                    <div className="mt-1"><span className="font-medium text-foreground">Knowledge:</span> {pipelineStats.retrievalSnippets} docs grounding AI</div>
                  )}
                </div>
              )}

              {/* Advanced Controls - Collapsible */}
              <details className="rounded-xl border border-border/40 bg-card/20">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
                  Advanced Controls
                </summary>
                <div className="space-y-3 px-4 pb-4 pt-1">
                  {/* Hardware tier badge — the app auto-adapts to your device so the skeleton stays smooth */}
                  <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/30 px-3 py-2 text-[11px]">
                    <span className="font-medium text-foreground">Performance mode:</span>
                    <span className={cn(
                      'rounded px-2 py-0.5 font-semibold',
                      hwProfile.tier === 'lite' && 'bg-amber-500/20 text-amber-200',
                      hwProfile.tier === 'balanced' && 'bg-sky-500/20 text-sky-200',
                      hwProfile.tier === 'max' && 'bg-emerald-500/20 text-emerald-200',
                    )}>
                      {hwProfile.tier.toUpperCase()}
                    </span>
                    <span className="text-muted-foreground">
                      {hwProfile.tier === 'lite' && 'Lightweight device mode for smoother playback'}
                      {hwProfile.tier === 'balanced' && 'Balanced tracking cadence for most laptops'}
                      {hwProfile.tier === 'max' && 'High-performance tracking cadence'}
                    </span>
                    <span className="ml-auto text-muted-foreground">
                      ~{Math.round(1000 / hwProfile.poseIntervalMs)} Hz pose
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={analyzeCurrentFrame} disabled={analyzing}>{analyzing ? 'Analyzing…' : 'Analyze Frame'}</Button>
                    <Button size="sm" variant="outline" onClick={() => void analyzeFightLangWindow({ windowMs: 15000 })} disabled={fightLangLoading}>{fightLangLoading ? 'FightLang…' : 'FightLang 15s'}</Button>
                    <Button size="sm" variant="outline" onClick={() => void prepareClipForFullAnalysis()} disabled={uploadingVideo || initialAnalysisLoading || !videoFile || Boolean(videoCredits && videoCredits.remaining <= 0 && !geminiFileUri)}>
                      {uploadingVideo ? `Uploading ${uploadProgress}%…` : initialAnalysisLoading ? 'Analyzing…' : initialAnalysisReady ? 'Re-run Full Analysis' : 'Full Clip Analysis'}
                    </Button>
                    <Button size="sm" variant="outline" onClick={analyzeExchangesAndPatterns} disabled={analyzingExchanges}>{analyzingExchanges ? 'Detecting…' : 'Exchanges & Patterns'}</Button>
                  </div>
                  {videoCredits && (
                    <div className="rounded-md border border-border/50 bg-background/30 px-2 py-1.5 text-[10px] text-muted-foreground">
                      AI video credits: <span className="font-semibold text-foreground">{videoCredits.remaining} remaining</span>
                      {' '}({videoCredits.used} used{videoCredits.reserved ? `, ${videoCredits.reserved} processing` : ''} of {videoCredits.limit}; {videoCredits.tier === 'free' ? 'Free 10s clips' : videoCredits.tier === 'pro' ? 'Pro weekly clips' : 'admin'})
                    </div>
                  )}
                  {clipStorageStatus !== 'idle' && (
                    <div className="text-[10px] text-muted-foreground">
                      Clip archive: {clipStorageStatus === 'saving' ? 'saving a review copy…' : clipStorageStatus === 'saved' ? 'saved for review' : 'unavailable — this clip stays in this browser only'}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div className="space-y-2">
                      <div className="font-medium text-foreground">Skeleton</div>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={skeletonVisible.A} onChange={(e) => setSkeletonVisible((p) => ({ ...p, A: e.target.checked }))} /><span className="inline-block h-2 w-2 rounded-full bg-blue-500" />Blue corner</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={skeletonVisible.B} onChange={(e) => setSkeletonVisible((p) => ({ ...p, B: e.target.checked }))} /><span className="inline-block h-2 w-2 rounded-full bg-red-500" />Red corner</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={kinematicsHudOn} onChange={(e) => setKinematicsHudOn(e.target.checked)} />Kinematics HUD</label>
                      <div className="pt-1">
                        <div className="mb-1 text-[11px] text-muted-foreground">My corner (for coaching POV)</div>
                        <div className="flex gap-2">
                          <Button size="sm" variant={myCorner === 'blue' ? 'default' : 'outline'} className="h-7 flex-1 text-[11px]" onClick={() => setMyCorner('blue')}>Blue</Button>
                          <Button size="sm" variant={myCorner === 'red' ? 'default' : 'outline'} className="h-7 flex-1 text-[11px]" onClick={() => setMyCorner('red')}>Red</Button>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <div className="font-medium text-foreground">Tracking & Analysis</div>
                      <div className="rounded-md border border-border/50 bg-background/30 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                        Active: pose tracking, identity lock, kinematics, and key-moment detection. Cloud masks are off by default.
                      </div>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={autoAnalyzeOnPause} onChange={(e) => setAutoAnalyzeOnPause(e.target.checked)} />Auto-analyze on pause</label>
                    </div>
                    {/* Explicit coaching opt-in — gates Gemini spend */}
                    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border/30 pt-2 text-xs">
                      <button
                        type="button"
                        onClick={() => {
                          if (!coachingEnabled) {
                            setCoachingConfirmOpen(true)
                            return
                          }
                          setCoachingEnabled(false)
                        }}
                        className={`rounded px-3 py-1.5 font-medium transition ${
                          coachingEnabled
                            ? 'bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40'
                            : 'bg-muted/30 text-muted-foreground hover:bg-muted/50'
                        }`}
                      >
                        {coachingEnabled ? 'Stop AI Coaching' : 'Start AI Coaching'}
                      </button>
                      <span className="text-muted-foreground">
                        {coachingEnabled
                          ? `Running — ${llmCallCount}/${LLM_CALL_CAP} calls used`
                          : 'Off — no Gemini calls'}
                      </span>
                      <AlertDialog open={coachingConfirmOpen} onOpenChange={setCoachingConfirmOpen}>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Enable AI coaching?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This calls Gemini 3.1 Pro every few seconds while the video plays. Estimated cost: up to ~$1 per session (hard-capped at {LLM_CALL_CAP} calls).
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction onClick={() => setCoachingEnabled(true)}>
                              Start AI Coaching
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>

                  {/* Reflex + Track config */}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={reflexOn} onChange={(e) => setReflexOn(e.target.checked)} />Reflex</label>
                    <select value={reflexCadenceMs} onChange={(e) => setReflexCadenceMs(Number(e.target.value))} className="h-7 rounded border border-border/60 bg-background/30 px-2 text-xs" disabled={!reflexOn}>
                      <option value={1000}>1.0s</option><option value={1500}>1.5s</option><option value={2500}>2.5s</option>
                    </select>
                    <div className="h-4 w-px bg-border/40" />
                    <label className="flex items-center gap-1.5"><input type="checkbox" checked={trackOn} onChange={(e) => { setTrackOn(e.target.checked); if (!e.target.checked) { setTrackBox(null); setTrackAtMs(null) } }} />Track</label>
                    <select value={trackCadenceMs} onChange={(e) => setTrackCadenceMs(Number(e.target.value))} className="h-7 rounded border border-border/60 bg-background/30 px-2 text-xs" disabled={!trackOn}>
                      <option value={800}>0.8s</option><option value={1200}>1.2s</option><option value={2000}>2.0s</option>
                    </select>
                  </div>

                  {/* Local session controls */}
                  <div className="flex flex-wrap gap-2 border-t border-border/30 pt-3">
                    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={localRecordOn} onChange={(e) => setLocalRecordOn(e.target.checked)} />Record session</label>
                    <Button size="sm" variant="ghost" onClick={saveLocalSession} disabled={!videoUrl} className="h-7 text-xs">Save</Button>
                    <Button size="sm" variant="ghost" onClick={onExportLocal} className="h-7 text-xs">Export</Button>
                    <Button size="sm" variant="ghost" onClick={() => localImportInputRef.current?.click()} className="h-7 text-xs">Import</Button>
                    <input ref={localImportInputRef} type="file" accept="application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportLocal(f); e.target.value = '' }} />
                  </div>
                  {localStatus && <div className="text-xs text-muted-foreground">{localStatus}</div>}
                </div>
              </details>

              {/* Exchange Timeline */}
              {exchangeTimeline && (
                <div className="rounded-xl border border-border/40 bg-card/30 p-3">
                  <div className="text-sm font-medium mb-2">Exchange Timeline</div>
                  <div className="flex flex-wrap gap-1">
                    {exchangeTimeline.exchanges.map((ex, i) => (
                      <button key={ex.exchangeId} className="px-2 py-1 text-xs rounded bg-primary/20 hover:bg-primary/30 transition-colors" onClick={() => { if (videoRef.current) videoRef.current.currentTime = ex.startMs / 1000 }}>
                        {i + 1}: {(ex.startMs / 1000).toFixed(1)}s
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* YouTube Breakdown */}
              {breakdownResult && (
                <div className="rounded-xl border border-border/40 bg-card/30 p-4 space-y-3">
                  <div className="text-sm font-bold text-primary">{breakdownResult.videoTitle}</div>
                  {breakdownResult.segments?.map((seg) => (
                    <div key={seg.id} className="rounded-lg border border-border/30 bg-background/30 p-3 text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold">{seg.title}</span>
                        <button className="px-2 py-0.5 text-[10px] rounded bg-primary/20 hover:bg-primary/30 text-primary" onClick={() => { if (videoRef.current) videoRef.current.currentTime = seg.startMs / 1000 }}>
                          {(seg.startMs / 1000).toFixed(1)}s
                        </button>
                      </div>
                      <div className="text-muted-foreground">{seg.narration}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* AI Chat + Coaching (stacks below the video inside the phone frame) */}
            <div className="min-w-0 space-y-4">
              {/* Upload info */}
              {videoFile && (
                <div className="rounded-xl border border-border/40 bg-card/30 px-4 py-3">
                  <div className="text-sm font-medium truncate">{videoFile.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                  {uploadingVideo ? ingestionStatusText : initialAnalysisStatus || (initialAnalysisReady ? 'Analysis complete' : initialAnalysisLoading ? 'AI analyzing clip…' : 'Waiting to analyze')}
                  </div>
                  {(uploadingVideo || initialAnalysisLoading) && (
                    <div className="mt-2 h-1 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn('h-full rounded-full bg-primary', ingestionStage !== 'uploading_original' && 'animate-pulse')}
                        style={{ width: uploadingVideo && ingestionStage === 'uploading_original' ? `${uploadProgress}%` : '60%' }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* AI Chat Panel */}
              <div className="rounded-2xl border border-border/50 bg-card/40 shadow-lg backdrop-blur-xl overflow-hidden">
                <div className="border-b border-border/30 bg-card/60 px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-primary/80 to-primary text-[10px] font-black text-primary-foreground">AI</div>
                    <div className="flex-1">
                      <div className="text-sm font-bold">Musashi Coach</div>
                      <div className="text-[11px] text-muted-foreground">
                        {!videoUrl
                          ? 'Ask a question or upload a clip'
                          : uploadingVideo
                            ? ingestionStatusText
                            : streamAnalysisPhase === 'analyzing'
                              ? 'Analyzing your clip…'
                              : initialAnalysisLoading
                                ? 'Deep analysis running…'
                                : initialAnalysisReady
                                  ? 'Ready — ask follow-up questions'
                                  : streamAnalysisPhase === 'error'
                                    ? 'Analysis needs a retry'
                                    : 'Tape selected — analysis pending'}
                      </div>
                    </div>
                    <button
                      onClick={() => setSpeakReplies((v) => !v)}
                      className={`rounded-md px-2 py-0.5 text-[10px] border transition-colors ${speakReplies ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border/40 text-muted-foreground hover:text-foreground'}`}
                      title={speakReplies ? 'Voice replies ON' : 'Voice replies OFF'}
                    >
                      {speakReplies ? 'Voice ON' : 'Voice'}
                    </button>
                    {(initialAnalysisLoading || uploadingVideo || streamAnalysisPhase === 'analyzing') && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                    {(videoUrl ? initialAnalysisReady : messages.length > 0) && !initialAnalysisLoading && !uploadingVideo && streamAnalysisPhase !== 'analyzing' && <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400">Ready</span>}
                  </div>
                </div>

                {/* Messages */}
                <div className="h-[400px] overflow-y-auto p-4 space-y-3">
                  {/* Empty state — no video yet */}
                  {messages.length === 0 && !initialAnalysisLoading && !uploadingVideo && streamAnalysisPhase === 'idle' && (
                    <div className="flex h-full flex-col items-center justify-center text-center text-muted-foreground">
                      <div className="text-sm font-medium">Tactical coaching will appear here</div>
                      <div className="mt-1 text-xs max-w-[280px]">{videoUrl ? 'Play the clip, then ask a question or run Full Clip Analysis.' : 'Upload a fight clip to get started.'}</div>
                    </div>
                  )}

                  {/* Upload / analysis in progress */}
                  {(initialAnalysisLoading || uploadingVideo || streamAnalysisPhase === 'analyzing') && messages.length === 0 && (
                    <div className="flex justify-start">
                      <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2.5 text-sm max-w-[95%] space-y-2">
                        <div className="flex items-center gap-2 text-xs font-medium text-primary">
                          <span className="animate-bounce" style={{ animationDelay: '0ms' }}>●</span>
                          <span className="animate-bounce" style={{ animationDelay: '150ms' }}>●</span>
                          <span className="animate-bounce" style={{ animationDelay: '300ms' }}>●</span>
                          {uploadingVideo ? ingestionStatusText : 'Analyzing clip…'}
                        </div>
                        {/* Show streaming text live as it arrives. If the model is
                            emitting the internal JSON contract, hide the partial
                            payload — users never see braces or field names. */}
                        {streamAnalysisText && (
                          <div className="text-foreground/90 whitespace-pre-wrap text-xs leading-relaxed max-h-[280px] overflow-y-auto">
                            {looksLikeCoachingJson(streamAnalysisText) && streamAnalysisPhase === 'analyzing'
                              ? 'Writing your coaching feedback…'
                              : streamAnalysisText}
                            {streamAnalysisPhase === 'analyzing' && <span className="inline-block w-1.5 h-3.5 bg-primary/60 animate-pulse ml-0.5 align-middle" />}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Chat messages */}
                  {messages.map((m, idx) => (
                    <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={cn(
                          'max-w-[90%] rounded-xl px-3 py-2 text-sm',
                          m.role === 'user'
                            ? 'whitespace-pre-wrap bg-primary text-primary-foreground'
                            : 'bg-muted/60 border border-border/50 text-foreground',
                        )}
                      >
                        {m.role === 'assistant' ? <ChatMarkdown text={m.content ?? ''} /> : (m.content ?? '')}
                      </div>
                    </div>
                  ))}

                  {/* Chat loading indicator */}
                  {chatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-muted rounded-lg px-3 py-2">
                        <div className="flex items-center gap-1">
                          <span className="animate-bounce">●</span>
                          <span className="animate-bounce" style={{ animationDelay: '100ms' }}>●</span>
                          <span className="animate-bounce" style={{ animationDelay: '200ms' }}>●</span>
                          <span className="ml-1 text-xs text-muted-foreground">Coaching…</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Quick follow-up prompts — show after any assistant message */}
                  {messages.length > 0 && messages[messages.length - 1]?.role === 'assistant' && !chatLoading && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {['What should I drill?', 'Who won the exchange?', 'Focus on footwork', 'Explain the counters'].map((q) => (
                        <Button key={q} size="sm" variant="outline" onClick={() => setChatInput(q)} className="text-xs h-6 px-2 opacity-70 hover:opacity-100">{q}</Button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Chat input */}
                <div className="border-t border-border/30 bg-card/60 p-3 space-y-2">
                  {/* Coaching presets — fill the input with a full prompt */}
                  <div className="flex flex-wrap gap-1">
                    {([
                      ['gameplan', 'Gameplan'],
                      ['counters', 'Counters'],
                      ['corner', 'Corner advice'],
                    ] as Array<['gameplan' | 'counters' | 'corner', string]>).map(([kind, label]) => (
                      <Button
                        key={kind}
                        size="sm"
                        variant="outline"
                        disabled={chatLoading || uploadingVideo || !videoUrl}
                        onClick={() => applyCoachingPreset(kind)}
                        className="text-xs h-6 px-2 opacity-70 hover:opacity-100"
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                      className="flex-1 rounded-lg border border-border/60 bg-background/30 px-3 py-2 text-sm outline-none focus:border-primary/50"
                      placeholder={uploadingVideo ? ingestionStatusText : voiceListening ? 'Listening…' : !videoUrl ? 'Ask anything — no clip needed…' : 'Ask about the fight…'}
                      disabled={chatLoading || uploadingVideo}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (voiceListening) stopVoice(); void sendChat() } }}
                    />
                    <Button
                      size="icon"
                      variant={voiceListening ? 'default' : 'outline'}
                      onClick={() => (voiceListening ? stopVoice() : startVoice())}
                      disabled={!voiceSupported || chatLoading || uploadingVideo}
                      title={
                        !voiceSupported
                          ? 'Voice input not supported in this browser'
                          : voiceListening
                            ? 'Stop listening'
                            : 'Dictate your question'
                      }
                      aria-label={voiceListening ? 'Stop voice input' : 'Start voice input'}
                      className={cn('shrink-0 h-9 w-9', voiceListening && 'animate-pulse bg-red-600 hover:bg-red-600/90 text-white')}
                    >
                      <Mic className="h-4 w-4" />
                    </Button>
                    <Button size="icon" onClick={() => { if (voiceListening) stopVoice(); void sendChat() }} disabled={!chatInput.trim() || chatLoading || uploadingVideo} className="shrink-0 h-9 w-9">
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                  {voiceListening && (
                    <div className="flex items-center gap-1.5 text-[11px] text-red-400">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                      Listening{voiceInterim ? ` — “${voiceInterim.trim()}”` : '… speak now'}
                    </div>
                  )}
                </div>
              </div>

              {/* Kinematics HUD */}
              {kinematicsHudOn && kinematicsUi && (
                <div className="rounded-xl border border-border/40 bg-card/30 p-3">
                  <div className="text-xs font-medium mb-2">Kinematics</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <div className="font-medium text-blue-400">Blue corner</div>
                      <div className="text-muted-foreground">Hand {((kinematicsUi.fighters.A?.handSpeedBwps || 0)).toFixed(2)} bw/s</div>
                      <div className="text-muted-foreground">Foot {((kinematicsUi.fighters.A?.footSpeedBwps || 0)).toFixed(2)} bw/s</div>
                    </div>
                    <div>
                      <div className="font-medium text-red-400">Red corner</div>
                      <div className="text-muted-foreground">Hand {((kinematicsUi.fighters.B?.handSpeedBwps || 0)).toFixed(2)} bw/s</div>
                      <div className="text-muted-foreground">Foot {((kinematicsUi.fighters.B?.footSpeedBwps || 0)).toFixed(2)} bw/s</div>
                    </div>
                  </div>
                  {kinematicsUi.range && (
                    <div className="mt-1 text-[11px] text-muted-foreground">Range {kinematicsUi.range.distanceBw.toFixed(2)} bw ({kinematicsUi.range.band})</div>
                  )}
                </div>
              )}

              {/* Breakdown Controls */}
              <div className="rounded-xl border border-border/40 bg-card/30 p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium">Breakdown</span>
                  <div className="flex items-center gap-2">
                    <select value={breakdownStyle} onChange={(e) => setBreakdownStyle(e.target.value as any)} className="h-7 rounded border border-border/60 bg-background/30 px-2 text-xs">
                      <option value="commentary">Commentary</option><option value="coaching">Coaching</option><option value="scouting">Scouting</option>
                    </select>
                    <Button size="sm" onClick={runBreakdown} disabled={breakdownLoading || fightLangPoseFramesRef.current.length < 4} className="h-7 text-xs">
                      {breakdownLoading ? 'Generating…' : 'Generate'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Detected Patterns */}
              {patternAnalysis && patternAnalysis.topPatterns.length > 0 && (
                <div className="rounded-xl border border-border/40 bg-card/30 p-3 space-y-2">
                  <div className="text-xs font-medium">Detected Patterns</div>
                  {patternAnalysis.topPatterns.slice(0, 4).map((pattern, i) => (
                    <div key={pattern.patternId} className="text-[11px]">
                      <span className="font-medium">{i + 1}. {pattern.title}</span>
                      <span className="ml-1 text-primary">{(pattern.confidence * 100).toFixed(0)}%</span>
                      <div className="text-muted-foreground mt-0.5">{pattern.summary}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Retrieval info panel (Gemini Embed + D1 knowledge base) */}
              {autoRetrieval !== null && (streamAnalysisPhase === 'analyzing' || streamAnalysisPhase === 'complete') && (
                <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 px-4 py-3 space-y-1.5">
                  <div className="text-[11px] leading-snug text-cyan-100/95">
                    {(() => {
                      const n = autoRetrieval.snippets.length
                      const vid = autoRetrieval.snippets.filter((s) => s.namespace === 'video_segment').length
                      const txt = n - vid
                      if (n > 0) {
                        return (
                          <>
                            <span className="font-semibold text-cyan-200">Google Embed + retrieval:</span>{' '}
                            {n} snippet{n !== 1 ? 's' : ''} matched for this analysis
                            {txt > 0 || vid > 0 ? (
                              <span className="text-cyan-200/80">
                                {' '}({txt > 0 ? `${txt} text` : ''}{txt > 0 && vid > 0 ? ' · ' : ''}{vid > 0 ? `${vid} video memory` : ''})
                              </span>
                            ) : null}
                            {autoRetrieval.queryEmbeddingModel ? (
                              <span className="block mt-0.5 text-[10px] text-cyan-300/70">
                                model {autoRetrieval.queryEmbeddingModel}
                              </span>
                            ) : null}
                          </>
                        )
                      }
                      return (
                        <>
                          <span className="font-semibold text-cyan-200">Knowledge base:</span>{' '}
                          Building fight knowledge library — tactical grounding improves with each analysis.
                        </>
                      )
                    })()}
                  </div>
                  {autoRetrieval.snippets.length > 0 && (
                    <ul className="text-[10px] text-cyan-100/80 space-y-1 max-h-[72px] overflow-y-auto border-t border-cyan-500/20 pt-1.5">
                      {autoRetrieval.snippets.slice(0, 5).map((s) => (
                        <li key={s.docId} className="line-clamp-2">
                          <span className="text-cyan-300/90">[{s.namespace}]</span>{' '}
                          {s.namespace === 'video_segment' && (s.segmentStartMs != null || s.segmentEndMs != null) ? (
                            <span className="text-cyan-200/70">
                              {((s.segmentStartMs ?? 0) / 1000).toFixed(1)}–{((s.segmentEndMs ?? 0) / 1000).toFixed(1)}s ·{' '}
                            </span>
                          ) : null}
                          score {s.score.toFixed(2)} — {s.title ? `${s.title}: ` : ''}{s.text}
                        </li>
                      ))}
                      {autoRetrieval.snippets.length > 5 ? (
                        <li className="text-cyan-300/60 italic">+{autoRetrieval.snippets.length - 5} more…</li>
                      ) : null}
                    </ul>
                  )}
                </div>
              )}

              {/* Embed snippet count (from FightLang pipeline) */}
              {embedSnippetCount != null && (
                <div className="rounded-xl border border-border/40 bg-card/30 p-3 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Knowledge retrieval:</span> {embedSnippetCount > 0 ? `${embedSnippetCount} docs grounding AI` : 'Building knowledge library'}
                </div>
              )}

              {/* Local Sessions */}
              {localSessions.length > 0 && (
                <details className="rounded-xl border border-border/40 bg-card/20">
                  <summary className="cursor-pointer px-4 py-2 text-xs font-medium text-muted-foreground">Local Sessions ({localSessions.length})</summary>
                  <div className="px-4 pb-3 space-y-2">
                    {localSessions.slice(0, 5).map((s) => (
                      <div key={s.id} className="flex items-center justify-between text-xs">
                        <span className="truncate">{s.videoFileName || 'Untitled'}</span>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => void loadLocalSession(s.id)}>Load</Button>
                          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => void removeLocalSession(s.id)}>Del</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
      </div>
      )}
    </div>
  )
}
