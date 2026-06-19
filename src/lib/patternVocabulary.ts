/**
 * Pattern Vocabulary for Fight Analysis
 * 
 * Defines the 10 core patterns from Sparring_MVP_Spec.md
 * Each pattern is detectable via pose + geometry without claiming hits
 */

export type PatternId = 
  | 'RANGE_COLLAPSE_ENTRY'
  | 'STALL_AT_LONG_RANGE'
  | 'LEAD_HAND_HIGH_VOLUME'
  | 'REAR_HAND_RUSHES'
  | 'GUARD_DROP_AFTER_ATTACK'
  | 'HEAD_MOVEMENT_ON_ENTRY'
  | 'LINEAR_BACKPEDAL'
  | 'CIRCLE_OFF_EXIT'
  | 'PAUSE_AFTER_EXCHANGE'
  | 'ASYMMETRIC_INITIATION'
  | 'TAKEDOWN_SETUP'
  | 'CLINCH_INITIATION'
  | 'LEVEL_CHANGE_FEINT'
  | 'GUARD_PULL_TENDENCY'

export interface PatternDefinition {
  id: PatternId
  title: string
  description: string
  detectionLogic: string
  thresholds: Record<string, number>
  signalsUsed: string[]
  minOccurrences: number
  minConfidence: number
}

export const PATTERN_VOCABULARY: Record<PatternId, PatternDefinition> = {
  RANGE_COLLAPSE_ENTRY: {
    id: 'RANGE_COLLAPSE_ENTRY',
    title: 'Rapid Range Collapse',
    description: 'Repeatedly closes distance from long to close range quickly',
    detectionLogic: 'rangeBw transitions from >4.0 to <2.5 within <=1.5s',
    thresholds: {
      startRange: 4.0,
      endRange: 2.5,
      maxDuration: 1500,
      minClosingSpeed: 2.0
    },
    signalsUsed: ['rangeBw', 'closingBwps', 'timestampMs'],
    minOccurrences: 2,
    minConfidence: 0.6
  },

  STALL_AT_LONG_RANGE: {
    id: 'STALL_AT_LONG_RANGE',
    title: 'Stalling at Long Range',
    description: 'Maintains long distance with low activity for extended periods',
    detectionLogic: 'rangeBw >4.0 AND handSpeed <2.0 for >=3s',
    thresholds: {
      minRange: 4.0,
      maxHandSpeed: 2.0,
      minDuration: 3000
    },
    signalsUsed: ['rangeBw', 'handSpeedBwps', 'timestampMs'],
    minOccurrences: 2,
    minConfidence: 0.7
  },

  LEAD_HAND_HIGH_VOLUME: {
    id: 'LEAD_HAND_HIGH_VOLUME',
    title: 'Lead Hand Dominance',
    description: 'Uses lead hand significantly more than rear hand',
    detectionLogic: 'leadHandAttempts / rearHandAttempts > 2.0 across exchanges',
    thresholds: {
      minRatio: 2.0,
      minLeadAttempts: 5
    },
    signalsUsed: ['leftWristSpeed', 'rightWristSpeed', 'handBurstBwps'],
    minOccurrences: 3,
    minConfidence: 0.65
  },

  REAR_HAND_RUSHES: {
    id: 'REAR_HAND_RUSHES',
    title: 'Rear Hand Rush Pattern',
    description: 'Throws rear hand power shots while closing distance aggressively',
    detectionLogic: 'rearHandBurst coincides with closingBwps >2.0',
    thresholds: {
      minBurstSpeed: 6.0,
      minClosingSpeed: 2.0,
      coincidenceWindow: 500
    },
    signalsUsed: ['handBurstBwps', 'closingBwps', 'powerIndex'],
    minOccurrences: 2,
    minConfidence: 0.7
  },

  GUARD_DROP_AFTER_ATTACK: {
    id: 'GUARD_DROP_AFTER_ATTACK',
    title: 'Guard Drop After Offense',
    description: 'Drops hands below defensive position after attacking',
    detectionLogic: 'handBurst followed by guardHeight <0.3 within 800ms',
    thresholds: {
      burstThreshold: 5.0,
      guardHeightMax: 0.3,
      delayWindow: 800,
      minDropDuration: 200
    },
    signalsUsed: ['handBurstBwps', 'wristY', 'noseY'],
    minOccurrences: 2,
    minConfidence: 0.75
  },

  HEAD_MOVEMENT_ON_ENTRY: {
    id: 'HEAD_MOVEMENT_ON_ENTRY',
    title: 'Active Head Movement on Entry',
    description: 'Uses head movement (slips/weaves) when closing distance',
    detectionLogic: 'noseDisplacement >0.15 BW during range collapse',
    thresholds: {
      minDisplacement: 0.15,
      minClosingSpeed: 1.5,
      coincidenceWindow: 1000
    },
    signalsUsed: ['noseX', 'noseY', 'closingBwps'],
    minOccurrences: 2,
    minConfidence: 0.65
  },

  LINEAR_BACKPEDAL: {
    id: 'LINEAR_BACKPEDAL',
    title: 'Linear Backward Retreat',
    description: 'Backs up in straight line when under pressure',
    detectionLogic: 'consistent retreat with lateral displacement <0.3 of backward',
    thresholds: {
      minRetreatSpeed: 1.5,
      maxLateralRatio: 0.3,
      minDuration: 1000
    },
    signalsUsed: ['closingBwps', 'hipCenterX', 'hipCenterY'],
    minOccurrences: 2,
    minConfidence: 0.7
  },

  CIRCLE_OFF_EXIT: {
    id: 'CIRCLE_OFF_EXIT',
    title: 'Circular Exit Pattern',
    description: 'Uses lateral movement to exit exchanges instead of backing straight up',
    detectionLogic: 'lateral displacement >0.5 of backward after exchange',
    thresholds: {
      minLateralRatio: 0.5,
      exitWindow: 2000,
      minDisplacement: 0.5
    },
    signalsUsed: ['hipCenterX', 'hipCenterY', 'closingBwps'],
    minOccurrences: 2,
    minConfidence: 0.65
  },

  PAUSE_AFTER_EXCHANGE: {
    id: 'PAUSE_AFTER_EXCHANGE',
    title: 'Consistent Post-Exchange Pause',
    description: 'Takes recovery pause after exchanges with low activity',
    detectionLogic: 'handSpeed <1.5 AND range stable for >=1.5s after exchange',
    thresholds: {
      maxHandSpeed: 1.5,
      maxRangeChange: 0.5,
      minDuration: 1500,
      postExchangeWindow: 3000
    },
    signalsUsed: ['handSpeedBwps', 'rangeBw', 'closingBwps'],
    minOccurrences: 2,
    minConfidence: 0.7
  },

  ASYMMETRIC_INITIATION: {
    id: 'ASYMMETRIC_INITIATION',
    title: 'One-Sided Exchange Initiation',
    description: 'One fighter initiates majority of exchanges',
    detectionLogic: 'first punchAttempt or closing burst in >=70% of exchanges',
    thresholds: {
      minInitiationRatio: 0.7,
      initiationWindow: 500
    },
    signalsUsed: ['handBurstBwps', 'closingBwps', 'timestampMs'],
    minOccurrences: 3,
    minConfidence: 0.8
  },

  // ========== GRAPPLING / MMA PATTERNS ==========

  TAKEDOWN_SETUP: {
    id: 'TAKEDOWN_SETUP',
    title: 'Takedown Setup Pattern',
    description: 'Uses strikes or feints to set up level changes and takedown entries',
    detectionLogic: 'handBurst followed by rapid hipY drop >0.2 BW within 800ms',
    thresholds: {
      minBurstSpeed: 3.0,
      minHipDrop: 0.2,
      setupWindow: 800
    },
    signalsUsed: ['handBurstBwps', 'hipCenterY', 'closingBwps'],
    minOccurrences: 2,
    minConfidence: 0.65
  },

  CLINCH_INITIATION: {
    id: 'CLINCH_INITIATION',
    title: 'Clinch Entry Pattern',
    description: 'Repeatedly closes to clinch range and engages in grappling exchanges',
    detectionLogic: 'rangeBw collapses to <1.5 AND handSpeed drops (grappling, not striking)',
    thresholds: {
      maxRange: 1.5,
      maxHandSpeed: 2.0,
      minDuration: 1500
    },
    signalsUsed: ['rangeBw', 'handSpeedBwps', 'closingBwps'],
    minOccurrences: 2,
    minConfidence: 0.6
  },

  LEVEL_CHANGE_FEINT: {
    id: 'LEVEL_CHANGE_FEINT',
    title: 'Level Change Feint',
    description: 'Uses level changes (hip drops) as feints to draw reactions before striking',
    detectionLogic: 'hipY drops >0.15 BW then returns within 600ms, followed by handBurst',
    thresholds: {
      minHipDrop: 0.15,
      maxDropDuration: 600,
      followUpWindow: 800
    },
    signalsUsed: ['hipCenterY', 'handBurstBwps', 'timestampMs'],
    minOccurrences: 2,
    minConfidence: 0.6
  },

  GUARD_PULL_TENDENCY: {
    id: 'GUARD_PULL_TENDENCY',
    title: 'Guard Pull / Sit-Down Tendency',
    description: 'Fighter drops to seated/guard position voluntarily during exchanges',
    detectionLogic: 'hipY drops >0.4 BW without opponent closing (voluntary sit-down)',
    thresholds: {
      minHipDrop: 0.4,
      maxOpponentClosing: 1.0,
      detectionWindow: 1000
    },
    signalsUsed: ['hipCenterY', 'closingBwps', 'rangeBw'],
    minOccurrences: 1,
    minConfidence: 0.7
  }
}

/**
 * Get pattern definition by ID
 */
export function getPatternDefinition(patternId: PatternId): PatternDefinition {
  return PATTERN_VOCABULARY[patternId]
}

/**
 * Get all pattern IDs
 */
export function getAllPatternIds(): PatternId[] {
  return Object.keys(PATTERN_VOCABULARY) as PatternId[]
}

/**
 * Get patterns filtered by minimum confidence
 */
export function getPatternsByConfidence(minConfidence: number): PatternDefinition[] {
  return Object.values(PATTERN_VOCABULARY).filter(p => p.minConfidence <= minConfidence)
}
