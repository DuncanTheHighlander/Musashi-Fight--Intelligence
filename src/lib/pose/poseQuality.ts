/**
 * Pose-quality assessment + engine provenance for the dense track.
 *
 * Pure module (no browser/server deps) shared by:
 *   - FightAnalyzer (client): grade the cloud RTMPose track before trusting it,
 *     fall back to the local MediaPipe dense pass when it is unusable.
 *   - /api/fight/analyze (server): thread engine + quality into the coaching
 *     prompt so weak pose data produces caution, not fake certainty.
 *
 * Engine priority (see docs/POSE_ENGINE_PRIORITY.md): cloud RTMPose is the
 * PRIMARY engine for uploaded clips — validated 2026-07-01 on the 3-clip
 * envelope (clip3: exploded 18→0, teleports 74→6 vs the MediaPipe pass).
 * MediaPipe remains the live preview and the automatic fallback.
 */

export type PoseEngine =
  | 'rtmpose-cloud'
  | 'mediapipe-cloud'
  | 'rtmpose-local'
  | 'mediapipe-local'

export type PoseEngineInfo = {
  engine: PoseEngine
  /** True when a higher-priority engine was attempted and failed for this clip. */
  fallback?: boolean
  quality?: PoseQualitySummary
}

export type PoseQualitySummary = {
  overall: 'high' | 'medium' | 'low'
  /** Samples with at least one fighter / expected samples (0..1). */
  coverage: number
  /** Samples with BOTH fighters / samples with at least one (0..1). */
  bothFighters: number
  /** Mean visibility of ankles/heels/toes across present fighters (0..1). */
  footConfidence: number
  /** Mean visibility of wrists across present fighters (0..1). */
  wristConfidence: number
  recommendation: 'safe_to_analyze' | 'analyze_with_caution' | 'request_better_clip'
}

type QualityLandmark = { x: number; y: number; visibility?: number }
type QualitySample = {
  tMs: number
  A: QualityLandmark[] | null
  B: QualityLandmark[] | null
}

const FOOT_JOINTS = [27, 28, 29, 30, 31, 32]
const WRIST_JOINTS = [15, 16]

function meanVisibility(pose: QualityLandmark[], joints: number[]): number | null {
  let sum = 0
  let n = 0
  for (const idx of joints) {
    const lm = pose[idx]
    if (!lm) continue
    sum += lm.visibility ?? 0
    n++
  }
  return n > 0 ? sum / n : null
}

/**
 * Grade a dense track. `expectedSamples` is the sample count a complete pass
 * would produce (durMs / stepMs); coverage is measured against it so a track
 * that silently dropped half the clip grades down even if every kept sample
 * is clean.
 */
export function assessDenseTrackQuality(
  track: QualitySample[],
  expectedSamples: number
): PoseQualitySummary {
  let anyFighter = 0
  let bothFighters = 0
  const foot: number[] = []
  const wrist: number[] = []

  for (const sample of track) {
    const poses = [sample.A, sample.B].filter(Boolean) as QualityLandmark[][]
    if (poses.length === 0) continue
    anyFighter++
    if (poses.length >= 2) bothFighters++
    for (const pose of poses) {
      const f = meanVisibility(pose, FOOT_JOINTS)
      if (f !== null) foot.push(f)
      const w = meanVisibility(pose, WRIST_JOINTS)
      if (w !== null) wrist.push(w)
    }
  }

  const coverage = expectedSamples > 0 ? Math.min(1, anyFighter / expectedSamples) : 0
  const both = anyFighter > 0 ? bothFighters / anyFighter : 0
  const footConfidence = foot.length > 0 ? foot.reduce((a, b) => a + b, 0) / foot.length : 0
  const wristConfidence = wrist.length > 0 ? wrist.reduce((a, b) => a + b, 0) / wrist.length : 0

  let overall: PoseQualitySummary['overall']
  let recommendation: PoseQualitySummary['recommendation']
  if (coverage >= 0.8 && both >= 0.7 && footConfidence >= 0.5) {
    overall = 'high'
    recommendation = 'safe_to_analyze'
  } else if (coverage >= 0.5) {
    overall = 'medium'
    recommendation = 'analyze_with_caution'
  } else {
    overall = 'low'
    recommendation = 'request_better_clip'
  }

  return {
    overall,
    coverage: +coverage.toFixed(3),
    bothFighters: +both.toFixed(3),
    footConfidence: +footConfidence.toFixed(3),
    wristConfidence: +wristConfidence.toFixed(3),
    recommendation,
  }
}

/**
 * Minimum bar for ACCEPTING a cloud track as the primary pose source.
 * Below this the caller must fall back to the local MediaPipe dense pass —
 * a wrong-but-confident track is worse than the proven local floor.
 */
export function cloudTrackUsable(quality: PoseQualitySummary): boolean {
  return quality.recommendation !== 'request_better_clip'
}
