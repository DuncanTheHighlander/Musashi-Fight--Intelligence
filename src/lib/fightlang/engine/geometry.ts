import { clamp01, distance as dist3, dot, magnitude, scale, sub, vec3, type Vec3 } from '@/lib/geometry/vec3'
import type { Joint3D, PoseFrame, PoseJointName } from '@/lib/fightlang/primitives'

const get = (pose: PoseFrame, name: PoseJointName): Joint3D | undefined => pose[name]

export class GeometricParser {
  static jointToVec3(j: Joint3D): Vec3 {
    return vec3(j.x, j.y, j.z)
  }

  static calculateDistance(a: Vec3, b: Vec3): number {
    return dist3(a, b)
  }

  static calculateStanceWidth(leftFoot: Joint3D, rightFoot: Joint3D): number {
    return dist3(this.jointToVec3(leftFoot), this.jointToVec3(rightFoot))
  }

  /**
   * Yaw proxy derived from a line segment in x–z plane, in degrees.
   * This is NOT "true torso angle to opponent"; it's a camera-relative proxy.
   */
  static calculateYawProxyDeg(left: Joint3D, right: Joint3D): number {
    const a = this.jointToVec3(left)
    const b = this.jointToVec3(right)
    const dx = b.x - a.x
    const dz = b.z - a.z
    return Math.abs(Math.atan2(dz, dx) * (180 / Math.PI))
  }

  /**
   * Approximate COM proxy using a weighted average of available core joints.
   * MVP: shoulders + hips (0.25 each) when present; falls back gracefully.
   */
  static getComProxy(pose: PoseFrame): Vec3 | null {
    const ls = get(pose, 'leftShoulder')
    const rs = get(pose, 'rightShoulder')
    const lh = get(pose, 'leftHip')
    const rh = get(pose, 'rightHip')

    const joints: Array<{ j: Joint3D; w: number }> = []
    if (ls) joints.push({ j: ls, w: 0.25 })
    if (rs) joints.push({ j: rs, w: 0.25 })
    if (lh) joints.push({ j: lh, w: 0.25 })
    if (rh) joints.push({ j: rh, w: 0.25 })

    if (joints.length === 0) return null
    const wSum = joints.reduce((acc, it) => acc + it.w, 0)
    if (wSum <= 0) return null

    let x = 0
    let y = 0
    let z = 0
    for (const { j, w } of joints) {
      x += j.x * w
      y += j.y * w
      z += j.z * w
    }
    return vec3(x / wSum, y / wSum, z / wSum)
  }

  static getShoulderWidth(pose: PoseFrame): number | null {
    const ls = get(pose, 'leftShoulder')
    const rs = get(pose, 'rightShoulder')
    if (!ls || !rs) return null
    return dist3(this.jointToVec3(ls), this.jointToVec3(rs))
  }

  static getSupportFeet(pose: PoseFrame): { left: Joint3D; right: Joint3D } | null {
    const lf = get(pose, 'leftFootIndex') ?? get(pose, 'leftAnkle')
    const rf = get(pose, 'rightFootIndex') ?? get(pose, 'rightAnkle')
    if (!lf || !rf) return null
    return { left: lf, right: rf }
  }

  /**
   * Heuristic: project COM proxy onto the line segment between feet (in x–z),
   * then check if the projection falls outside [0,1].
   */
  static isComOutsideBase(pose: PoseFrame, comProxy: Vec3): boolean | null {
    const feet = this.getSupportFeet(pose)
    if (!feet) return null
    const a = this.jointToVec3(feet.left)
    const b = this.jointToVec3(feet.right)

    // Work in x–z plane
    const ab = vec3(b.x - a.x, 0, b.z - a.z)
    const ap = vec3(comProxy.x - a.x, 0, comProxy.z - a.z)
    const denom = dot(ab, ab)
    if (denom <= 1e-12) return null
    const t = dot(ap, ab) / denom
    return t < 0 || t > 1
  }
}

