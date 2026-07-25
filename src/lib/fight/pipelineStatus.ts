/**
 * ONE pipeline status vocabulary for the vision-first flow.
 *
 * User-visible stages (in order):
 *   1. uploading          "Uploading…"
 *   2. preparing_video    "Preparing video…"      (normalize + store + register)
 *   3. watching           "Watching the fight…"   (Gemini evidence pass)
 *   4. building_coaching  "Building coaching…"    (coaching pass + validation)
 *   5. ready              "Ready"
 *
 * Failures are classified separately from stages so the UI can never blame
 * the wrong subsystem (a network drop is a network failure — NEVER
 * "not enough pose frames").
 */

export type PipelineStage =
  | 'uploading'
  | 'preparing_video'
  | 'watching'
  | 'building_coaching'
  | 'ready'

export const PIPELINE_STAGE_ORDER: readonly PipelineStage[] = [
  'uploading',
  'preparing_video',
  'watching',
  'building_coaching',
  'ready',
]

const STAGE_LABELS: Record<PipelineStage, string> = {
  uploading: 'Uploading…',
  preparing_video: 'Preparing video…',
  watching: 'Watching the fight…',
  building_coaching: 'Building coaching…',
  ready: 'Ready',
}

export function stageLabel(stage: PipelineStage): string {
  return STAGE_LABELS[stage]
}

export type FailureKind =
  | 'upload'
  | 'normalization'
  | 'gemini_video_processing'
  | 'gemini_evidence'
  | 'fighter_identification'
  | 'pose_optional'
  | 'coaching'
  | 'network'
  | 'persistence'
  | 'unknown'

const FAILURE_MESSAGES: Record<FailureKind, string> = {
  upload: 'Upload failed. Check your connection and try the video again.',
  normalization: 'Video preparation failed on the server. Your original upload is safe — retry the analysis.',
  gemini_video_processing: 'The AI could not process this video file. Try re-uploading or a different clip.',
  gemini_evidence: 'The AI could not extract evidence from this clip. Retry the analysis.',
  fighter_identification: 'The fighters could not be identified confidently. Tap your fighter on the video to confirm.',
  pose_optional: 'Skeleton tracking is unavailable for this clip. Coaching still works — pose is optional.',
  coaching: 'Coaching generation failed. Retry Analyze.',
  network: 'Network error — check your connection and retry.',
  persistence: 'Your analysis worked but could not be saved to history.',
  unknown: 'Something went wrong. Retry the analysis.',
}

export function failureMessage(kind: FailureKind): string {
  return FAILURE_MESSAGES[kind]
}

/**
 * Classify an error into a failure kind, given the stage that was running.
 * Network problems are detected FIRST — a dropped fetch during any stage must
 * read as a network failure, never as that stage's content failing (the old
 * pipeline reported "Failed to fetch" as insufficient pose frames).
 */
export function classifyFailure(err: unknown, stage: PipelineStage): FailureKind {
  const message = (err instanceof Error ? err.message : String(err ?? '')).toLowerCase()
  if (
    (typeof TypeError !== 'undefined' && err instanceof TypeError) ||
    /failed to fetch|networkerror|network error|load failed|fetch failed|econn|etimedout|abort/i.test(message)
  ) {
    return 'network'
  }
  if (/quota|credit|rate.?limit/.test(message)) return 'coaching'
  switch (stage) {
    case 'uploading':
      return 'upload'
    case 'preparing_video':
      return /gemini|files api/.test(message) ? 'gemini_video_processing' : 'normalization'
    case 'watching':
      return 'gemini_evidence'
    case 'building_coaching':
      return 'coaching'
    default:
      return 'unknown'
  }
}

/**
 * Single derived answer to "what is the pipeline doing right now?".
 *
 * The Fight Lab screen historically carried FOUR competing status vocabularies
 * (a free-form boot message, the 11-value ingestion stage, a step enum derived
 * by regex-matching the boot message, and a streaming phase). They could each
 * be true at once, which is how the header showed "Uploading…" and "PREPARING"
 * side by side. Every status surface now derives from this one function.
 *
 * Precedence is deliberate: a terminal outcome (failed / ready) always wins, so
 * a spinner can never coexist with "Ready".
 */
export function derivePipelineStage(input: {
  failed?: boolean
  ready?: boolean
  uploading?: boolean
  ingestionStage?: string | null
  /** Coaching already returned — distinguishes "watching" from "building". */
  hasCoaching?: boolean
}): PipelineStage | 'failed' {
  if (input.failed) return 'failed'
  if (input.ready) return 'ready'

  const stage = input.ingestionStage ?? ''

  // Explicit upload signals beat everything below.
  if (input.uploading || stage === 'selected' || stage === 'uploading_original') return 'uploading'

  switch (stage) {
    case 'original_uploaded':
    case 'normalizing':
    case 'normalized':
    case 'uploading_to_gemini':
    case 'gemini_processing':
      return 'preparing_video'
    case 'gemini_ready':
      return 'building_coaching'
    case 'analyzing':
      // The evidence pass runs before any coaching exists.
      return input.hasCoaching ? 'building_coaching' : 'watching'
    case 'complete':
      return 'ready'
    case 'failed':
      return 'failed'
    default:
      return 'preparing_video'
  }
}

/** Label for a stage or the terminal failure state. */
export function pipelineStatusLabel(stage: PipelineStage | 'failed'): string {
  return stage === 'failed' ? 'Analysis failed' : stageLabel(stage)
}

/** Map legacy ingestion failure codes to the new failure kinds. */
export function failureKindFromIngestionCode(code: string): FailureKind {
  if (code.startsWith('ORIGINAL_UPLOAD')) return 'upload'
  if (code.startsWith('ORIGINAL_ASSET')) return 'upload'
  if (code.startsWith('SERVER_PROCESSING') || code.startsWith('NORMALIZED_STORAGE')) return 'normalization'
  if (code.startsWith('GEMINI_')) return 'gemini_video_processing'
  return 'unknown'
}
