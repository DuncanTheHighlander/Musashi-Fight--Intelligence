import { magnitude, sub, type Vec3 } from '@/lib/geometry/vec3'
import type { Velocity } from '@/lib/fightlang/primitives'

export class KinematicParser {
  static calculateVelocityVec(prev: Vec3, curr: Vec3, timeDeltaSec: number): Velocity {
    if (timeDeltaSec <= 0) {
      return { velocityVec: { x: 0, y: 0, z: 0 }, speed: 0 }
    }
    const dv = sub(curr, prev)
    const v = { x: dv.x / timeDeltaSec, y: dv.y / timeDeltaSec, z: dv.z / timeDeltaSec }
    return { velocityVec: v, speed: magnitude(v) }
  }
}

