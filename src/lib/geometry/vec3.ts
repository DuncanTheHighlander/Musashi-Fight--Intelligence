export type Vec3 = Readonly<{ x: number; y: number; z: number }>

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z }
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

export function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s }
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

export function magnitude(v: Vec3): number {
  return Math.sqrt(dot(v, v))
}

export function distance(a: Vec3, b: Vec3): number {
  return magnitude(sub(a, b))
}

export function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

export function angleDegOnPlane(a: Vec3, b: Vec3, plane: 'xy' | 'xz' | 'yz'): number {
  const ax = plane === 'yz' ? a.y : a.x
  const ay = plane === 'xy' ? a.y : a.z
  const bx = plane === 'yz' ? b.y : b.x
  const by = plane === 'xy' ? b.y : b.z
  const ang = Math.atan2(by - ay, bx - ax) * (180 / Math.PI)
  return Math.abs(ang)
}

