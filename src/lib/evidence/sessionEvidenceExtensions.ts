/**
 * Phase 3 append-only extensions for SessionEvidence.
 * Do not modify core SessionEvidence fields in sessionEvidence.ts.
 */

export type ExchangeWindow = {
  startMs: number
  endMs: number
  trigger?: 'proximity' | 'velocity' | 'combined'
  peakMotionScore?: number
}

export type MotionBurstEvidence = {
  burstId: string
  centerMs: number
  focusTarget: 'A' | 'B' | 'both'
  captureReason: 'peak-motion' | 'manual' | 'auto-detected'
  frames: Array<{
    seq: number
    dtMs: number
    jpegBase64?: string
    landmarks: number[][]
    landmarksB?: number[][]
  }>
  peakScore: number
  eventKind?: string
}

export type TemporalEvidence = {
  exchangeWindows: ExchangeWindow[]
  motionBurst: MotionBurstEvidence | null
  suppressionStats?: {
    strikesSkipped: number
    faultsSkipped: number
  }
}

export type { SessionEvidence } from './sessionEvidence'

export type SessionEvidenceEnvelope = import('./sessionEvidence').SessionEvidence & {
  temporal?: TemporalEvidence
}
