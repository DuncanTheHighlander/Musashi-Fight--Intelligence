import type { Vec3 } from '@/lib/geometry/vec3'

export type Joint3D = Readonly<{
  x: number
  y: number
  z: number
  visibility: number
}>

export type PoseJointName =
  | 'nose'
  | 'leftShoulder'
  | 'rightShoulder'
  | 'leftHip'
  | 'rightHip'
  | 'leftAnkle'
  | 'rightAnkle'
  | 'leftFootIndex'
  | 'rightFootIndex'

export type PoseFrame = Partial<Record<PoseJointName, Joint3D>>

export type Velocity = Readonly<{
  velocityVec: Vec3
  speed: number
}>

export type StanceBladedness = 'SQUARE' | 'NEUTRAL' | 'BLADED'

export type MathUnits = Readonly<{
  /** Distances in MediaPipe normalized coordinates unless otherwise stated. */
  distance: 'normalized'
  /** Angles in degrees. */
  angle: 'deg'
  /** Speeds in normalized-units per second. */
  speed: 'normalized_per_s'
  /** Optional derived unit: normalized distance divided by shoulder width. */
  shoulderWidthRelative?: 'bw'
}>

export type MathState = Readonly<{
  units: MathUnits
  timestampMs: number
  actorId: 'A' | 'B'

  /** Euclidean distance between A and B COM proxies, normalized units. */
  distanceToOther?: number

  /** Stance width proxy, normalized units. */
  stanceWidth?: number
  /** Stance width divided by shoulder width (body-widths), if computable. */
  stanceWidthBw?: number

  /** Shoulder-line yaw proxy (uses x–z plane). */
  shoulderYawDeg?: number
  /** Foot-line yaw proxy (uses x–z plane). */
  footYawDeg?: number
  /** Optional hip-line yaw proxy (uses x–z plane). */
  hipYawDeg?: number

  /** MVP heuristic stance classification derived from yaw proxies. */
  bladedness?: StanceBladedness

  /** Approximate COM proxy based on pose landmarks. */
  comProxy?: Vec3
  /** COM proxy velocity (vector + scalar). */
  comVelocity?: Velocity

  /** Heuristic: COM proxy projected outside support interval. */
  comOutsideBase?: boolean
}>

