import type { MathState } from '@/lib/fightlang/primitives'

export enum ActionToken {
  JAB = 'JAB',
  CROSS = 'CROSS',
  TEEP = 'TEEP',
  ROUNDHOUSE = 'ROUNDHOUSE',
  SLIP = 'SLIP',
}

export enum FaultToken {
  CHIN_EXPOSED = 'CHIN_EXPOSED',
  COMPROMISED_BASE = 'COMPROMISED_BASE',
  SQUARE_IN_POCKET = 'SQUARE_IN_POCKET',
}

export enum StanceToken {
  SQUARE = 'SQUARE',
  NEUTRAL = 'NEUTRAL',
  BLADED = 'BLADED',
}

export type FrameRef = Readonly<{
  timestampMs: number
  videoTimeSec: number | null
  frameIndex?: number
  actorId: 'A' | 'B'
}>

export type Traceability = Readonly<{
  ruleId: string
  timestampMs: number
  actorId: 'A' | 'B'
  inputs: Record<string, number | boolean | string | null | undefined>
  thresholds: Record<string, number | string | null | undefined>
  passed: boolean
  confidence: number
}>

export type FrameEvidence = Readonly<{
  frame: FrameRef
  math: MathState
  emitted: {
    stance: StanceToken[]
    actions: ActionToken[]
    faults: FaultToken[]
  }
  trace: Traceability[]
}>

export type WindowEvidence = Readonly<{
  actorId: 'A' | 'B'
  startMs: number
  endMs: number
  frames: number
  summaryTokens: {
    stance: Partial<Record<StanceToken, number>>
    actions: Partial<Record<ActionToken, number>>
    faults: Partial<Record<FaultToken, number>>
  }
  trace: Traceability[]
}>

export type FightEvidenceLedger = Readonly<{
  meta: {
    generatedAtMs: number
    units: MathState['units']
    notes?: string[]
  }
  frames: FrameEvidence[]
  windows: WindowEvidence[]
}>

