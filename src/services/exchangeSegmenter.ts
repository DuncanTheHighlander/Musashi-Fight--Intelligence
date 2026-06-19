/**
 * Exchange Segmentation Engine
 * 
 * Detects engagement windows in fight videos based on range and activity states.
 * Implements the segmentation logic from Sparring_MVP_Spec.md
 */

import type { KinematicsSnapshot, PoseHistory } from '@/lib/kinematics'
import { logger } from '@/lib/logger'

// Configuration thresholds (tunable)
export const EXCHANGE_CONFIG = {
  // Range thresholds (in body-widths)
  R_FAR: 4.0,      // Beyond this = FAR state
  R_NEAR: 2.5,     // Within this = NEAR state

  // Activity thresholds
  V_CLOSE: 1.5,    // Closing speed in body-widths per second
  N_ATTEMPTS: 2,   // Punch attempts in last T ms
  T_WINDOW: 1000,  // Time window for counting attempts (ms)
  PUNCH_BURST_BWPS: 5.0, // Hand burst above this = punch attempt

  // Segmentation timing
  T_ENTER: 300,    // Duration to confirm exchange start (ms)
  T_EXIT: 500,     // Duration to confirm exchange end (ms)
  T_MERGE: 200,    // Max gap to merge exchanges (ms)
  T_MIN: 400,      // Minimum exchange duration (ms)

  // Guard-drop heuristic: when fighter is in NEAR range, sustained absence of
  // hand motion signals dropped guard. This is what the LLM-side coach uses
  // to identify guard_drop_before_entry counter windows.
  GUARD_DROP_HAND_BWPS: 0.5, // Below this = hand essentially static
} as const

export type RangeState = 'FAR' | 'NEAR'
export type ActivityState = 'ACTIVE' | 'INACTIVE'
export type ExchangePhase = 'approach' | 'engaged' | 'break' | 'unknown'

export interface ExchangeSignals {
  rangeBwAvg: number
  rangeBwMin: number
  closingBwpsPeak: number
  poseQuality: {
    A: number
    B: number
  }
  punchAttempts?: {
    A: number
    B: number
  }
  guardDropMs?: {
    A: number
    B: number
  }
}

export interface Exchange {
  exchangeId: string
  startMs: number
  endMs: number
  durationMs: number
  phase: ExchangePhase
  participants: ['A', 'B']
  signals: ExchangeSignals
}

export interface ExchangeTimeline {
  videoId: string
  fps: number
  totalDurationMs: number
  exchanges: Exchange[]
  metadata: {
    totalExchanges: number
    avgExchangeDuration: number
    avgGapDuration: number
  }
}

interface FrameState {
  timestampMs: number
  rangeState: RangeState
  activityState: ActivityState
  rangeBw: number
  closingBwps: number
  punchAttempts: { A: number; B: number }
  poseQuality: { A: number; B: number }
}

/**
 * Generate unique exchange ID
 */
function generateExchangeId(index: number): string {
  return `exch_${index.toString().padStart(3, '0')}`
}

/**
 * Determine range state based on distance
 */
function getRangeState(rangeBw: number): RangeState {
  return rangeBw > EXCHANGE_CONFIG.R_FAR ? 'FAR' : 'NEAR'
}

/**
 * Determine activity state based on motion metrics
 */
function getActivityState(
  closingBwps: number,
  recentPunchAttempts: number,
  handSpeedA: number,
  handSpeedB: number
): ActivityState {
  const isClosing = Math.abs(closingBwps) > EXCHANGE_CONFIG.V_CLOSE
  const hasPunches = recentPunchAttempts >= EXCHANGE_CONFIG.N_ATTEMPTS
  const bothHandsActive = handSpeedA > 3.0 && handSpeedB > 3.0
  
  return (isClosing || hasPunches || bothHandsActive) ? 'ACTIVE' : 'INACTIVE'
}

/**
 * Pre-compute prefix sums of per-frame punch indicators so the segmentation
 * loop can answer "how many punch attempts in the last T ms" in O(1) per
 * frame instead of O(window). On a 5-min × 30 fps session this drops the
 * outer loop from ~9000 × ~30 = 270k iterations to ~9000 — fast enough that
 * the analysis no longer freezes the UI.
 */
type PunchPrefix = {
  prefixA: Int32Array
  prefixB: Int32Array
}

function buildPunchPrefixSums(kinematicsHistory: KinematicsSnapshot[]): PunchPrefix {
  const n = kinematicsHistory.length
  const prefixA = new Int32Array(n + 1)
  const prefixB = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) {
    const snap = kinematicsHistory[i]
    const a = snap.fighters.A
    const b = snap.fighters.B
    prefixA[i + 1] = prefixA[i] + (a && a.handBurstBwps > EXCHANGE_CONFIG.PUNCH_BURST_BWPS ? 1 : 0)
    prefixB[i + 1] = prefixB[i] + (b && b.handBurstBwps > EXCHANGE_CONFIG.PUNCH_BURST_BWPS ? 1 : 0)
  }
  return { prefixA, prefixB }
}

/**
 * Find the earliest index whose timestamp is still inside the window
 * `[currentMs - windowMs, currentMs]`. Uses the previous lo as a starting
 * point so amortised cost across the segmentation loop is O(n).
 */
function advanceWindowStart(
  kinematicsHistory: KinematicsSnapshot[],
  prevLo: number,
  cutoffMs: number
): number {
  let lo = prevLo
  while (lo < kinematicsHistory.length && kinematicsHistory[lo].capturedAtMs < cutoffMs) {
    lo++
  }
  return lo
}

function countRecentPunchAttempts(
  prefix: PunchPrefix,
  windowStartIdx: number,
  currentIndex: number
): { A: number; B: number } {
  return {
    A: prefix.prefixA[currentIndex + 1] - prefix.prefixA[windowStartIdx],
    B: prefix.prefixB[currentIndex + 1] - prefix.prefixB[windowStartIdx],
  }
}

/**
 * Calculate pose quality score (fraction of frames with good visibility)
 */
function calculatePoseQuality(
  kinematicsHistory: KinematicsSnapshot[],
  startIdx: number,
  endIdx: number
): { A: number; B: number } {
  const totalFrames = endIdx - startIdx + 1
  let goodFramesA = 0
  let goodFramesB = 0
  
  for (let i = startIdx; i <= endIdx; i++) {
    const snap = kinematicsHistory[i]
    if (snap.fighters.A) goodFramesA++
    if (snap.fighters.B) goodFramesB++
  }
  
  return {
    A: totalFrames > 0 ? goodFramesA / totalFrames : 0,
    B: totalFrames > 0 ? goodFramesB / totalFrames : 0
  }
}

/**
 * Calculate exchange signals from kinematics history.
 *
 * `guardDropMs` is computed as the longest sustained run (≥200ms) inside the
 * exchange where the fighter's hand activity stays below GUARD_DROP_HAND_BWPS.
 * Inside NEAR range, sustained hand stillness is a strong proxy for guard
 * dropping — the fighter isn't pumping or covering, which is the exact
 * counter-window the LLM coach surfaces as "guard_drop_before_entry".
 */
function calculateExchangeSignals(
  kinematicsHistory: KinematicsSnapshot[],
  startIdx: number,
  endIdx: number
): ExchangeSignals {
  let rangeBwSum = 0
  let rangeBwMin = Infinity
  let closingBwpsPeak = 0
  let punchAttemptsA = 0
  let punchAttemptsB = 0
  let count = 0

  // Guard-drop run accumulators (sustained low-hand-speed windows).
  const MIN_RUN_MS = 200
  let runStartA: number | null = null
  let runStartB: number | null = null
  let bestRunA = 0
  let bestRunB = 0

  for (let i = startIdx; i <= endIdx; i++) {
    const snap = kinematicsHistory[i]
    if (snap.range) {
      rangeBwSum += snap.range.distanceBw
      rangeBwMin = Math.min(rangeBwMin, snap.range.distanceBw)
      closingBwpsPeak = Math.max(closingBwpsPeak, Math.abs(snap.range.closingBwps))
      count++
    }

    const fighterA = snap.fighters.A
    const fighterB = snap.fighters.B

    if (fighterA?.handBurstBwps && fighterA.handBurstBwps > EXCHANGE_CONFIG.PUNCH_BURST_BWPS) {
      punchAttemptsA++
    }
    if (fighterB?.handBurstBwps && fighterB.handBurstBwps > EXCHANGE_CONFIG.PUNCH_BURST_BWPS) {
      punchAttemptsB++
    }

    // Guard-drop tracking: handSpeed (sustained) below threshold = static hands.
    const handIdleA = fighterA ? fighterA.handSpeedBwps < EXCHANGE_CONFIG.GUARD_DROP_HAND_BWPS : false
    const handIdleB = fighterB ? fighterB.handSpeedBwps < EXCHANGE_CONFIG.GUARD_DROP_HAND_BWPS : false

    if (handIdleA) {
      if (runStartA == null) runStartA = snap.capturedAtMs
    } else if (runStartA != null) {
      const run = snap.capturedAtMs - runStartA
      if (run >= MIN_RUN_MS && run > bestRunA) bestRunA = run
      runStartA = null
    }

    if (handIdleB) {
      if (runStartB == null) runStartB = snap.capturedAtMs
    } else if (runStartB != null) {
      const run = snap.capturedAtMs - runStartB
      if (run >= MIN_RUN_MS && run > bestRunB) bestRunB = run
      runStartB = null
    }
  }

  // Close out any guard-drop run still open at exchange end.
  const lastMs = kinematicsHistory[endIdx].capturedAtMs
  if (runStartA != null) {
    const run = lastMs - runStartA
    if (run >= MIN_RUN_MS && run > bestRunA) bestRunA = run
  }
  if (runStartB != null) {
    const run = lastMs - runStartB
    if (run >= MIN_RUN_MS && run > bestRunB) bestRunB = run
  }

  const poseQuality = calculatePoseQuality(kinematicsHistory, startIdx, endIdx)

  return {
    rangeBwAvg: count > 0 ? rangeBwSum / count : 0,
    rangeBwMin: rangeBwMin === Infinity ? 0 : rangeBwMin,
    closingBwpsPeak,
    poseQuality,
    punchAttempts: {
      A: punchAttemptsA,
      B: punchAttemptsB
    },
    guardDropMs: {
      A: bestRunA,
      B: bestRunB,
    }
  }
}

/**
 * Determine exchange phase based on signals
 */
function determinePhase(
  signals: ExchangeSignals,
  startMs: number,
  endMs: number,
  kinematicsHistory: KinematicsSnapshot[]
): ExchangePhase {
  const duration = endMs - startMs
  const avgRange = signals.rangeBwAvg
  const closingSpeed = signals.closingBwpsPeak
  
  // Approach: closing distance with high speed
  if (closingSpeed > 2.0 && avgRange > 2.0 && duration < 1000) {
    return 'approach'
  }
  
  // Engaged: close range with activity
  if (avgRange < 2.5 && (signals.punchAttempts?.A || 0) + (signals.punchAttempts?.B || 0) > 3) {
    return 'engaged'
  }
  
  // Break: increasing distance
  if (closingSpeed < -1.0) {
    return 'break'
  }
  
  return 'unknown'
}

/**
 * Merge exchanges separated by short gaps
 */
function mergeExchanges(exchanges: Exchange[]): Exchange[] {
  if (exchanges.length < 2) return exchanges
  
  const merged: Exchange[] = []
  let current = exchanges[0]
  
  for (let i = 1; i < exchanges.length; i++) {
    const next = exchanges[i]
    const gap = next.startMs - current.endMs
    
    if (gap <= EXCHANGE_CONFIG.T_MERGE) {
      // Merge with current
      current = {
        ...current,
        endMs: next.endMs,
        durationMs: next.endMs - current.startMs,
        signals: {
          rangeBwAvg: (current.signals.rangeBwAvg + next.signals.rangeBwAvg) / 2,
          rangeBwMin: Math.min(current.signals.rangeBwMin, next.signals.rangeBwMin),
          closingBwpsPeak: Math.max(current.signals.closingBwpsPeak, next.signals.closingBwpsPeak),
          poseQuality: {
            A: (current.signals.poseQuality.A + next.signals.poseQuality.A) / 2,
            B: (current.signals.poseQuality.B + next.signals.poseQuality.B) / 2
          },
          punchAttempts: {
            A: (current.signals.punchAttempts?.A || 0) + (next.signals.punchAttempts?.A || 0),
            B: (current.signals.punchAttempts?.B || 0) + (next.signals.punchAttempts?.B || 0)
          },
          // Keep the longest sustained guard-drop run from either sub-exchange
          // (we want the worst defensive lapse, not the average).
          guardDropMs: {
            A: Math.max(current.signals.guardDropMs?.A || 0, next.signals.guardDropMs?.A || 0),
            B: Math.max(current.signals.guardDropMs?.B || 0, next.signals.guardDropMs?.B || 0),
          }
        }
      }
    } else {
      merged.push(current)
      current = next
    }
  }
  merged.push(current)
  
  return merged
}

/**
 * Segment exchanges from kinematics history
 */
export function segmentExchanges(
  kinematicsHistory: KinematicsSnapshot[],
  videoId: string,
  fps: number = 30
): ExchangeTimeline {
  logger.info('Starting exchange segmentation', { frames: kinematicsHistory.length })
  
  if (kinematicsHistory.length === 0) {
    return {
      videoId,
      fps,
      totalDurationMs: 0,
      exchanges: [],
      metadata: {
        totalExchanges: 0,
        avgExchangeDuration: 0,
        avgGapDuration: 0
      }
    }
  }
  
  // Build frame states. Pre-compute punch prefix sums + use a sliding window
  // pointer so the per-frame "recent attempts" lookup is O(1) amortised.
  const frameStates: FrameState[] = []
  const punchPrefix = buildPunchPrefixSums(kinematicsHistory)
  let windowLo = 0

  for (let i = 0; i < kinematicsHistory.length; i++) {
    const snap = kinematicsHistory[i]
    const rangeBw = snap.range?.distanceBw || 10.0
    const closingBwps = snap.range?.closingBwps || 0

    windowLo = advanceWindowStart(
      kinematicsHistory,
      windowLo,
      snap.capturedAtMs - EXCHANGE_CONFIG.T_WINDOW
    )
    const recentAttempts = countRecentPunchAttempts(punchPrefix, windowLo, i)

    const handSpeedA = snap.fighters.A?.handSpeedBwps || 0
    const handSpeedB = snap.fighters.B?.handSpeedBwps || 0
    const totalAttempts = recentAttempts.A + recentAttempts.B

    frameStates.push({
      timestampMs: snap.capturedAtMs,
      rangeState: getRangeState(rangeBw),
      activityState: getActivityState(closingBwps, totalAttempts, handSpeedA, handSpeedB),
      rangeBw,
      closingBwps,
      punchAttempts: recentAttempts,
      poseQuality: {
        A: snap.fighters.A ? 1.0 : 0.0,
        B: snap.fighters.B ? 1.0 : 0.0
      }
    })
  }
  
  // Detect exchanges using state machine
  const rawExchanges: Exchange[] = []
  let inExchange = false
  let exchangeStartIdx = -1
  let engagedFrames = 0
  let disengagedFrames = 0
  
  for (let i = 0; i < frameStates.length; i++) {
    const state = frameStates[i]
    const isEngaged = state.rangeState === 'NEAR' && state.activityState === 'ACTIVE'
    
    if (!inExchange) {
      // Looking for exchange start
      if (isEngaged) {
        engagedFrames++
        if (engagedFrames * (1000 / fps) >= EXCHANGE_CONFIG.T_ENTER) {
          inExchange = true
          exchangeStartIdx = i - engagedFrames + 1
          disengagedFrames = 0
        }
      } else {
        engagedFrames = 0
      }
    } else {
      // In exchange, looking for end
      if (!isEngaged) {
        disengagedFrames++
        if (disengagedFrames * (1000 / fps) >= EXCHANGE_CONFIG.T_EXIT) {
          // End exchange
          const exchangeEndIdx = i - disengagedFrames
          const startMs = kinematicsHistory[exchangeStartIdx].capturedAtMs
          const endMs = kinematicsHistory[exchangeEndIdx].capturedAtMs
          const duration = endMs - startMs
          
          if (duration >= EXCHANGE_CONFIG.T_MIN) {
            const signals = calculateExchangeSignals(kinematicsHistory, exchangeStartIdx, exchangeEndIdx)
            const phase = determinePhase(signals, startMs, endMs, kinematicsHistory)
            
            rawExchanges.push({
              exchangeId: generateExchangeId(rawExchanges.length),
              startMs,
              endMs,
              durationMs: duration,
              phase,
              participants: ['A', 'B'],
              signals
            })
          }
          
          inExchange = false
          engagedFrames = 0
          disengagedFrames = 0
        }
      } else {
        disengagedFrames = 0
      }
    }
  }
  
  // Merge close exchanges
  const mergedExchanges = mergeExchanges(rawExchanges)
  
  // Calculate metadata
  const totalDurationMs = kinematicsHistory[kinematicsHistory.length - 1].capturedAtMs - 
                          kinematicsHistory[0].capturedAtMs
  
  let totalExchangeTime = 0
  let totalGapTime = 0
  
  for (let i = 0; i < mergedExchanges.length; i++) {
    totalExchangeTime += mergedExchanges[i].durationMs
    if (i < mergedExchanges.length - 1) {
      totalGapTime += mergedExchanges[i + 1].startMs - mergedExchanges[i].endMs
    }
  }
  
  logger.info('Exchange segmentation complete', {
    totalExchanges: mergedExchanges.length,
    avgDuration: mergedExchanges.length > 0 ? totalExchangeTime / mergedExchanges.length : 0
  })
  
  return {
    videoId,
    fps,
    totalDurationMs,
    exchanges: mergedExchanges,
    metadata: {
      totalExchanges: mergedExchanges.length,
      avgExchangeDuration: mergedExchanges.length > 0 ? totalExchangeTime / mergedExchanges.length : 0,
      avgGapDuration: mergedExchanges.length > 1 ? totalGapTime / (mergedExchanges.length - 1) : 0
    }
  }
}

/**
 * Get exchange at specific timestamp
 */
export function getExchangeAtTime(timeline: ExchangeTimeline, timestampMs: number): Exchange | null {
  return timeline.exchanges.find(ex => timestampMs >= ex.startMs && timestampMs <= ex.endMs) || null
}

/**
 * Export exchange timeline to JSON for AI analysis
 */
export function exportExchangeTimelineForAI(timeline: ExchangeTimeline): string {
  return JSON.stringify(timeline, null, 2)
}
