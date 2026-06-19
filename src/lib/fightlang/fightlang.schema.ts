import { z } from 'zod'
import { FIGHTLANG_CONTRACT_VERSION } from './fightlang.types'

const ActorIdSchema = z.enum(['A', 'B'])
const ConfidenceSchema = z.object({
  score: z.number().min(0).max(1),
  basis: z.enum(['heuristic', 'model', 'user', 'mixed']).optional(),
})

const TimeRangeMsSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
})

const EvidenceSourceSchema = z.enum(['pose', 'track', 'geometry', 'kinematics', 'compiler', 'user', 'llm'])

export const EvidenceRefSchema = z.object({
  id: z.string().min(1),
  source: EvidenceSourceSchema,
  actorId: ActorIdSchema.optional(),
  t: TimeRangeMsSchema,
  note: z.string().optional(),
  pointer: z.string().optional(),
})

export const PoseLandmarkSchema = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number().optional(),
  visibility: z.number().optional(),
})

export const PoseFrameSchema = z.object({
  tMs: z.number().int().nonnegative(),
  videoTimeSec: z.number().nonnegative().nullable(),
  actors: z.object({ A: z.array(PoseLandmarkSchema).optional(), B: z.array(PoseLandmarkSchema).optional() }),
})

export const ActorTrackSchema = z.object({
  actorId: ActorIdSchema,
  trackId: z.string().optional(),
  samples: z.array(
    z.object({
      tMs: z.number().int().nonnegative(),
      bbox: z
        .object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
        .optional(),
      center: z.object({ x: z.number(), y: z.number() }).optional(),
      confidence: z.number().min(0).max(1).optional(),
    })
  ),
})

export const GeometricSnapshotSchema = z.object({
  tMs: z.number().int().nonnegative(),
  actorId: ActorIdSchema,
  stanceSide: z.enum(['orthodox', 'southpaw', 'unknown']),
  stanceConfidence: ConfidenceSchema,
  stanceWidthBw: z.number().nullable().optional(),
  stanceAngleDeg: z.number().nullable().optional(),
  torsoAngleDeg: z.number().nullable().optional(),
  headLine: z
    .object({
      chin: z.object({ x: z.number(), y: z.number() }),
      nose: z.object({ x: z.number(), y: z.number() }),
    })
    .nullable()
    .optional(),
  guard: z.object({
    shape: z.enum(['high', 'mid', 'low', 'unknown']),
    handsHigh: z.boolean().nullable(),
    exposureScore: z.number().min(0).max(1).nullable().optional(),
  }),
  base: z.object({
    compromised: z.boolean().nullable(),
    compromisedScoreBw: z.number().nullable().optional(),
    overextended: z.boolean().nullable(),
    overextensionScoreBw: z.number().nullable().optional(),
  }),
  evidence: z.array(EvidenceRefSchema),
})

export const KinematicSnapshotSchema = z.object({
  tMs: z.number().int().nonnegative(),
  actorId: ActorIdSchema.optional(),
  videoTimeSec: z.number().nonnegative().nullable(),
  actors: z.object({
    A: z
      .object({
        torsoScalePx: z.number().optional(),
        handSpeedBwps: z.number().optional(),
        handBurstBwps: z.number().optional(),
        footSpeedBwps: z.number().optional(),
        hipSpeedBwps: z.number().optional(),
        powerIndex: z.number().optional(),
        bounceHz: z.number().nullable().optional(),
        cadenceCv: z.number().nullable().optional(),
        recoveryMsP50: z.number().nullable().optional(),
      })
      .optional(),
    B: z
      .object({
        torsoScalePx: z.number().optional(),
        handSpeedBwps: z.number().optional(),
        handBurstBwps: z.number().optional(),
        footSpeedBwps: z.number().optional(),
        hipSpeedBwps: z.number().optional(),
        powerIndex: z.number().optional(),
        bounceHz: z.number().nullable().optional(),
        cadenceCv: z.number().nullable().optional(),
        recoveryMsP50: z.number().nullable().optional(),
      })
      .optional(),
  }),
  range: z
    .object({
      distanceBw: z.number(),
      closingBwps: z.number(),
      band: z.enum(['close', 'mid', 'long', 'unknown']),
    })
    .optional(),
  evidence: z.array(EvidenceRefSchema),
})

export const FightEventSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'stance',
    'guard',
    'range',
    'movement',
    'strike_placeholder',
    'defense_placeholder',
    'reset',
    'other',
  ]),
  actorId: ActorIdSchema.optional(),
  t: TimeRangeMsSchema,
  label: z.string().min(1),
  confidence: ConfidenceSchema,
  evidence: z.array(EvidenceRefSchema),
  data: z.record(z.unknown()).optional(),
})

export const FightFaultSchema = z.object({
  id: z.string().min(1),
  kind: z.enum([
    'compromised_base',
    'guard_low',
    'chin_exposed',
    'overextension',
    'square_in_pocket',
    'rhythm_flat',
    'other',
  ]),
  actorId: ActorIdSchema.optional(),
  t: TimeRangeMsSchema,
  severity: z.enum(['low', 'medium', 'high']),
  confidence: ConfidenceSchema,
  evidence: z.array(EvidenceRefSchema),
  message: z.string().min(1),
  data: z.record(z.unknown()).optional(),
})

export const FightPatternSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['guard_drop_before_entry', 'linear_retreat', 'one_beat_entry', 'predictable_reset', 'circling', 'ring_cutting', 'other']),
  actorId: ActorIdSchema.optional(),
  occurrences: z.array(TimeRangeMsSchema),
  confidence: ConfidenceSchema,
  evidence: z.array(EvidenceRefSchema),
  summary: z.string().min(1),
})

export const ActorStateSchema = z.object({
  tMs: z.number().int().nonnegative(),
  actorId: ActorIdSchema,
  stanceSide: z.enum(['orthodox', 'southpaw', 'unknown']),
  guard: z.enum(['high', 'mid', 'low', 'unknown']),
  rangeToOther: z.enum(['close', 'mid', 'long', 'unknown']).optional(),
  rhythm: z.object({ bounceHz: z.number().nullable().optional(), cadenceCv: z.number().nullable().optional() }).optional(),
  evidence: z.array(EvidenceRefSchema),
})

export const FightTokenSchema = z.object({
  id: z.string().min(1),
  t: TimeRangeMsSchema,
  actorId: ActorIdSchema.optional(),
  kind: z.string().min(1),
  label: z.string().min(1),
  confidence: ConfidenceSchema,
  evidence: z.array(EvidenceRefSchema),
})

export const FightSequenceSchema = z.object({
  id: z.string().min(1),
  t: TimeRangeMsSchema,
  tokens: z.array(FightTokenSchema),
  evidence: z.array(EvidenceRefSchema),
})

export const StrategyAssessmentSchema = z.object({
  actorId: ActorIdSchema,
  archetype: z.enum([
    'pressure_boxer',
    'outfighter',
    'counter_puncher',
    'muay_thai_influenced',
    'kickboxer',
    'karate_point_fighting_influenced',
    'taekwondo_influenced',
    'mma_hybrid_striker',
    'unknown',
  ]),
  confidence: ConfidenceSchema,
  supportingEvidence: z.array(EvidenceRefSchema),
  features: z.object({
    stanceWidthBwP50: z.number().nullable().optional(),
    stanceAngleDegP50: z.number().nullable().optional(),
    guardHighRate: z.number().nullable().optional(),
    rangePreference: z.enum(['close', 'mid', 'long', 'unknown']).nullable().optional(),
    bounceHzP50: z.number().nullable().optional(),
    cadenceCvP50: z.number().nullable().optional(),
    leadLegActivityRate: z.number().nullable().optional(),
    headMovementRate: z.number().nullable().optional(),
    entryDirectness: z.enum(['linear', 'angled', 'mixed', 'unknown']).optional(),
    exitStyle: z.enum(['reset_back', 'angle_off', 'shell', 'unknown']).optional(),
  }),
  ambiguityFlags: z.array(z.string()),
})

export const CoachingCueSchema = z.object({
  id: z.string().min(1),
  actorId: ActorIdSchema.optional(),
  t: TimeRangeMsSchema.optional(),
  quickCue: z.string().min(1),
  keyMistake: z.string().optional(),
  whyItMatters: z.string().optional(),
  whatToDoInstead: z.string().optional(),
  evidence: z.array(EvidenceRefSchema),
  confidence: ConfidenceSchema,
  expanded: z.string().optional(),
  audioScript: z.string().optional(),
})

export const OverlayAnnotationSchema = z.object({
  id: z.string().min(1),
  actorId: ActorIdSchema.optional(),
  time: TimeRangeMsSchema,
  annotationType: z.enum(['arrow', 'circle', 'label', 'moment', 'zone']),
  anchorPoints: z.array(
    z.union([
      z.object({ kind: z.literal('normalized_xy'), x: z.number(), y: z.number() }),
      z.object({ kind: z.literal('landmark'), actorId: ActorIdSchema, landmarkIndex: z.number().int().nonnegative() }),
      z.object({ kind: z.literal('bbox_center'), actorId: ActorIdSchema }),
    ])
  ),
  message: z.string().min(1),
  confidence: ConfidenceSchema,
  evidence: z.array(EvidenceRefSchema),
})

export const FightEvidenceLedgerSchemaV1 = z.object({
  contractVersion: z.literal(FIGHTLANG_CONTRACT_VERSION),
  generatedAtMs: z.number().int().nonnegative(),
  clip: z
    .object({
      durationMs: z.number().int().nonnegative().optional(),
      fps: z.number().positive().optional(),
      sourceId: z.string().optional(),
    })
    .optional(),
  actors: z.array(ActorIdSchema),
  poseFrames: z.array(PoseFrameSchema).optional(),
  tracks: z.array(ActorTrackSchema).optional(),
  geometry: z.array(GeometricSnapshotSchema),
  kinematics: z.array(KinematicSnapshotSchema),
  actorStateTimeline: z.array(ActorStateSchema),
  events: z.array(FightEventSchema),
  faults: z.array(FightFaultSchema),
  patterns: z.array(FightPatternSchema),
  sequences: z.array(FightSequenceSchema),
  evidenceIndex: z.array(EvidenceRefSchema),
  notes: z.array(z.string()).optional(),
})

export type FightEvidenceLedgerV1 = z.infer<typeof FightEvidenceLedgerSchemaV1>

