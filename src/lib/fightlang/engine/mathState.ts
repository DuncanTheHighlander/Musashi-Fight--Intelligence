import { vec3, type Vec3 } from '@/lib/geometry/vec3'
import { FIGHTLANG_DEFAULTS } from '@/lib/fightlang/constants'
import type { MathState, PoseFrame, StanceBladedness } from '@/lib/fightlang/primitives'
import { GeometricParser } from '@/lib/fightlang/engine/geometry'
import { KinematicParser } from '@/lib/fightlang/engine/kinematics'

const classifyBladedness = (yawDeg: number | null): StanceBladedness | null => {
  if (yawDeg === null || !Number.isFinite(yawDeg)) return null
  const { squareMaxDeg, bladedMinDeg } = FIGHTLANG_DEFAULTS.bladedness
  if (yawDeg <= squareMaxDeg) return 'SQUARE'
  if (yawDeg >= bladedMinDeg) return 'BLADED'
  return 'NEUTRAL'
}

export type MathStateInputs = Readonly<{
  timestampMs: number
  actorId: 'A' | 'B'
  pose: PoseFrame
  otherComProxy?: Vec3 | null
  prevComProxy?: Vec3 | null
  timeDeltaSec?: number
  videoTimeSec?: number | null
}>

export function buildMathState(input: MathStateInputs): MathState {
  const { timestampMs, actorId, pose } = input

  const comProxy = GeometricParser.getComProxy(pose)

  const shoulderWidth = GeometricParser.getShoulderWidth(pose)
  const feet = GeometricParser.getSupportFeet(pose)
  const stanceWidth = feet ? GeometricParser.calculateStanceWidth(feet.left, feet.right) : undefined
  const stanceWidthBw =
    stanceWidth !== undefined && shoulderWidth && shoulderWidth > 1e-9 ? stanceWidth / shoulderWidth : undefined

  const shoulderYawDeg = (() => {
    const ls = pose.leftShoulder
    const rs = pose.rightShoulder
    if (!ls || !rs) return undefined
    return GeometricParser.calculateYawProxyDeg(ls, rs)
  })()
  const footYawDeg = (() => {
    const lf = pose.leftFootIndex ?? pose.leftAnkle
    const rf = pose.rightFootIndex ?? pose.rightAnkle
    if (!lf || !rf) return undefined
    return GeometricParser.calculateYawProxyDeg(lf, rf)
  })()
  const hipYawDeg = (() => {
    const lh = pose.leftHip
    const rh = pose.rightHip
    if (!lh || !rh) return undefined
    return GeometricParser.calculateYawProxyDeg(lh, rh)
  })()

  // MVP stance heuristic: combine proxies when present.
  const yawCandidates = [shoulderYawDeg, footYawDeg, hipYawDeg].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  )
  const yawAvg = yawCandidates.length ? yawCandidates.reduce((a, b) => a + b, 0) / yawCandidates.length : null
  const bladedness = classifyBladedness(yawAvg) ?? undefined

  const comOutsideBase =
    comProxy ? GeometricParser.isComOutsideBase(pose, comProxy) ?? undefined : undefined

  const comVelocity = (() => {
    const prev = input.prevComProxy
    const dt = input.timeDeltaSec
    if (!prev || !comProxy || !dt) return undefined
    return KinematicParser.calculateVelocityVec(prev, comProxy, dt)
  })()

  const distanceToOther =
    comProxy && input.otherComProxy ? GeometricParser.calculateDistance(comProxy, input.otherComProxy) : undefined

  return {
    units: {
      distance: 'normalized',
      angle: 'deg',
      speed: 'normalized_per_s',
      shoulderWidthRelative: shoulderWidth ? 'bw' : undefined,
    },
    timestampMs,
    actorId,
    distanceToOther,
    stanceWidth,
    stanceWidthBw,
    shoulderYawDeg,
    footYawDeg,
    hipYawDeg,
    bladedness,
    comProxy: comProxy ?? undefined,
    comVelocity,
    comOutsideBase,
  }
}

