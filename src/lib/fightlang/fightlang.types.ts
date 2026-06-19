/**
 * CANONICAL FIGHTLANG COMPILED LEDGER — SERVER-SIDE
 *
 * This is the authoritative FightEvidenceLedger type used by:
 *   - fightlang.compiler.ts (produces this from pose frames)
 *   - /api/fight/analyze (API endpoint)
 *   - gemini-client.ts (LLM grounding)
 *   - validators/fightlang.validator.ts (Zod validation)
 *
 * ⚠️  There is also a lightweight BROWSER-SIDE accumulator ledger in:
 *   @/lib/fightlang/ledger.ts → FightEvidenceLedger (ledger.ts)
 *
 * The ledger.ts version has a completely different shape:
 * { version: 1, recentFrames: [], aggregates: { A, B } }
 * It is used for real-time browser preview only (CoachSidebar, FightOverlay).
 *
 * Always import from this file for analysis pipeline work.
 */

export const FIGHTLANG_CONTRACT_VERSION = '1.0.0' as const

export type ActorId = 'A' | 'B'

export type TimeRangeMs = Readonly<{ startMs: number; endMs: number }>

export type EvidenceSource =
  | 'pose'
  | 'track'
  | 'geometry'
  | 'kinematics'
  | 'compiler'
  | 'user'
  | 'llm'

/** A citeable reference that grounds claims to time + source. */
export type EvidenceRef = Readonly<{
  id: string
  source: EvidenceSource
  actorId?: ActorId
  t: TimeRangeMs
  note?: string
  /** Optional pointer to a frame index, keyframe id, or external asset id. */
  pointer?: string
}>

export type Confidence = Readonly<{
  score: number // 0..1
  basis?: 'heuristic' | 'model' | 'user' | 'mixed'
}>

export type Vec2 = Readonly<{ x: number; y: number }>
export type Vec3 = Readonly<{ x: number; y: number; z?: number }>

/**
 * Layer 1: Perception / Ingestion
 * Minimal pose representation (MediaPipe-compatible, but tool-agnostic).
 */
export type PoseLandmark = Readonly<{
  x: number
  y: number
  z?: number
  visibility?: number
}>

export type PoseFrame = Readonly<{
  tMs: number
  videoTimeSec: number | null
  actors: Partial<Record<ActorId, ReadonlyArray<PoseLandmark>>>
}>

export type ActorTrack = Readonly<{
  actorId: ActorId
  /** Optional track id if multi-track in future. */
  trackId?: string
  samples: ReadonlyArray<{
    tMs: number
    /** Normalized bbox in image coords (0..1). */
    bbox?: Readonly<{ x: number; y: number; w: number; h: number }>
    /** Approx center point (0..1) if bbox is unavailable. */
    center?: Vec2
    confidence?: number // 0..1
  }>
}>

/**
 * Layer 2: Geometry and measurement
 * (GeometricSnapshot is intended to be stable and explainable.)
 */
export type StanceSide = 'orthodox' | 'southpaw' | 'unknown'
export type GuardShape = 'high' | 'mid' | 'low' | 'unknown'
export type RangeBand = 'close' | 'mid' | 'long' | 'unknown'

export type GeometricSnapshot = Readonly<{
  tMs: number
  actorId: ActorId
  stanceSide: StanceSide
  stanceConfidence: Confidence
  stanceWidthBw?: number | null
  stanceAngleDeg?: number | null
  torsoAngleDeg?: number | null
  headLine?: Readonly<{ chin: Vec2; nose: Vec2 } | null>
  guard: Readonly<{
    shape: GuardShape
    handsHigh: boolean | null
    exposureScore?: number | null // 0..1, higher = more exposed
  }>
  base: Readonly<{
    compromised: boolean | null
    compromisedScoreBw?: number | null
    overextended: boolean | null
    overextensionScoreBw?: number | null
  }>
  evidence: ReadonlyArray<EvidenceRef>
}>

/**
 * Layer 2: Kinematic/measurement layer.
 * Values are in body-widths (Bw) when possible to normalize across camera zoom.
 */
export type KinematicSnapshot = Readonly<{
  tMs: number
  actorId?: ActorId
  videoTimeSec: number | null
  /** Per-actor measurements; keyed by ActorId */
  actors: Partial<
    Record<
      ActorId,
      Readonly<{
        torsoScalePx?: number
        handSpeedBwps?: number
        handBurstBwps?: number
        footSpeedBwps?: number
        hipSpeedBwps?: number
        powerIndex?: number
        bounceHz?: number | null
        cadenceCv?: number | null // coefficient of variation of step/beat timing
        recoveryMsP50?: number | null
      }>
    >
  >
  /** Pairwise measurements if both fighters present. */
  range?: Readonly<{
    distanceBw: number
    closingBwps: number
    band: RangeBand
  }>
  evidence: ReadonlyArray<EvidenceRef>
}>

/**
 * Layer 3: Symbolic compiler output
 */
export type FightEventKind =
  | 'stance'
  | 'guard'
  | 'range'
  | 'movement'
  | 'strike_placeholder'
  | 'jab'
  | 'cross'
  | 'lead_hook'
  | 'rear_hook'
  | 'lead_uppercut'
  | 'rear_uppercut'
  | 'teep'
  | 'lead_kick'
  | 'rear_kick'
  | 'defense_placeholder'
  | 'reset'
  | 'other'

export type FightEvent = Readonly<{
  id: string
  kind: FightEventKind
  actorId?: ActorId
  t: TimeRangeMs
  label: string
  confidence: Confidence
  evidence: ReadonlyArray<EvidenceRef>
  data?: Record<string, unknown>
}>

export type FightFaultKind =
  | 'compromised_base'
  | 'guard_low'
  | 'chin_exposed'
  | 'overextension'
  | 'square_in_pocket'
  | 'rhythm_flat'
  | 'other'

export type FightFault = Readonly<{
  id: string
  kind: FightFaultKind
  actorId?: ActorId
  t: TimeRangeMs
  severity: 'low' | 'medium' | 'high'
  confidence: Confidence
  evidence: ReadonlyArray<EvidenceRef>
  message: string
  data?: Record<string, unknown>
}>

export type FightPatternKind =
  | 'guard_drop_before_entry'
  | 'linear_retreat'
  | 'one_beat_entry'
  | 'predictable_reset'
  | 'circling'
  | 'ring_cutting'
  | 'other'

export type FightPattern = Readonly<{
  id: string
  kind: FightPatternKind
  actorId?: ActorId
  occurrences: ReadonlyArray<TimeRangeMs>
  confidence: Confidence
  evidence: ReadonlyArray<EvidenceRef>
  summary: string
}>

export type ActorState = Readonly<{
  tMs: number
  actorId: ActorId
  stanceSide: StanceSide
  guard: GuardShape
  rangeToOther?: RangeBand
  rhythm?: Readonly<{
    bounceHz?: number | null
    cadenceCv?: number | null
  }>
  evidence: ReadonlyArray<EvidenceRef>
}>

/**
 * Layer 4: Sequence/grammar
 * Minimal v1: time-bounded slices + token stream (extensible later).
 */
export type FightToken = Readonly<{
  id: string
  t: TimeRangeMs
  actorId?: ActorId
  kind: FightEventKind | FightFaultKind | FightPatternKind
  label: string
  confidence: Confidence
  evidence: ReadonlyArray<EvidenceRef>
}>

export type FightSequence = Readonly<{
  id: string
  t: TimeRangeMs
  tokens: ReadonlyArray<FightToken>
  evidence: ReadonlyArray<EvidenceRef>
}>

/**
 * Layer 5: Tactical/strategic layer outputs
 */
export type StyleArchetype =
  | 'pressure_boxer'
  | 'outfighter'
  | 'counter_puncher'
  | 'muay_thai_influenced'
  | 'kickboxer'
  | 'karate_point_fighting_influenced'
  | 'taekwondo_influenced'
  | 'mma_hybrid_striker'
  | 'unknown'

export type StrategyAssessment = Readonly<{
  actorId: ActorId
  archetype: StyleArchetype
  confidence: Confidence
  supportingEvidence: ReadonlyArray<EvidenceRef>
  features: Readonly<{
    stanceWidthBwP50?: number | null
    stanceAngleDegP50?: number | null
    guardHighRate?: number | null // 0..1
    rangePreference?: RangeBand | null
    bounceHzP50?: number | null
    cadenceCvP50?: number | null
    leadLegActivityRate?: number | null
    headMovementRate?: number | null
    entryDirectness?: 'linear' | 'angled' | 'mixed' | 'unknown'
    exitStyle?: 'reset_back' | 'angle_off' | 'shell' | 'unknown'
  }>
  ambiguityFlags: ReadonlyArray<string>
}>

/**
 * Layer 6: Explanation/coaching outputs (must be grounded/validated).
 */
export type CoachingCue = Readonly<{
  id: string
  actorId?: ActorId
  t?: TimeRangeMs
  quickCue: string // short reflex cue
  keyMistake?: string
  whyItMatters?: string
  whatToDoInstead?: string
  evidence: ReadonlyArray<EvidenceRef>
  confidence: Confidence
  expanded?: string
  audioScript?: string
}>

export type OverlayAnnotationType = 'arrow' | 'circle' | 'label' | 'moment' | 'zone'

export type OverlayAnchorPoint =
  | Readonly<{ kind: 'normalized_xy'; x: number; y: number }>
  | Readonly<{ kind: 'landmark'; actorId: ActorId; landmarkIndex: number }>
  | Readonly<{ kind: 'bbox_center'; actorId: ActorId }>

export type OverlayAnnotation = Readonly<{
  id: string
  actorId?: ActorId
  time: TimeRangeMs
  annotationType: OverlayAnnotationType
  anchorPoints: ReadonlyArray<OverlayAnchorPoint>
  message: string
  confidence: Confidence
  evidence: ReadonlyArray<EvidenceRef>
}>

/** The canonical fight ledger contract (v1) */
export type FightEvidenceLedger = Readonly<{
  contractVersion: typeof FIGHTLANG_CONTRACT_VERSION
  generatedAtMs: number
  clip?: Readonly<{
    durationMs?: number
    fps?: number
    sourceId?: string
  }>
  actors: ReadonlyArray<ActorId>
  poseFrames?: ReadonlyArray<PoseFrame>
  tracks?: ReadonlyArray<ActorTrack>
  geometry: ReadonlyArray<GeometricSnapshot>
  kinematics: ReadonlyArray<KinematicSnapshot>
  actorStateTimeline: ReadonlyArray<ActorState>
  events: ReadonlyArray<FightEvent>
  faults: ReadonlyArray<FightFault>
  patterns: ReadonlyArray<FightPattern>
  sequences: ReadonlyArray<FightSequence>
  evidenceIndex: ReadonlyArray<EvidenceRef>
  notes?: ReadonlyArray<string>
}>

