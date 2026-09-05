/**
 * Lightweight 2D constant-velocity Kalman filter for fighter anchor tracking.
 *
 * State: [x, y, vx, vy] in normalized image coords (0..1) and per-ms velocity.
 * No external numeric libs — 4×4 algebraic updates only (~O(1) per slot/frame).
 */

export type Kalman2D = {
  x: number
  y: number
  vx: number
  vy: number
  /** 4×4 covariance, row-major flat (16). */
  P: number[]
}

/** Process noise (position / velocity). Tunable. */
export const KALMAN_Q_POS = 1e-5
export const KALMAN_Q_VEL = 2e-8
/** Measurement noise for observed anchor (x,y). */
export const KALMAN_R = 2.5e-4
/** Soft velocity clamp (normalized units per ms) — matches identityTracking VELOCITY_MAX. */
export const KALMAN_VEL_MAX = 0.005

function eye4(): number[] {
  const P = new Array(16).fill(0)
  for (let i = 0; i < 4; i++) P[i * 4 + i] = 1
  return P
}

function clampVel(vx: number, vy: number): { vx: number; vy: number } {
  return {
    vx: Math.max(-KALMAN_VEL_MAX, Math.min(KALMAN_VEL_MAX, vx)),
    vy: Math.max(-KALMAN_VEL_MAX, Math.min(KALMAN_VEL_MAX, vy)),
  }
}

export function createKalman2D(x: number, y: number, vx = 0, vy = 0): Kalman2D {
  const v = clampVel(vx, vy)
  // Large initial uncertainty so the first few measurements dominate.
  const P = eye4()
  P[0] = 0.05
  P[5] = 0.05
  P[10] = 1e-4
  P[15] = 1e-4
  return { x, y, vx: v.vx, vy: v.vy, P }
}

function mat4Mul(A: number[], B: number[]): number[] {
  const C = new Array(16).fill(0)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += A[i * 4 + k]! * B[k * 4 + j]!
      C[i * 4 + j] = s
    }
  }
  return C
}

function mat4Add(A: number[], B: number[]): number[] {
  return A.map((v, i) => v + B[i]!)
}

function mat4Transpose(A: number[]): number[] {
  const T = new Array(16)
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) T[j * 4 + i] = A[i * 4 + j]!
  }
  return T
}

/** Time update: predict state forward by dtMs. */
export function predictKalman(k: Kalman2D, dtMs: number): Kalman2D {
  const dt = Math.max(0, Math.min(dtMs, 2000))
  if (dt <= 0) return k

  // F = [[1,0,dt,0],[0,1,0,dt],[0,0,1,0],[0,0,0,1]]
  const F = [
    1, 0, dt, 0,
    0, 1, 0, dt,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]
  const x = k.x + k.vx * dt
  const y = k.y + k.vy * dt
  const v = clampVel(k.vx, k.vy)

  // Q diagonal process noise scaled by dt
  const Q = new Array(16).fill(0)
  Q[0] = KALMAN_Q_POS * dt
  Q[5] = KALMAN_Q_POS * dt
  Q[10] = KALMAN_Q_VEL * dt
  Q[15] = KALMAN_Q_VEL * dt

  const FP = mat4Mul(F, k.P)
  const P = mat4Add(mat4Mul(FP, mat4Transpose(F)), Q)

  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    vx: v.vx,
    vy: v.vy,
    P,
  }
}

/**
 * Measurement update from observed anchor (zx, zy).
 * Optional measured velocity (from EMA) gently pulls vx/vy when provided.
 */
export function updateKalman(
  k: Kalman2D,
  zx: number,
  zy: number,
  measuredVx?: number,
  measuredVy?: number
): Kalman2D {
  // H selects position: z = Hx + noise, H = [[1,0,0,0],[0,1,0,0]]
  // Innovation
  const y0 = zx - k.x
  const y1 = zy - k.y

  // S = H P H^T + R  (2×2)
  const p00 = k.P[0]!
  const p01 = k.P[1]!
  const p10 = k.P[4]!
  const p11 = k.P[5]!
  const s00 = p00 + KALMAN_R
  const s01 = p01
  const s10 = p10
  const s11 = p11 + KALMAN_R
  const det = s00 * s11 - s01 * s10
  if (Math.abs(det) < 1e-18) {
    // Ill-conditioned — snap to measurement, keep velocity.
    const v = clampVel(
      measuredVx ?? k.vx,
      measuredVy ?? k.vy
    )
    return { ...k, x: zx, y: zy, vx: v.vx, vy: v.vy }
  }
  const inv00 = s11 / det
  const inv01 = -s01 / det
  const inv10 = -s10 / det
  const inv11 = s00 / det

  // K = P H^T S^{-1}  (4×2). H^T columns are e0, e1 of R^4.
  // K_i0 = sum_j P[i,j] * (H^T S^{-1})[j,0] = P[i,0]*inv00 + P[i,1]*inv10
  // K_i1 = P[i,0]*inv01 + P[i,1]*inv11
  const K = new Array(8) // 4×2 row-major
  for (let i = 0; i < 4; i++) {
    const pi0 = k.P[i * 4 + 0]!
    const pi1 = k.P[i * 4 + 1]!
    K[i * 2 + 0] = pi0 * inv00 + pi1 * inv10
    K[i * 2 + 1] = pi0 * inv01 + pi1 * inv11
  }

  const x = k.x + K[0]! * y0 + K[1]! * y1
  const y = k.y + K[2]! * y0 + K[3]! * y1
  let vx = k.vx + K[4]! * y0 + K[5]! * y1
  let vy = k.vy + K[6]! * y0 + K[7]! * y1

  // Soft-blend optional measured velocity (EMA from landmarks).
  if (typeof measuredVx === 'number' && typeof measuredVy === 'number') {
    vx = vx * 0.7 + measuredVx * 0.3
    vy = vy * 0.7 + measuredVy * 0.3
  }
  const v = clampVel(vx, vy)

  // P = (I - K H) P
  // KH is 4×4 with only first two columns of K affecting rows (H picks x,y).
  const IKH = eye4()
  for (let i = 0; i < 4; i++) {
    IKH[i * 4 + 0] = (i === 0 ? 1 : 0) - K[i * 2 + 0]!
    IKH[i * 4 + 1] = (i === 1 ? 1 : 0) - K[i * 2 + 1]!
  }
  const P = mat4Mul(IKH, k.P)

  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
    vx: v.vx,
    vy: v.vy,
    P,
  }
}
