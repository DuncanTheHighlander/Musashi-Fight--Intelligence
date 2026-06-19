import { FIGHTLANG_DEFAULTS } from '@/lib/fightlang/constants'
import type { MathState } from '@/lib/fightlang/primitives'
import { FaultToken, StanceToken, type FrameEvidence, type FrameRef, type Traceability } from '@/lib/fightlang/ontology'

export type ArbiterContext = Readonly<{
  videoTimeSec: number | null
  frameIndex?: number
}>

const stanceTokenFromBladedness = (b: MathState['bladedness']): StanceToken | null => {
  if (!b) return null
  if (b === 'SQUARE') return StanceToken.SQUARE
  if (b === 'BLADED') return StanceToken.BLADED
  return StanceToken.NEUTRAL
}

export class SymbolicArbiter {
  /**
   * Deterministic rule engine (math firewall).
   * Emits only what can be traced to explicit inputs + thresholds.
   */
  static parseFrame(math: MathState, ctx: ArbiterContext): FrameEvidence {
    const frame: FrameRef = {
      timestampMs: math.timestampMs,
      videoTimeSec: ctx.videoTimeSec,
      frameIndex: ctx.frameIndex,
      actorId: math.actorId,
    }

    const trace: Traceability[] = []
    const stance: StanceToken[] = []
    const faults: FaultToken[] = []

    // Rule STANCE_V1_HEURISTIC
    // MVP heuristic based on yaw proxies (see MathState.bladedness).
    const stanceTok = stanceTokenFromBladedness(math.bladedness)
    trace.push({
      ruleId: 'STANCE_V1_HEURISTIC',
      timestampMs: frame.timestampMs,
      actorId: frame.actorId,
      inputs: {
        shoulderYawDeg: math.shoulderYawDeg,
        footYawDeg: math.footYawDeg,
        hipYawDeg: math.hipYawDeg,
        bladedness: math.bladedness ?? null,
      },
      thresholds: {
        squareMaxDeg: FIGHTLANG_DEFAULTS.bladedness.squareMaxDeg,
        bladedMinDeg: FIGHTLANG_DEFAULTS.bladedness.bladedMinDeg,
      },
      passed: Boolean(stanceTok),
      confidence: stanceTok ? 0.6 : 0.0,
    })
    if (stanceTok) stance.push(stanceTok)

    // Rule COMPROMISED_BASE_V1_HEURISTIC
    const stanceWidthBw = math.stanceWidthBw
    const stanceWidthNorm = math.stanceWidth

    const narrowByBw =
      typeof stanceWidthBw === 'number' && Number.isFinite(stanceWidthBw)
        ? stanceWidthBw < FIGHTLANG_DEFAULTS.stanceWidthMinBw
        : null
    const narrowByNorm =
      narrowByBw === null && typeof stanceWidthNorm === 'number' && Number.isFinite(stanceWidthNorm)
        ? stanceWidthNorm < FIGHTLANG_DEFAULTS.stanceWidthMinNormalized
        : null

    const isNarrow = narrowByBw ?? narrowByNorm ?? false
    const outside = Boolean(math.comOutsideBase)
    const compromised = isNarrow && outside

    trace.push({
      ruleId: 'COMPROMISED_BASE_V1_HEURISTIC',
      timestampMs: frame.timestampMs,
      actorId: frame.actorId,
      inputs: {
        stanceWidthBw: stanceWidthBw ?? null,
        stanceWidth: stanceWidthNorm ?? null,
        isNarrow,
        comOutsideBase: math.comOutsideBase ?? null,
      },
      thresholds: {
        stanceWidthMinBw: FIGHTLANG_DEFAULTS.stanceWidthMinBw,
        stanceWidthMinNormalized: FIGHTLANG_DEFAULTS.stanceWidthMinNormalized,
      },
      passed: compromised,
      confidence: compromised ? 0.7 : 0.0,
    })
    if (compromised) faults.push(FaultToken.COMPROMISED_BASE)

    return {
      frame,
      math,
      emitted: {
        stance,
        actions: [],
        faults,
      },
      trace,
    }
  }
}

