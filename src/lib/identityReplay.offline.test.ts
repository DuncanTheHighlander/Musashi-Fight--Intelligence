/**
 * Offline identity-tracking replay harness.
 *
 * Replays pre-extracted per-frame pose candidates (JSON, produced by an
 * offline detector run over a test clip) through the EXACT identity pipeline
 * used by FightAnalyzer.assignCornerIdentities + processPoseFrame:
 *   dedupe → bipartite assignment → crossing lock → phase machine →
 *   hold/keep → velocity nudge → adaptive smoothing.
 *
 * Excluded (browser-only): HSV-histogram appearance reconciliation and
 * pre-scan hints. The two-region ColorProfile path IS replayed.
 *
 * Run:
 *   REPLAY_CANDS=/path/a.json,/path/b.json REPLAY_OUT=/path/out.json \
 *     npx vitest run src/lib/identityReplay.offline.test.ts
 */
import { describe, it } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import {
  advanceCrossingPhase,
  assignFighterTracks,
  clampVelocity,
  crossingHoldMs,
  crossingSmoothAlpha,
  dedupePoseCandidates,
  isCrossingPhase,
  updateIdentitySlotColor,
  type CrossingPhase,
  type IdentitySlot,
  type PoseAnchor,
} from '@/lib/identityTracking'
import { blendColorProfile, colorProfileDist, type ColorProfile } from '@/lib/appearance'
import { smoothLandmarks } from '@/lib/kinematics'

// ── Constants copied from FightAnalyzer.tsx (keep in sync) ──────────────────
const IDENTITY_SCALE_WEIGHT = 0.16
const IDENTITY_POSE_WEIGHT = 0.18
const IDENTITY_VELOCITY_ALPHA = 0.28
const IDENTITY_COLOR_SMOOTHING = 0.15
const IDENTITY_OCCLUSION_HOLD_MS = 1800
const IDENTITY_PROFILE_COLOR_WEIGHT = 0.82
const IDENTITY_PROFILE_SCALE_WEIGHT = 0.10
const IDENTITY_PROFILE_CLEAR_MARGIN = 0.065

const TRACKING_POINTS: Array<[number, number]> = [
  [11, 1.2], [12, 1.2], [23, 1.2], [24, 1.2],
  [0, 0.45], [13, 0.55], [14, 0.55], [15, 0.4], [16, 0.4],
  [25, 0.75], [26, 0.75], [27, 0.65], [28, 0.65],
]

type FighterKey = 'A' | 'B'
type CornerCandidate = {
  pose: NormalizedLandmark[]
  anchor: PoseAnchor
  color: ColorProfile | null
  scale: number
}
type SlotWithConf = IdentitySlot & { confidence: number }

function getPoseAnchor(landmarks: NormalizedLandmark[]): PoseAnchor | null {
  const pts = [landmarks[11], landmarks[12], landmarks[23], landmarks[24]].filter(
    Boolean
  ) as NormalizedLandmark[]
  if (pts.length < 2) return null
  let x = 0, y = 0, w = 0
  for (const lm of pts) {
    const weight = Math.max(0.25, lm.visibility ?? 1)
    x += lm.x * weight
    y += lm.y * weight
    w += weight
  }
  return w > 0 ? { x: x / w, y: y / w } : null
}

function getPoseScale(landmarks: NormalizedLandmark[]): number {
  const [ls, rs, lh, rh] = [landmarks[11], landmarks[12], landmarks[23], landmarks[24]]
  if (!ls || !rs || !lh || !rh) return 0.18
  const shoulderW = Math.hypot(ls.x - rs.x, ls.y - rs.y)
  const hipW = Math.hypot(lh.x - rh.x, lh.y - rh.y)
  const torsoH =
    (Math.hypot(ls.x - lh.x, ls.y - lh.y) + Math.hypot(rs.x - rh.x, rs.y - rh.y)) / 2
  return Math.max(0.08, shoulderW, hipW, torsoH)
}

function poseShapeDistance(a: NormalizedLandmark[], b: NormalizedLandmark[]): number {
  if (a.length !== b.length) return 0.5
  let total = 0, weight = 0
  for (const [idx, baseWeight] of TRACKING_POINTS) {
    const la = a[idx], lb = b[idx]
    if (!la || !lb) continue
    const vis = Math.min(la.visibility ?? 1, lb.visibility ?? 1)
    if (vis < 0.08) continue
    const w = baseWeight * Math.max(0.35, vis)
    total += Math.hypot(la.x - lb.x, la.y - lb.y) * w
    weight += w
  }
  return weight > 0 ? total / weight : 0.5
}

function mixProfileColor(
  previous: ColorProfile | null,
  next: ColorProfile | null,
  samples: number
): ColorProfile | null {
  if (!next) return previous
  if (!previous || samples <= 0) return next
  const a = Math.max(0.035, Math.min(0.16, 1 / (samples + 2)))
  return blendColorProfile(previous, next, a)
}

// ── Replay state (mirrors FightAnalyzer refs) ───────────────────────────────
const slots: { A: SlotWithConf | null; B: SlotWithConf | null } = { A: null, B: null }
const profiles: Record<FighterKey, { color: ColorProfile | null; scale: number | null; samples: number }> = {
  A: { color: null, scale: null, samples: 0 },
  B: { color: null, scale: null, samples: 0 },
}
let crossingPhase: CrossingPhase = 'tracking'
let recoveryStable = 0
let lockKey: FighterKey | null = null
let occlusionUntil = 0
const lastSeen: Record<FighterKey, number | null> = { A: null, B: null }
const lastRaw: Record<FighterKey, NormalizedLandmark[] | null> = { A: null, B: null }
const prevRaw: Record<FighterKey, NormalizedLandmark[] | null> = { A: null, B: null }
const smoothed: Record<FighterKey, NormalizedLandmark[] | null> = { A: null, B: null }
const velocity: Record<FighterKey, { vx: number; vy: number }> = {
  A: { vx: 0, vy: 0 },
  B: { vx: 0, vy: 0 },
}

function getTorsoVelocity(curr: NormalizedLandmark[], prev: NormalizedLandmark[]) {
  const a = getPoseAnchor(curr)
  const b = getPoseAnchor(prev)
  if (!a || !b) return { vx: 0, vy: 0 }
  return { vx: a.x - b.x, vy: a.y - b.y }
}

function assignCornerIdentities(
  candidates: CornerCandidate[],
  posesLength: number,
  wallNow: number
): { A: NormalizedLandmark[] | null; B: NormalizedLandmark[] | null; assignedA?: CornerCandidate; assignedB?: CornerCandidate } {
  const phaseIn = crossingPhase

  if (candidates.length === 0) {
    if (wallNow < occlusionUntil || isCrossingPhase(phaseIn)) {
      return { A: slots.A?.pose ?? null, B: slots.B?.pose ?? null }
    }
    return { A: null, B: null }
  }

  const profileCost = (candidate: CornerCandidate, key: FighterKey): number => {
    const profile = profiles[key]
    if (!profile.color || !candidate.color || profile.samples < 2) return Infinity
    const color = colorProfileDist(candidate.color, profile.color)
    const scale =
      profile.scale && profile.scale > 0
        ? Math.abs(Math.log(Math.max(0.05, candidate.scale) / Math.max(0.05, profile.scale)))
        : 0.18
    return color * IDENTITY_PROFILE_COLOR_WEIGHT + Math.min(0.45, scale) * IDENTITY_PROFILE_SCALE_WEIGHT
  }

  const updateProfile = (key: FighterKey, candidate: CornerCandidate | undefined, clearFrame: boolean) => {
    if (!candidate?.color || !clearFrame) return
    const profile = profiles[key]
    profiles[key] = {
      color: mixProfileColor(profile.color, candidate.color, profile.samples),
      scale: profile.scale == null ? candidate.scale : profile.scale * 0.94 + candidate.scale * 0.06,
      samples: Math.min(80, profile.samples + 1),
    }
  }

  const updateSlot = (
    key: FighterKey,
    candidate: CornerCandidate | undefined,
    learnAppearance: boolean,
    phase: CrossingPhase
  ) => {
    if (!candidate) return
    const prev = slots[key]
    let vel = { vx: 0, vy: 0 }
    if (prev) {
      const dt = Math.max(1, wallNow - prev.wallMs)
      const raw = clampVelocity(
        (candidate.anchor.x - prev.anchor.x) / dt,
        (candidate.anchor.y - prev.anchor.y) / dt
      )
      vel = {
        vx: prev.velocity.vx * (1 - IDENTITY_VELOCITY_ALPHA) + raw.vx * IDENTITY_VELOCITY_ALPHA,
        vy: prev.velocity.vy * (1 - IDENTITY_VELOCITY_ALPHA) + raw.vy * IDENTITY_VELOCITY_ALPHA,
      }
    }
    const color =
      learnAppearance || phase === 'tracking'
        ? updateIdentitySlotColor(prev, candidate, phase, IDENTITY_COLOR_SMOOTHING)
        : prev?.color ?? candidate.color
    slots[key] = {
      pose: candidate.pose,
      anchor: candidate.anchor,
      color,
      anchorColor: prev?.anchorColor ?? null,
      scale: learnAppearance && prev ? prev.scale * 0.84 + candidate.scale * 0.16 : prev?.scale ?? candidate.scale,
      velocity: vel,
      wallMs: wallNow,
      confidence: Math.min(1, (prev?.confidence ?? 0.6) + 0.08),
    }
    updateProfile(key, candidate, learnAppearance && phase === 'tracking')
  }

  let { A: assignA, B: assignB } = assignFighterTracks(
    candidates,
    slots.A,
    slots.B,
    wallNow,
    phaseIn,
    (candidate, slot) => ({
      poseShape: poseShapeDistance(candidate.pose, slot.pose),
      scaleWeight: IDENTITY_SCALE_WEIGHT,
      poseWeight: IDENTITY_POSE_WEIGHT,
    })
  )

  if (candidates.length === 1 && slots.A && slots.B && isCrossingPhase(phaseIn)) {
    occlusionUntil = wallNow + IDENTITY_OCCLUSION_HOLD_MS
    const profileA = profileCost(candidates[0], 'A')
    const profileB = profileCost(candidates[0], 'B')
    const profileClear =
      Number.isFinite(profileA) &&
      Number.isFinite(profileB) &&
      Math.abs(profileA - profileB) > IDENTITY_PROFILE_CLEAR_MARGIN * 1.5
    let lk: FighterKey
    if (profileClear) {
      lk = profileA < profileB ? 'A' : 'B'
    } else if (lockKey) {
      lk = lockKey
    } else {
      lk = assignA ? 'A' : 'B'
    }
    lockKey = lk
    assignA = lk === 'A' ? candidates[0] : undefined
    assignB = lk === 'B' ? candidates[0] : undefined
  } else if (candidates.length >= 2) {
    lockKey = null
  }

  const learnAppearance = phaseIn === 'tracking' && candidates.length >= 2
  updateSlot('A', assignA, learnAppearance, phaseIn)
  updateSlot('B', assignB, learnAppearance, phaseIn)

  const phaseResult = advanceCrossingPhase(
    phaseIn, slots.A, slots.B, posesLength, wallNow, recoveryStable
  )
  crossingPhase = phaseResult.phase
  recoveryStable = phaseResult.stableFrames
  if (phaseResult.phase === 'tracking') lockKey = null

  // Return only REAL assignments — mirrors the FightAnalyzer ghost fix.
  // Held poses are handled by the caller's hold window (keepA/keepB), not here.
  return {
    A: assignA?.pose ?? null,
    B: assignB?.pose ?? null,
    assignedA: assignA,
    assignedB: assignB,
  }
}

describe('identity replay', () => {
  it('replays candidate JSON through the live identity pipeline', () => {
    const candFiles = (process.env.REPLAY_CANDS ?? '').split(',').filter(Boolean)
    const outFile = process.env.REPLAY_OUT
    if (candFiles.length === 0 || !outFile) {
      console.log('REPLAY_CANDS / REPLAY_OUT not set — skipping replay')
      return
    }

    type InFrame = {
      f: number
      tMs: number
      candidates: Array<{
        pose: NormalizedLandmark[]
        anchor: PoseAnchor
        scale: number
        color: { torso: { r: number; g: number; b: number }; upper: unknown; lower: { r: number; g: number; b: number } | null } | null
      }>
    }
    const frames: InFrame[] = candFiles.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')))
    frames.sort((a, b) => a.f - b.f)

    const out: unknown[] = []
    for (const frame of frames) {
      const wallNow = frame.tMs
      const allPoses = frame.candidates.map((c) => c.pose)
      const deduped = dedupePoseCandidates(allPoses)
      const candidates: CornerCandidate[] = deduped
        .map((pose) => {
          const src = frame.candidates[allPoses.indexOf(pose)]
          const anchor = getPoseAnchor(pose)
          if (!anchor) return null
          const color: ColorProfile | null = src?.color
            ? { torso: src.color.torso, legs: src.color.lower ?? null }
            : null
          return { pose, anchor, color, scale: getPoseScale(pose) }
        })
        .filter((c): c is CornerCandidate => !!c)

      let { A: rawA, B: rawB } = assignCornerIdentities(candidates, deduped.length, wallNow)

      const holdMs = crossingHoldMs(crossingPhase, deduped.length)
      const reAcquiredA = rawA && (lastSeen.A === null || wallNow - lastSeen.A > holdMs)
      const reAcquiredB = rawB && (lastSeen.B === null || wallNow - lastSeen.B > holdMs)
      if (reAcquiredA) { lastRaw.A = null; prevRaw.A = null; smoothed.A = null }
      if (reAcquiredB) { lastRaw.B = null; prevRaw.B = null; smoothed.B = null }

      if (rawA) lastSeen.A = wallNow
      if (rawB) lastSeen.B = wallNow
      const keepA = !rawA && lastSeen.A !== null && wallNow - lastSeen.A < holdMs
      const keepB = !rawB && lastSeen.B !== null && wallNow - lastSeen.B < holdMs

      for (const key of ['A', 'B'] as const) {
        const raw = key === 'A' ? rawA : rawB
        const keep = key === 'A' ? keepA : keepB
        if (keep && !raw && smoothed[key]) {
          const vel = velocity[key]
          const elapsed = wallNow - (lastSeen[key] ?? wallNow)
          const decay = Math.max(0, 1 - Math.max(0, elapsed - 200) / (holdMs - 200))
          if (Math.hypot(vel.vx, vel.vy) > 0.002 && decay > 0) {
            smoothed[key] = smoothed[key]!.map((lm) => ({
              ...lm,
              x: Math.max(0, Math.min(1, lm.x + vel.vx * decay * 0.5)),
              y: Math.max(0, Math.min(1, lm.y + vel.vy * decay * 0.5)),
            })) as NormalizedLandmark[]
          }
        }
      }

      const smoothAlpha = crossingSmoothAlpha(crossingPhase)
      const landmarksA = rawA
        ? smoothLandmarks(rawA, lastRaw.A ?? smoothed.A, smoothAlpha)
        : keepA ? smoothed.A : null
      const landmarksB = rawB
        ? smoothLandmarks(rawB, lastRaw.B ?? smoothed.B, smoothAlpha)
        : keepB ? smoothed.B : null

      if (rawA) {
        if (lastRaw.A) velocity.A = getTorsoVelocity(rawA, lastRaw.A)
        prevRaw.A = lastRaw.A
        lastRaw.A = rawA
      }
      if (rawB) {
        if (lastRaw.B) velocity.B = getTorsoVelocity(rawB, lastRaw.B)
        prevRaw.B = lastRaw.B
        lastRaw.B = rawB
      }
      smoothed.A = landmarksA
      smoothed.B = landmarksB

      out.push({
        f: frame.f,
        tMs: frame.tMs,
        phase: crossingPhase,
        lock: lockKey,
        nCands: deduped.length,
        rawA: !!rawA,
        rawB: !!rawB,
        A: landmarksA?.map((l) => [+l.x.toFixed(4), +l.y.toFixed(4), +(l.visibility ?? 0).toFixed(2)]) ?? null,
        B: landmarksB?.map((l) => [+l.x.toFixed(4), +l.y.toFixed(4), +(l.visibility ?? 0).toFixed(2)]) ?? null,
      })
    }

    writeFileSync(outFile, JSON.stringify(out))
    console.log(`replayed ${frames.length} frames -> ${outFile}`)
  })
})
