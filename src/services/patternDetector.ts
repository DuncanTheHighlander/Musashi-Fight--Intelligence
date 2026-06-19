/**
 * Pattern Detection System
 * 
 * Detects recurring fight patterns from exchange timeline and kinematics data
 * Returns top 3 patterns with highest confidence and evidence timestamps
 */

import type { Exchange, ExchangeTimeline } from './exchangeSegmenter'
import type { KinematicsSnapshot } from '@/lib/kinematics'
import { PATTERN_VOCABULARY, type PatternId, type PatternDefinition } from '@/lib/patternVocabulary'
import { logger } from '@/lib/logger'

export interface PatternEvidence {
  exchangeId: string
  startMs: number
  endMs: number
  confidence: number
  metrics: Record<string, number>
}

export interface PatternFinding {
  patternId: PatternId
  title: string
  summary: string
  confidence: number
  occurrences: number
  evidence: PatternEvidence[]
  traceability: {
    signalsUsed: string[]
    thresholds: Record<string, number>
    aggregation: string
  }
}

export interface PatternAnalysisResult {
  videoId: string
  generatedAt: string
  topPatterns: PatternFinding[]
  allPatterns: PatternFinding[]
}

/**
 * Detect RANGE_COLLAPSE_ENTRY pattern
 */
function detectRangeCollapseEntry(
  exchanges: Exchange[],
  kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  const evidence: PatternEvidence[] = []
  const def = PATTERN_VOCABULARY.RANGE_COLLAPSE_ENTRY
  
  for (const exchange of exchanges) {
    // Find kinematics in this exchange window
    const exchangeKinematics = kinematicsHistory.filter(
      k => k.capturedAtMs >= exchange.startMs && k.capturedAtMs <= exchange.endMs
    )
    
    if (exchangeKinematics.length < 2) continue
    
    // Check for rapid range collapse
    const startRange = exchangeKinematics[0].range?.distanceBw || 0
    const minRange = Math.min(...exchangeKinematics.map(k => k.range?.distanceBw || 10))
    const duration = exchange.endMs - exchange.startMs
    const peakClosingSpeed = exchange.signals.closingBwpsPeak
    
    if (startRange >= def.thresholds.startRange &&
        minRange <= def.thresholds.endRange &&
        duration <= def.thresholds.maxDuration &&
        peakClosingSpeed >= def.thresholds.minClosingSpeed) {
      
      const confidence = Math.min(
        0.95,
        (peakClosingSpeed / def.thresholds.minClosingSpeed) * 0.3 +
        ((def.thresholds.maxDuration - duration) / def.thresholds.maxDuration) * 0.4 +
        ((startRange - def.thresholds.startRange) / 2.0) * 0.3
      )
      
      evidence.push({
        exchangeId: exchange.exchangeId,
        startMs: exchange.startMs,
        endMs: exchange.endMs,
        confidence,
        metrics: {
          startRange,
          endRange: minRange,
          duration,
          closingSpeed: peakClosingSpeed
        }
      })
    }
  }
  
  return evidence
}

/**
 * Detect STALL_AT_LONG_RANGE pattern
 */
function detectStallAtLongRange(
  exchanges: Exchange[],
  kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  const evidence: PatternEvidence[] = []
  const def = PATTERN_VOCABULARY.STALL_AT_LONG_RANGE
  
  // Find gaps between exchanges (stalling periods)
  for (let i = 0; i < exchanges.length - 1; i++) {
    const gapStart = exchanges[i].endMs
    const gapEnd = exchanges[i + 1].startMs
    const gapDuration = gapEnd - gapStart
    
    if (gapDuration < def.thresholds.minDuration) continue
    
    // Get kinematics during gap
    const gapKinematics = kinematicsHistory.filter(
      k => k.capturedAtMs >= gapStart && k.capturedAtMs <= gapEnd
    )
    
    if (gapKinematics.length === 0) continue
    
    // Check if maintaining long range with low activity
    const avgRange = gapKinematics.reduce((sum, k) => sum + (k.range?.distanceBw || 0), 0) / gapKinematics.length
    const maxHandSpeed = Math.max(
      ...gapKinematics.map(k => 
        Math.max(k.fighters.A?.handSpeedBwps || 0, k.fighters.B?.handSpeedBwps || 0)
      )
    )
    
    if (avgRange >= def.thresholds.minRange && maxHandSpeed <= def.thresholds.maxHandSpeed) {
      const confidence = Math.min(
        0.95,
        (avgRange / def.thresholds.minRange) * 0.4 +
        (1 - maxHandSpeed / def.thresholds.maxHandSpeed) * 0.3 +
        (gapDuration / def.thresholds.minDuration) * 0.3
      )
      
      evidence.push({
        exchangeId: `gap_${i}`,
        startMs: gapStart,
        endMs: gapEnd,
        confidence,
        metrics: {
          avgRange,
          maxHandSpeed,
          duration: gapDuration
        }
      })
    }
  }
  
  return evidence
}

/**
 * Detect GUARD_DROP_AFTER_ATTACK pattern
 */
function detectGuardDropAfterAttack(
  exchanges: Exchange[],
  kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  const evidence: PatternEvidence[] = []
  const def = PATTERN_VOCABULARY.GUARD_DROP_AFTER_ATTACK
  
  for (const exchange of exchanges) {
    const exchangeKinematics = kinematicsHistory.filter(
      k => k.capturedAtMs >= exchange.startMs && k.capturedAtMs <= exchange.endMs + def.thresholds.delayWindow
    )
    
    // Look for burst followed by guard drop
    for (let i = 0; i < exchangeKinematics.length - 3; i++) {
      const current = exchangeKinematics[i]
      
      // Check for hand burst
      const hasBurst = 
        (current.fighters.A?.handBurstBwps || 0) >= def.thresholds.burstThreshold ||
        (current.fighters.B?.handBurstBwps || 0) >= def.thresholds.burstThreshold
      
      if (!hasBurst) continue
      
      // Check for guard drop in next frames within delay window
      const burstTime = current.capturedAtMs
      const laterFrames = exchangeKinematics.slice(i + 1, i + 8).filter(
        k => k.capturedAtMs - burstTime <= def.thresholds.delayWindow
      )
      
      // Simple guard drop proxy: look for low hand speed after burst
      const hasGuardDrop = laterFrames.some(k => {
        const handSpeedA = k.fighters.A?.handSpeedBwps || 0
        const handSpeedB = k.fighters.B?.handSpeedBwps || 0
        return handSpeedA < 1.0 || handSpeedB < 1.0
      })
      
      if (hasGuardDrop) {
        const dropFrame = laterFrames.find(k => 
          (k.fighters.A?.handSpeedBwps || 0) < 1.0 || (k.fighters.B?.handSpeedBwps || 0) < 1.0
        )
        
        if (dropFrame) {
          const delay = dropFrame.capturedAtMs - burstTime
          const confidence = Math.min(
            0.9,
            (1 - delay / def.thresholds.delayWindow) * 0.6 +
            0.4
          )
          
          evidence.push({
            exchangeId: exchange.exchangeId,
            startMs: burstTime,
            endMs: dropFrame.capturedAtMs,
            confidence,
            metrics: {
              burstSpeed: Math.max(
                current.fighters.A?.handBurstBwps || 0,
                current.fighters.B?.handBurstBwps || 0
              ),
              delay
            }
          })
          
          break // Only count once per exchange
        }
      }
    }
  }
  
  return evidence
}

/**
 * Detect ASYMMETRIC_INITIATION pattern
 */
function detectAsymmetricInitiation(
  exchanges: Exchange[],
  kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  const def = PATTERN_VOCABULARY.ASYMMETRIC_INITIATION
  
  if (exchanges.length < def.minOccurrences) return []
  
  let initiatedByA = 0
  let initiatedByB = 0
  const evidence: PatternEvidence[] = []
  
  for (const exchange of exchanges) {
    // Get first 500ms of exchange
    const initWindow = kinematicsHistory.filter(
      k => k.capturedAtMs >= exchange.startMs && 
           k.capturedAtMs <= exchange.startMs + def.thresholds.initiationWindow
    )
    
    if (initWindow.length === 0) continue
    
    // Find who moved first (highest burst or closing speed)
    let maxBurstA = 0
    let maxBurstB = 0
    
    for (const snap of initWindow) {
      maxBurstA = Math.max(maxBurstA, snap.fighters.A?.handBurstBwps || 0)
      maxBurstB = Math.max(maxBurstB, snap.fighters.B?.handBurstBwps || 0)
    }
    
    if (maxBurstA > maxBurstB) {
      initiatedByA++
    } else if (maxBurstB > maxBurstA) {
      initiatedByB++
    }
  }
  
  const total = initiatedByA + initiatedByB
  if (total === 0) return []
  
  const ratioA = initiatedByA / total
  const ratioB = initiatedByB / total
  
  if (ratioA >= def.thresholds.minInitiationRatio) {
    const confidence = Math.min(0.95, ratioA * 1.1)
    evidence.push({
      exchangeId: 'pattern_asymmetric_a',
      startMs: exchanges[0].startMs,
      endMs: exchanges[exchanges.length - 1].endMs,
      confidence,
      metrics: {
        initiationRatio: ratioA,
        initiatedCount: initiatedByA,
        totalExchanges: total
      }
    })
  } else if (ratioB >= def.thresholds.minInitiationRatio) {
    const confidence = Math.min(0.95, ratioB * 1.1)
    evidence.push({
      exchangeId: 'pattern_asymmetric_b',
      startMs: exchanges[0].startMs,
      endMs: exchanges[exchanges.length - 1].endMs,
      confidence,
      metrics: {
        initiationRatio: ratioB,
        initiatedCount: initiatedByB,
        totalExchanges: total
      }
    })
  }
  
  return evidence
}

/**
 * Detect PAUSE_AFTER_EXCHANGE pattern
 */
function detectPauseAfterExchange(
  exchanges: Exchange[],
  kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  const evidence: PatternEvidence[] = []
  const def = PATTERN_VOCABULARY.PAUSE_AFTER_EXCHANGE
  
  for (let i = 0; i < exchanges.length - 1; i++) {
    const exchange = exchanges[i]
    const pauseStart = exchange.endMs
    const pauseEnd = Math.min(
      pauseStart + def.thresholds.postExchangeWindow,
      exchanges[i + 1].startMs
    )
    
    const pauseKinematics = kinematicsHistory.filter(
      k => k.capturedAtMs >= pauseStart && k.capturedAtMs <= pauseEnd
    )
    
    if (pauseKinematics.length < 3) continue
    
    const pauseDuration = pauseEnd - pauseStart
    if (pauseDuration < def.thresholds.minDuration) continue
    
    // Check for low activity during pause
    const avgHandSpeed = pauseKinematics.reduce((sum, k) => {
      const speedA = k.fighters.A?.handSpeedBwps || 0
      const speedB = k.fighters.B?.handSpeedBwps || 0
      return sum + Math.max(speedA, speedB)
    }, 0) / pauseKinematics.length
    
    const rangeChange = Math.abs(
      (pauseKinematics[pauseKinematics.length - 1].range?.distanceBw || 0) -
      (pauseKinematics[0].range?.distanceBw || 0)
    )
    
    if (avgHandSpeed <= def.thresholds.maxHandSpeed && 
        rangeChange <= def.thresholds.maxRangeChange) {
      
      const confidence = Math.min(
        0.9,
        (1 - avgHandSpeed / def.thresholds.maxHandSpeed) * 0.5 +
        (pauseDuration / def.thresholds.minDuration) * 0.3 +
        (1 - rangeChange / def.thresholds.maxRangeChange) * 0.2
      )
      
      evidence.push({
        exchangeId: exchange.exchangeId,
        startMs: pauseStart,
        endMs: pauseEnd,
        confidence,
        metrics: {
          duration: pauseDuration,
          avgHandSpeed,
          rangeChange
        }
      })
    }
  }
  
  return evidence
}

/**
 * Detect LEAD_HAND_HIGH_VOLUME pattern
 */
function detectLeadHandHighVolume(
  exchanges: Exchange[],
  kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  const evidence: PatternEvidence[] = []
  const def = PATTERN_VOCABULARY.LEAD_HAND_HIGH_VOLUME
  
  for (const exchange of exchanges) {
    const exchangeKinematics = kinematicsHistory.filter(
      k => k.capturedAtMs >= exchange.startMs && k.capturedAtMs <= exchange.endMs
    )
    
    if (exchangeKinematics.length < 10) continue
    
    // Count lead vs rear hand bursts for each fighter
    let leadBurstsA = 0
    let rearBurstsA = 0
    let leadBurstsB = 0
    let rearBurstsB = 0
    
    for (const snap of exchangeKinematics) {
      // Fighter A - assume left is lead for orthodox
      if (snap.fighters.A) {
        const handBurst = snap.fighters.A.handBurstBwps || 0
        if (handBurst > 4.0) {
          // Simple heuristic: faster burst = likely lead hand (jabs are faster)
          if (handBurst > 7.0) {
            leadBurstsA++
          } else {
            rearBurstsA++
          }
        }
      }
      
      // Fighter B
      if (snap.fighters.B) {
        const handBurst = snap.fighters.B.handBurstBwps || 0
        if (handBurst > 4.0) {
          if (handBurst > 7.0) {
            leadBurstsB++
          } else {
            rearBurstsB++
          }
        }
      }
    }
    
    // Check Fighter A
    if (leadBurstsA >= def.thresholds.minLeadAttempts && rearBurstsA > 0) {
      const ratioA = leadBurstsA / rearBurstsA
      if (ratioA >= def.thresholds.minRatio) {
        const confidence = Math.min(0.9, (ratioA / def.thresholds.minRatio) * 0.5 + 0.4)
        evidence.push({
          exchangeId: exchange.exchangeId,
          startMs: exchange.startMs,
          endMs: exchange.endMs,
          confidence,
          metrics: {
            leadAttempts: leadBurstsA,
            rearAttempts: rearBurstsA,
            ratio: ratioA
          }
        })
      }
    }
    
    // Check Fighter B
    if (leadBurstsB >= def.thresholds.minLeadAttempts && rearBurstsB > 0) {
      const ratioB = leadBurstsB / rearBurstsB
      if (ratioB >= def.thresholds.minRatio) {
        const confidence = Math.min(0.9, (ratioB / def.thresholds.minRatio) * 0.5 + 0.4)
        evidence.push({
          exchangeId: exchange.exchangeId,
          startMs: exchange.startMs,
          endMs: exchange.endMs,
          confidence,
          metrics: {
            leadAttempts: leadBurstsB,
            rearAttempts: rearBurstsB,
            ratio: ratioB
          }
        })
      }
    }
  }
  
  return evidence
}

/**
 * Detect REAR_HAND_RUSHES pattern
 */
function detectRearHandRushes(
  exchanges: Exchange[],
  kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  const evidence: PatternEvidence[] = []
  const def = PATTERN_VOCABULARY.REAR_HAND_RUSHES
  
  for (const exchange of exchanges) {
    const exchangeKinematics = kinematicsHistory.filter(
      k => k.capturedAtMs >= exchange.startMs && k.capturedAtMs <= exchange.endMs
    )
    
    // Look for high burst coinciding with closing
    for (let i = 0; i < exchangeKinematics.length - 2; i++) {
      const snap = exchangeKinematics[i]
      const closingSpeed = Math.abs(snap.range?.closingBwps || 0)
      
      // Check Fighter A
      const burstA = snap.fighters.A?.handBurstBwps || 0
      if (burstA >= def.thresholds.minBurstSpeed && 
          closingSpeed >= def.thresholds.minClosingSpeed) {
        
        const confidence = Math.min(
          0.9,
          (burstA / def.thresholds.minBurstSpeed) * 0.4 +
          (closingSpeed / def.thresholds.minClosingSpeed) * 0.4 +
          0.2
        )
        
        evidence.push({
          exchangeId: exchange.exchangeId,
          startMs: snap.capturedAtMs,
          endMs: snap.capturedAtMs + def.thresholds.coincidenceWindow,
          confidence,
          metrics: {
            burstSpeed: burstA,
            closingSpeed,
            powerIndex: snap.fighters.A?.powerIndex || 0
          }
        })
      }
      
      // Check Fighter B
      const burstB = snap.fighters.B?.handBurstBwps || 0
      if (burstB >= def.thresholds.minBurstSpeed && 
          closingSpeed >= def.thresholds.minClosingSpeed) {
        
        const confidence = Math.min(
          0.9,
          (burstB / def.thresholds.minBurstSpeed) * 0.4 +
          (closingSpeed / def.thresholds.minClosingSpeed) * 0.4 +
          0.2
        )
        
        evidence.push({
          exchangeId: exchange.exchangeId,
          startMs: snap.capturedAtMs,
          endMs: snap.capturedAtMs + def.thresholds.coincidenceWindow,
          confidence,
          metrics: {
            burstSpeed: burstB,
            closingSpeed,
            powerIndex: snap.fighters.B?.powerIndex || 0
          }
        })
      }
    }
  }
  
  return evidence
}

/**
 * Detect HEAD_MOVEMENT_ON_ENTRY pattern
 */
function detectHeadMovementOnEntry(
  exchanges: Exchange[],
  kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  const evidence: PatternEvidence[] = []
  const def = PATTERN_VOCABULARY.HEAD_MOVEMENT_ON_ENTRY
  
  for (const exchange of exchanges) {
    if (exchange.phase !== 'approach') continue
    
    const exchangeKinematics = kinematicsHistory.filter(
      k => k.capturedAtMs >= exchange.startMs && 
           k.capturedAtMs <= exchange.startMs + def.thresholds.coincidenceWindow
    )
    
    if (exchangeKinematics.length < 5) continue
    
    // Track head displacement during closing - this is a simplified heuristic
    // In reality, we'd need actual nose position tracking across frames
    const closingSpeed = exchange.signals.closingBwpsPeak
    
    if (closingSpeed >= def.thresholds.minClosingSpeed) {
      // Proxy for head movement: variation in fighter position quality
      // If pose quality fluctuates, likely head is moving
      const qualityVariance = exchangeKinematics.reduce((variance, snap, idx) => {
        if (idx === 0) return 0
        const prevQuality = exchangeKinematics[idx - 1].fighters.A ? 1 : 0
        const currQuality = snap.fighters.A ? 1 : 0
        return variance + Math.abs(currQuality - prevQuality)
      }, 0) / exchangeKinematics.length
      
      // Higher variance suggests active movement (rough heuristic)
      if (qualityVariance > 0.1) {
        const confidence = Math.min(0.75, qualityVariance * 3 + 0.3)
        
        evidence.push({
          exchangeId: exchange.exchangeId,
          startMs: exchange.startMs,
          endMs: exchange.startMs + def.thresholds.coincidenceWindow,
          confidence,
          metrics: {
            closingSpeed,
            movementProxy: qualityVariance
          }
        })
      }
    }
  }
  
  return evidence
}

/**
 * Detect LINEAR_BACKPEDAL pattern
 */
function detectLinearBackpedal(
  exchanges: Exchange[],
  kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  const evidence: PatternEvidence[] = []
  const def = PATTERN_VOCABULARY.LINEAR_BACKPEDAL
  
  // Look for retreat patterns (negative closing speed)
  for (let i = 0; i < kinematicsHistory.length - 10; i++) {
    const windowStart = kinematicsHistory[i]
    const windowEnd = kinematicsHistory[Math.min(i + 10, kinematicsHistory.length - 1)]
    const duration = windowEnd.capturedAtMs - windowStart.capturedAtMs
    
    if (duration < def.thresholds.minDuration) continue
    
    // Check for consistent retreat (negative closing = increasing range)
    let retreatCount = 0
    let totalFrames = 0
    
    for (let j = i; j < Math.min(i + 10, kinematicsHistory.length); j++) {
      const snap = kinematicsHistory[j]
      if (snap.range && snap.range.closingBwps < -def.thresholds.minRetreatSpeed) {
        retreatCount++
      }
      totalFrames++
    }
    
    const retreatRatio = retreatCount / totalFrames
    
    if (retreatRatio > 0.7) {
      // Linear check: in reality would need lateral vs backward displacement
      // For now, consistent retreat = likely linear
      const confidence = Math.min(0.8, retreatRatio * 0.9)
      
      evidence.push({
        exchangeId: `retreat_${i}`,
        startMs: windowStart.capturedAtMs,
        endMs: windowEnd.capturedAtMs,
        confidence,
        metrics: {
          retreatRatio,
          duration,
          avgRetreatSpeed: -kinematicsHistory.slice(i, i + 10)
            .reduce((sum, k) => sum + (k.range?.closingBwps || 0), 0) / totalFrames
        }
      })
      
      // Skip ahead to avoid overlapping detections
      i += 10
    }
  }
  
  return evidence
}

/**
 * Detect CIRCLE_OFF_EXIT pattern
 */
function detectCircleOffExit(
  exchanges: Exchange[],
  kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  const evidence: PatternEvidence[] = []
  const def = PATTERN_VOCABULARY.CIRCLE_OFF_EXIT
  
  for (const exchange of exchanges) {
    // Look at frames immediately after exchange ends
    const exitStart = exchange.endMs
    const exitEnd = exitStart + def.thresholds.exitWindow
    
    const exitKinematics = kinematicsHistory.filter(
      k => k.capturedAtMs >= exitStart && k.capturedAtMs <= exitEnd
    )
    
    if (exitKinematics.length < 5) continue
    
    // Heuristic: if range is increasing (retreat) check movement pattern
    // In full implementation would track lateral vs backward displacement
    const avgClosing = exitKinematics.reduce((sum, k) => 
      sum + (k.range?.closingBwps || 0), 0
    ) / exitKinematics.length
    
    // Negative closing = increasing range (exiting)
    if (avgClosing < -0.5) {
      // Proxy for lateral movement: check if fighters are still detected
      // (if circling well, stays in frame)
      const qualityA = exitKinematics.filter(k => k.fighters.A).length / exitKinematics.length
      const qualityB = exitKinematics.filter(k => k.fighters.B).length / exitKinematics.length
      
      const avgQuality = (qualityA + qualityB) / 2
      
      // Higher quality during exit suggests controlled lateral exit
      if (avgQuality > 0.8) {
        const confidence = Math.min(0.75, avgQuality * 0.7 + 0.2)
        
        evidence.push({
          exchangeId: exchange.exchangeId,
          startMs: exitStart,
          endMs: exitEnd,
          confidence,
          metrics: {
            avgClosingSpeed: avgClosing,
            poseQualityDuringExit: avgQuality
          }
        })
      }
    }
  }
  
  return evidence
}

/**
 * Calculate overall pattern confidence from evidence
 */
function calculatePatternConfidence(
  evidence: PatternEvidence[],
  definition: PatternDefinition,
  totalDurationMs: number
): number {
  if (evidence.length < definition.minOccurrences) return 0
  
  // Average per-occurrence confidence
  const avgOccurrenceConfidence = evidence.reduce((sum, e) => sum + e.confidence, 0) / evidence.length
  
  // Frequency score (more occurrences = higher confidence)
  const frequencyScore = Math.min(1.0, evidence.length / (definition.minOccurrences * 2))
  
  // Temporal diversity (not all clustered in one area)
  const timestamps = evidence.map(e => e.startMs).sort((a, b) => a - b)
  let maxGap = 0
  for (let i = 1; i < timestamps.length; i++) {
    maxGap = Math.max(maxGap, timestamps[i] - timestamps[i - 1])
  }
  const diversityScore = maxGap > totalDurationMs * 0.3 ? 1.0 : 0.7
  
  // Combine scores
  return Math.min(
    0.95,
    avgOccurrenceConfidence * 0.5 +
    frequencyScore * 0.3 +
    diversityScore * 0.2
  )
}

/**
 * Detect TAKEDOWN_SETUP pattern (stub — requires ground-pose detection)
 */
function detectTakedownSetup(
  exchanges: Exchange[],
  kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  const evidence: PatternEvidence[] = []
  const def = PATTERN_VOCABULARY.TAKEDOWN_SETUP

  for (const exchange of exchanges) {
    const exchangeKinematics = kinematicsHistory.filter(
      k => k.capturedAtMs >= exchange.startMs && k.capturedAtMs <= exchange.endMs
    )
    if (exchangeKinematics.length < 2) continue

    // Look for hand burst followed by rapid hip drop (level change)
    for (let i = 0; i < exchangeKinematics.length - 1; i++) {
      const curr = exchangeKinematics[i]
      const next = exchangeKinematics[i + 1]
      const burst = Math.max(
        curr.fighters?.A?.handSpeedBwps || 0,
        curr.fighters?.B?.handSpeedBwps || 0
      )
      const hipDrop = Math.abs(
        (next.fighters?.A?.hipSpeedBwps || 0) - (curr.fighters?.A?.hipSpeedBwps || 0)
      )
      if (burst >= def.thresholds.minBurstSpeed && hipDrop >= def.thresholds.minHipDrop) {
        evidence.push({
          exchangeId: exchange.exchangeId,
          startMs: curr.capturedAtMs,
          endMs: next.capturedAtMs,
          confidence: 0.6,
          metrics: { burst, hipDrop }
        })
        break
      }
    }
  }
  return evidence
}

/**
 * Detect CLINCH_INITIATION pattern
 */
function detectClinchInitiation(
  exchanges: Exchange[],
  kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  const evidence: PatternEvidence[] = []
  const def = PATTERN_VOCABULARY.CLINCH_INITIATION

  for (const exchange of exchanges) {
    if (exchange.signals.rangeBwMin <= def.thresholds.maxRange &&
        exchange.durationMs >= def.thresholds.minDuration) {
      const exchangeKinematics = kinematicsHistory.filter(
        k => k.capturedAtMs >= exchange.startMs && k.capturedAtMs <= exchange.endMs
      )
      const avgHandSpeed = exchangeKinematics.length > 0
        ? exchangeKinematics.reduce((sum, k) => sum + (k.fighters?.A?.handSpeedBwps || 0), 0) / exchangeKinematics.length
        : 999
      if (avgHandSpeed <= def.thresholds.maxHandSpeed) {
        evidence.push({
          exchangeId: exchange.exchangeId,
          startMs: exchange.startMs,
          endMs: exchange.endMs,
          confidence: 0.6,
          metrics: { rangeBwMin: exchange.signals.rangeBwMin, avgHandSpeed }
        })
      }
    }
  }
  return evidence
}

/**
 * Detect LEVEL_CHANGE_FEINT pattern (stub)
 */
function detectLevelChangeFeint(
  _exchanges: Exchange[],
  _kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  // Requires hip-center Y tracking which is not yet in kinematics snapshots
  return []
}

/**
 * Detect GUARD_PULL_TENDENCY pattern (stub)
 */
function detectGuardPullTendency(
  _exchanges: Exchange[],
  _kinematicsHistory: KinematicsSnapshot[]
): PatternEvidence[] {
  // Requires hip-center Y tracking to detect voluntary sit-downs
  return []
}

/**
 * Detect all patterns and return findings
 */
export function detectPatterns(
  timeline: ExchangeTimeline,
  kinematicsHistory: KinematicsSnapshot[]
): PatternAnalysisResult {
  logger.info('Starting pattern detection', {
    exchanges: timeline.exchanges.length,
    kinematicsFrames: kinematicsHistory.length
  })
  
  const findings: PatternFinding[] = []
  
  // Detect each pattern type
  const patternDetectors: Record<PatternId, (e: Exchange[], k: KinematicsSnapshot[]) => PatternEvidence[]> = {
    RANGE_COLLAPSE_ENTRY: detectRangeCollapseEntry,
    STALL_AT_LONG_RANGE: detectStallAtLongRange,
    GUARD_DROP_AFTER_ATTACK: detectGuardDropAfterAttack,
    ASYMMETRIC_INITIATION: detectAsymmetricInitiation,
    PAUSE_AFTER_EXCHANGE: detectPauseAfterExchange,
    LEAD_HAND_HIGH_VOLUME: detectLeadHandHighVolume,
    REAR_HAND_RUSHES: detectRearHandRushes,
    HEAD_MOVEMENT_ON_ENTRY: detectHeadMovementOnEntry,
    LINEAR_BACKPEDAL: detectLinearBackpedal,
    CIRCLE_OFF_EXIT: detectCircleOffExit,
    // Grappling patterns — stubs until ground-pose detection is implemented
    TAKEDOWN_SETUP: detectTakedownSetup,
    CLINCH_INITIATION: detectClinchInitiation,
    LEVEL_CHANGE_FEINT: detectLevelChangeFeint,
    GUARD_PULL_TENDENCY: detectGuardPullTendency
  }
  
  for (const [patternId, detector] of Object.entries(patternDetectors)) {
    const definition = PATTERN_VOCABULARY[patternId as PatternId]
    const evidence = detector(timeline.exchanges, kinematicsHistory)
    
    if (evidence.length >= definition.minOccurrences) {
      const confidence = calculatePatternConfidence(
        evidence,
        definition,
        timeline.totalDurationMs
      )
      
      if (confidence >= definition.minConfidence) {
        findings.push({
          patternId: patternId as PatternId,
          title: definition.title,
          summary: definition.description,
          confidence,
          occurrences: evidence.length,
          evidence,
          traceability: {
            signalsUsed: definition.signalsUsed,
            thresholds: definition.thresholds,
            aggregation: definition.detectionLogic
          }
        })
      }
    }
  }
  
  // Sort by confidence descending
  findings.sort((a, b) => b.confidence - a.confidence)
  
  logger.info('Pattern detection complete', {
    patternsFound: findings.length,
    topPattern: findings[0]?.patternId || 'none'
  })
  
  return {
    videoId: timeline.videoId,
    generatedAt: new Date().toISOString(),
    topPatterns: findings.slice(0, 3),
    allPatterns: findings
  }
}

/**
 * Format pattern finding for AI prompt context
 */
export function formatPatternForAI(finding: PatternFinding): string {
  return `
Pattern: ${finding.title}
Confidence: ${(finding.confidence * 100).toFixed(0)}%
Occurrences: ${finding.occurrences}
Description: ${finding.summary}
Evidence timestamps: ${finding.evidence.map(e => `${(e.startMs / 1000).toFixed(1)}s`).join(', ')}
Detection logic: ${finding.traceability.aggregation}
`.trim()
}

/**
 * Export all patterns for AI context
 */
export function exportPatternsForAI(analysis: PatternAnalysisResult): string {
  if (analysis.topPatterns.length === 0) {
    return 'No significant patterns detected in this video.'
  }
  
  return analysis.topPatterns.map(formatPatternForAI).join('\n\n')
}
