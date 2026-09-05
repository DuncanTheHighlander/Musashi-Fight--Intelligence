/**
 * Exchange window detection for FightLang compiler gating (Phase 3).
 * Reuses timing thresholds from exchangeSegmenter.ts — do not fork magic numbers.
 */

import { EXCHANGE_CONFIG } from '@/services/exchangeSegmenter'
import type { KinematicsSnapshot } from '@/lib/kinematics'
import { POSE_LANDMARKS } from '@/lib/kinematics'
import type { KinematicSnapshot, PoseFrame, PoseLandmark } from '@/lib/fightlang/fightlang.types'
import { isGrapplingClip } from '@/lib/grapplingAnalysisPrompt'
import type { ExchangeWindow } from '@/lib/evidence/sessionEvidenceExtensions'

export type { ExchangeWindow }

const STRIKE_HAND_BWPS = 5.0
const HIP_SCRAMBLE_BWPS = 2.0
const GRAPPLING_HAND_BWPS = 1.2

export type FindExchangeWindowsOpts = {
  sport?: string | null
  clipType?: string | null
  minDurationMs?: number
  mergeGapMs?: number
  fps?: number
}

function lm2(landmarks: ReadonlyArray<PoseLandmark> | undefined, idx: number) {
  const lm = landmarks?.[idx]
  if (!lm) return null
  return { x: lm.x, y: lm.y }
}

function shoulderWidth(landmarks: ReadonlyArray<PoseLandmark> | undefined): number | null {
  const ls = lm2(landmarks, POSE_LANDMARKS.LEFT_SHOULDER)
  const rs = lm2(landmarks, POSE_LANDMARKS.RIGHT_SHOULDER)
  if (!ls || !rs) return null
  const w = Math.hypot(ls.x - rs.x, ls.y - rs.y)
  return w > 0 ? w : null
}

function hipCenter(landmarks: ReadonlyArray<PoseLandmark> | undefined) {
  const lh = lm2(landmarks, POSE_LANDMARKS.LEFT_HIP)
  const rh = lm2(landmarks, POSE_LANDMARKS.RIGHT_HIP)
  if (!lh || !rh) return null
  return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
}

/** Accept fightlang or client kinematics rows; normalize to client snapshot shape. */
export function normalizeKinematicsSeries(raw: ReadonlyArray<unknown> | undefined): KinematicsSnapshot[] {
  if (!raw?.length) return []
  const out: KinematicsSnapshot[] = []
  for (const row of raw) {
    const r = row as Record<string, unknown>
    const tMs = Number(r.capturedAtMs ?? r.tMs ?? 0)
    if (!Number.isFinite(tMs)) continue
    const actors = (r.fighters ?? r.actors) as Record<string, Record<string, number>> | undefined
    const range = r.range as KinematicsSnapshot['range'] | undefined
    const fighters: KinematicsSnapshot['fighters'] = {}
    if (actors?.A) {
      fighters.A = {
        torsoScalePx: Number(actors.A.torsoScalePx ?? 1),
        handSpeedBwps: Number(actors.A.handSpeedBwps ?? 0),
        handBurstBwps: Number(actors.A.handBurstBwps ?? 0),
        footSpeedBwps: Number(actors.A.footSpeedBwps ?? 0),
        hipSpeedBwps: Number(actors.A.hipSpeedBwps ?? 0),
        powerIndex: Number(actors.A.powerIndex ?? 0),
      }
    }
    if (actors?.B) {
      fighters.B = {
        torsoScalePx: Number(actors.B.torsoScalePx ?? 1),
        handSpeedBwps: Number(actors.B.handSpeedBwps ?? 0),
        handBurstBwps: Number(actors.B.handBurstBwps ?? 0),
        footSpeedBwps: Number(actors.B.footSpeedBwps ?? 0),
        hipSpeedBwps: Number(actors.B.hipSpeedBwps ?? 0),
        powerIndex: Number(actors.B.powerIndex ?? 0),
      }
    }
    out.push({
      capturedAtMs: tMs,
      videoTimeSec: typeof r.videoTimeSec === 'number' ? r.videoTimeSec : null,
      posesDetected: Number(r.posesDetected ?? (fighters.A ? 1 : 0) + (fighters.B ? 1 : 0)),
      fighters,
      range,
    })
  }
  return out.sort((a, b) => a.capturedAtMs - b.capturedAtMs)
}

/** Convert client kinematics to fightlang compiler snapshots (tMs key). */
export function clientKinematicsToFightLang(series: ReadonlyArray<KinematicsSnapshot>): KinematicSnapshot[] {
  return series.map((s): KinematicSnapshot => ({
    tMs: s.capturedAtMs,
    videoTimeSec: s.videoTimeSec,
    actors: {
      ...(s.fighters.A
        ? {
            A: {
              handSpeedBwps: s.fighters.A.handSpeedBwps,
              handBurstBwps: s.fighters.A.handBurstBwps,
              footSpeedBwps: s.fighters.A.footSpeedBwps,
              hipSpeedBwps: s.fighters.A.hipSpeedBwps,
              powerIndex: s.fighters.A.powerIndex,
            },
          }
        : {}),
      ...(s.fighters.B
        ? {
            B: {
              handSpeedBwps: s.fighters.B.handSpeedBwps,
              handBurstBwps: s.fighters.B.handBurstBwps,
              footSpeedBwps: s.fighters.B.footSpeedBwps,
              hipSpeedBwps: s.fighters.B.hipSpeedBwps,
              powerIndex: s.fighters.B.powerIndex,
            },
          }
        : {}),
    },
    range: s.range
      ? {
          distanceBw: s.range.distanceBw,
          closingBwps: s.range.closingBwps,
          band: s.range.band === 'close' ? 'close' : s.range.band === 'long' ? 'long' : 'mid',
        }
      : undefined,
    evidence: [],
  }))
}

function uniqueActors(frames: ReadonlyArray<PoseFrame>): Array<'A' | 'B'> {
  const set = new Set<'A' | 'B'>()
  for (const f of frames) {
    if (f.actors.A?.length) set.add('A')
    if (f.actors.B?.length) set.add('B')
  }
  return (['A', 'B'] as const).filter((x) => set.has(x))
}

function velocitySpike(
  snap: KinematicsSnapshot,
  grappling: boolean,
): { active: boolean; score: number } {
  const a = snap.fighters.A
  const b = snap.fighters.B
  const maxHand = Math.max(a?.handBurstBwps ?? 0, b?.handBurstBwps ?? 0)
  const maxHip = Math.max(a?.hipSpeedBwps ?? 0, b?.hipSpeedBwps ?? 0)
  const closing = Math.abs(snap.range?.closingBwps ?? 0)

  if (grappling) {
    const score = 0.2 * maxHand + 0.6 * maxHip + 0.2 * closing
    const active =
      maxHip >= HIP_SCRAMBLE_BWPS ||
      closing >= EXCHANGE_CONFIG.V_CLOSE ||
      maxHand >= GRAPPLING_HAND_BWPS
    return { active, score }
  }

  const score = 0.5 * maxHand + 0.3 * maxHip + 0.2 * closing
  const active =
    maxHand >= STRIKE_HAND_BWPS ||
    closing >= EXCHANGE_CONFIG.V_CLOSE ||
    (a?.handSpeedBwps ?? 0) > 3.0 && (b?.handSpeedBwps ?? 0) > 3.0
  return { active, score }
}

function windowsFromKinematics(
  series: KinematicsSnapshot[],
  grappling: boolean,
  opts: FindExchangeWindowsOpts,
): ExchangeWindow[] {
  const fps = opts.fps ?? 30
  const tMin = opts.minDurationMs ?? EXCHANGE_CONFIG.T_MIN
  const tMerge = opts.mergeGapMs ?? EXCHANGE_CONFIG.T_MERGE
  const tEnter = EXCHANGE_CONFIG.T_ENTER
  const tExit = EXCHANGE_CONFIG.T_EXIT

  type FrameState = {
    tMs: number
    near: boolean
    active: boolean
    peakScore: number
  }

  const states: FrameState[] = series.map((snap) => {
    const rangeBw = snap.range?.distanceBw ?? 10
    const near = rangeBw <= EXCHANGE_CONFIG.R_NEAR
    const vel = velocitySpike(snap, grappling)
    return { tMs: snap.capturedAtMs, near, active: vel.active, peakScore: vel.score }
  })

  const raw: ExchangeWindow[] = []
  let inExchange = false
  let startIdx = -1
  let engagedMs = 0
  let disengagedMs = 0
  let peakScore = 0

  for (let i = 0; i < states.length; i++) {
    const s = states[i]!
    const engaged = s.near && s.active

    if (!inExchange) {
      if (engaged) {
        engagedMs += 1000 / fps
        if (engagedMs >= tEnter) {
          inExchange = true
          startIdx = Math.max(0, i - Math.ceil((engagedMs * fps) / 1000) + 1)
          disengagedMs = 0
          peakScore = s.peakScore
        }
      } else {
        engagedMs = 0
      }
    } else {
      peakScore = Math.max(peakScore, s.peakScore)
      if (!engaged) {
        disengagedMs += 1000 / fps
        if (disengagedMs >= tExit) {
          const endIdx = Math.max(startIdx, i - Math.ceil((disengagedMs * fps) / 1000))
          const startMs = series[startIdx]!.capturedAtMs
          const endMs = series[endIdx]!.capturedAtMs
          if (endMs - startMs >= tMin) {
            raw.push({
              startMs,
              endMs,
              trigger: 'combined',
              peakMotionScore: peakScore,
            })
          }
          inExchange = false
          engagedMs = 0
          disengagedMs = 0
          peakScore = 0
        }
      } else {
        disengagedMs = 0
      }
    }
  }

  if (inExchange && startIdx >= 0) {
    const startMs = series[startIdx]!.capturedAtMs
    const endMs = series[series.length - 1]!.capturedAtMs
    if (endMs - startMs >= tMin) {
      raw.push({ startMs, endMs, trigger: 'combined', peakMotionScore: peakScore })
    }
  }

  return mergeWindows(raw, tMerge)
}

function mergeWindows(windows: ExchangeWindow[], mergeGapMs: number): ExchangeWindow[] {
  if (windows.length < 2) return windows
  const merged: ExchangeWindow[] = []
  let cur = windows[0]!
  for (let i = 1; i < windows.length; i++) {
    const next = windows[i]!
    if (next.startMs - cur.endMs <= mergeGapMs) {
      cur = {
        startMs: cur.startMs,
        endMs: next.endMs,
        trigger: 'combined',
        peakMotionScore: Math.max(cur.peakMotionScore ?? 0, next.peakMotionScore ?? 0),
      }
    } else {
      merged.push(cur)
      cur = next
    }
  }
  merged.push(cur)
  return merged
}

function windowsFromPoseFrames(
  poseFrames: ReadonlyArray<PoseFrame>,
  grappling: boolean,
  opts: FindExchangeWindowsOpts,
): ExchangeWindow[] {
  const sorted = [...poseFrames].sort((a, b) => a.tMs - b.tMs)
  if (sorted.length < 2) return []

  type Sample = { tMs: number; rangeBw: number; handBurst: number; hipSpeed: number; closing: number }
  const samples: Sample[] = []

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!
    const curr = sorted[i]!
    const dtMs = curr.tMs - prev.tMs
    if (dtMs <= 0) continue

    const swA = shoulderWidth(curr.actors.A)
    const swB = shoulderWidth(curr.actors.B)
    const sw = swA ?? swB ?? null
    const hipA = hipCenter(curr.actors.A)
    const hipB = hipCenter(curr.actors.B)

    let rangeBw = 10
    let closing = 0
    if (hipA && hipB && sw) {
      const dist = Math.hypot(hipA.x - hipB.x, hipA.y - hipB.y) / sw
      rangeBw = dist
      const prevHipA = hipCenter(prev.actors.A)
      const prevHipB = hipCenter(prev.actors.B)
      if (prevHipA && prevHipB) {
        const prevDist = Math.hypot(prevHipA.x - prevHipB.x, prevHipA.y - prevHipB.y) / sw
        closing = Math.abs((dist - prevDist) / (dtMs / 1000))
      }
    }

    let handBurst = 0
    let hipSpeed = 0
    for (const actorId of ['A', 'B'] as const) {
      const lm = curr.actors[actorId]
      const plm = prev.actors[actorId]
      const swActor = shoulderWidth(lm) ?? sw
      if (!lm || !plm || !swActor) continue
      const lw = lm2(lm, POSE_LANDMARKS.LEFT_WRIST)
      const rw = lm2(lm, POSE_LANDMARKS.RIGHT_WRIST)
      const plw = lm2(plm, POSE_LANDMARKS.LEFT_WRIST)
      const prw = lm2(plm, POSE_LANDMARKS.RIGHT_WRIST)
      if (lw && plw) handBurst = Math.max(handBurst, Math.hypot(lw.x - plw.x, lw.y - plw.y) / swActor / (dtMs / 1000))
      if (rw && prw) handBurst = Math.max(handBurst, Math.hypot(rw.x - prw.x, rw.y - prw.y) / swActor / (dtMs / 1000))
      const hip = hipCenter(lm)
      const prevHip = hipCenter(plm)
      if (hip && prevHip) hipSpeed = Math.max(hipSpeed, Math.hypot(hip.x - prevHip.x, hip.y - prevHip.y) / swActor / (dtMs / 1000))
    }

    samples.push({ tMs: curr.tMs, rangeBw, handBurst, hipSpeed, closing })
  }

  if (samples.length === 0) return []

  const pseudoKin: KinematicsSnapshot[] = samples.map((s) => ({
    capturedAtMs: s.tMs,
    videoTimeSec: null,
    posesDetected: 2,
    fighters: {
      A: {
        torsoScalePx: 1,
        handSpeedBwps: s.handBurst,
        handBurstBwps: s.handBurst,
        footSpeedBwps: 0,
        hipSpeedBwps: s.hipSpeed,
        powerIndex: 0,
      },
      B: {
        torsoScalePx: 1,
        handSpeedBwps: s.handBurst,
        handBurstBwps: s.handBurst,
        footSpeedBwps: 0,
        hipSpeedBwps: s.hipSpeed,
        powerIndex: 0,
      },
    },
    range: { distanceBw: s.rangeBw, closingBwps: s.closing, band: s.rangeBw <= 2.5 ? 'close' : s.rangeBw <= 4 ? 'mid' : 'long' },
  }))

  return windowsFromKinematics(pseudoKin, grappling, opts)
}

/**
 * Find engagement windows where strike/fault detectors should run.
 */
export function findExchangeWindows(
  poseFrames: ReadonlyArray<PoseFrame>,
  kinematics?: ReadonlyArray<KinematicSnapshot | KinematicsSnapshot | Record<string, unknown>>,
  opts: FindExchangeWindowsOpts = {},
): ExchangeWindow[] {
  const grappling = isGrapplingClip({ discipline: opts.sport, clipType: opts.clipType })
  const normalized = normalizeKinematicsSeries(kinematics as ReadonlyArray<unknown> | undefined)
  const actors = uniqueActors(poseFrames)

  if (normalized.length >= 4) {
    return windowsFromKinematics(normalized, grappling, opts)
  }

  if (actors.length < 2) {
    if (poseFrames.length === 0) return []
    const sorted = [...poseFrames].sort((a, b) => a.tMs - b.tMs)
    return [{ startMs: sorted[0]!.tMs, endMs: sorted[sorted.length - 1]!.tMs, trigger: 'combined' }]
  }

  return windowsFromPoseFrames(poseFrames, grappling, opts)
}

export function inExchangeWindow(tMs: number, windows: ReadonlyArray<ExchangeWindow>): boolean {
  if (windows.length === 0) return false
  return windows.some((w) => tMs >= w.startMs && tMs <= w.endMs)
}

export const STRUCTURAL_FAULT_KINDS = new Set([
  'guard_low',
  'chin_exposed',
  'overextension',
  'square_in_pocket',
  'rhythm_flat',
  'compromised_base',
])
