import type { Vec2, Vec3 } from '@/lib/fightlang/fightlang.types'

export function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

export function clamp01(n: number): number {
  return clamp(n, 0, 1)
}

export function vec2(x: number, y: number): Vec2 {
  return { x, y }
}

export function vec3(x: number, y: number, z?: number): Vec3 {
  return { x, y, z }
}

export function add2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub2(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function dot2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

export function mag2(v: Vec2): number {
  return Math.hypot(v.x, v.y)
}

export function dist2(a: Vec2, b: Vec2): number {
  return mag2(sub2(a, b))
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function mean(values: ReadonlyArray<number>): number | null {
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length === 0) return null
  return clean.reduce((s, v) => s + v, 0) / clean.length
}

export function median(values: ReadonlyArray<number>): number | null {
  const clean = values.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b)
  if (clean.length === 0) return null
  const mid = Math.floor(clean.length / 2)
  if (clean.length % 2 === 1) return clean[mid] ?? null
  const a = clean[mid - 1]
  const b = clean[mid]
  if (a == null || b == null) return null
  return (a + b) / 2
}

export function stdev(values: ReadonlyArray<number>): number | null {
  const m = mean(values)
  if (m == null) return null
  const clean = values.filter((v) => Number.isFinite(v))
  if (clean.length < 2) return 0
  const v =
    clean.reduce((s, x) => {
      const d = x - m
      return s + d * d
    }, 0) / (clean.length - 1)
  return Math.sqrt(Math.max(0, v))
}

export function coeffOfVariation(values: ReadonlyArray<number>): number | null {
  const m = mean(values)
  const sd = stdev(values)
  if (m == null || sd == null) return null
  if (Math.abs(m) < 1e-9) return null
  return Math.abs(sd / m)
}

