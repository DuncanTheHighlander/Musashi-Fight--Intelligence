import { makeEvidenceRef, makeId, makeTimeRangeMs } from '@/lib/fightlang/fightlang.ids'
import type {
  ActorId,
  ActorState,
  EvidenceRef,
  FightFault,
  FightPattern,
  FightPatternKind,
  FightEvent,
  KinematicSnapshot,
  TimeRangeMs,
} from '@/lib/fightlang/fightlang.types'

function confidenceFromCount(count: number): number {
  if (count <= 0) return 0.2
  if (count === 1) return 0.35
  if (count === 2) return 0.55
  if (count === 3) return 0.68
  return 0.78
}

export type PatternDetectionInput = {
  actorId: ActorId
  events: ReadonlyArray<FightEvent>
  faults: ReadonlyArray<FightFault>
  /** Actor state timeline for range/rhythm analysis. */
  actorStates?: ReadonlyArray<ActorState>
  /** Kinematic snapshots for closing speed / hip movement. */
  kinematics?: ReadonlyArray<KinematicSnapshot>
}

// ---------------------------------------------------------------------------
// Guard drop before entry
// ---------------------------------------------------------------------------

const STRIKE_KINDS = new Set(['strike_placeholder', 'jab', 'cross', 'lead_hook', 'rear_hook', 'lead_uppercut', 'rear_uppercut', 'teep', 'lead_kick', 'rear_kick'])

function detectGuardDropBeforeEntry(
  actorId: ActorId,
  events: ReadonlyArray<FightEvent>,
  faults: ReadonlyArray<FightFault>
): FightPattern | null {
  const guardLows = faults.filter((f) => f.actorId === actorId && f.kind === 'guard_low')
  const strikes = events.filter((e) => e.actorId === actorId && STRIKE_KINDS.has(e.kind))

  const occurrences: TimeRangeMs[] = []
  for (const s of strikes) {
    const g = guardLows.find((x) => x.t.endMs <= s.t.startMs && s.t.startMs - x.t.endMs <= 300)
    if (g) occurrences.push({ startMs: g.t.startMs, endMs: s.t.endMs })
  }

  if (occurrences.length < 2) return null

  return {
    id: makeId('pat_guard_drop_before_entry'),
    kind: 'guard_drop_before_entry',
    actorId,
    occurrences,
    confidence: { score: confidenceFromCount(occurrences.length), basis: 'heuristic' },
    evidence: [
      makeEvidenceRef({
        id: makeId(`ev_pat_guarddrop_${actorId}`),
        source: 'compiler',
        actorId,
        t: makeTimeRangeMs(occurrences[0]!.startMs, occurrences[occurrences.length - 1]!.endMs),
        note: 'Pattern from guard_low faults followed shortly by strike placeholders.',
      }),
    ],
    summary: `Guard drops before entry detected ${occurrences.length} times (heuristic).`,
  }
}

// ---------------------------------------------------------------------------
// Linear retreat — fighter only moves straight back, no angles
// ---------------------------------------------------------------------------

function detectLinearRetreat(
  actorId: ActorId,
  actorStates: ReadonlyArray<ActorState>,
  kinematics: ReadonlyArray<KinematicSnapshot>
): FightPattern | null {
  // Find windows where this actor goes from close/mid → long range
  // repeatedly without lateral movement (hip speed stays low while closing
  // speed is negative = retreating).

  const states = actorStates.filter((s) => s.actorId === actorId)
  if (states.length < 4) return null

  const occurrences: TimeRangeMs[] = []
  let retreatStart: number | null = null

  for (let i = 1; i < states.length; i++) {
    const prev = states[i - 1]!
    const curr = states[i]!

    // Range widening = retreating
    const rangeOrder: Record<string, number> = { close: 0, mid: 1, long: 2, unknown: -1 }
    const prevRange = rangeOrder[prev.rangeToOther ?? 'unknown'] ?? -1
    const currRange = rangeOrder[curr.rangeToOther ?? 'unknown'] ?? -1

    if (currRange > prevRange && prevRange >= 0) {
      // Range is opening — check if closing speed is negative (retreat)
      const kin = kinematics.find((k) => Math.abs(k.tMs - curr.tMs) < 300)
      const closingBwps = kin?.range?.closingBwps
      const isRetreating = typeof closingBwps === 'number' && closingBwps < -0.3

      if (isRetreating) {
        if (retreatStart === null) retreatStart = prev.tMs
      } else {
        if (retreatStart !== null) {
          const duration = curr.tMs - retreatStart
          if (duration > 400) {
            occurrences.push({ startMs: retreatStart, endMs: prev.tMs })
          }
          retreatStart = null
        }
      }
    } else {
      // Range not opening — close retreat window
      if (retreatStart !== null) {
        const duration = curr.tMs - retreatStart
        if (duration > 400) {
          occurrences.push({ startMs: retreatStart, endMs: prev.tMs })
        }
        retreatStart = null
      }
    }
  }

  // Close any open retreat window
  if (retreatStart !== null && states.length > 0) {
    const last = states[states.length - 1]!
    const duration = last.tMs - retreatStart
    if (duration > 400) {
      occurrences.push({ startMs: retreatStart, endMs: last.tMs })
    }
  }

  if (occurrences.length < 2) return null

  return {
    id: makeId('pat_linear_retreat'),
    kind: 'linear_retreat',
    actorId,
    occurrences,
    confidence: { score: confidenceFromCount(occurrences.length), basis: 'heuristic' },
    evidence: [
      makeEvidenceRef({
        id: makeId(`ev_pat_retreat_${actorId}`),
        source: 'compiler',
        actorId,
        t: makeTimeRangeMs(occurrences[0]!.startMs, occurrences[occurrences.length - 1]!.endMs),
        note: `Linear retreat pattern: ${occurrences.length} occurrences of straight-back movement without angling off.`,
      }),
    ],
    summary: `Retreats in a straight line ${occurrences.length} times — predictable exit path, vulnerable to cuts/pressure.`,
  }
}

// ---------------------------------------------------------------------------
// One beat entry — fighter enters on a single rhythm beat (predictable timing)
// ---------------------------------------------------------------------------

function detectOneBeatEntry(
  actorId: ActorId,
  events: ReadonlyArray<FightEvent>,
  actorStates: ReadonlyArray<ActorState>,
  kinematics: ReadonlyArray<KinematicSnapshot>
): FightPattern | null {
  // Find strikes preceded by range closing (mid→close or long→mid/close)
  // within a consistent time window. If the gap between "range closes" and
  // "strike lands" is similar across 3+ entries, it's a one-beat entry.

  const strikes = events.filter((e) => e.actorId === actorId && STRIKE_KINDS.has(e.kind))
  if (strikes.length < 3) return null

  const states = actorStates.filter((s) => s.actorId === actorId)

  // For each strike, find the most recent range-closing moment
  const entryGaps: Array<{ gapMs: number; strikeMs: number; closeMs: number }> = []

  for (const strike of strikes) {
    const strikeTMs = strike.t.startMs

    // Find most recent state where range was closing (mid/long → close)
    let closeMoment: number | null = null
    for (let i = states.length - 1; i > 0; i--) {
      const curr = states[i]!
      const prev = states[i - 1]!
      if (curr.tMs > strikeTMs) continue
      if (curr.tMs < strikeTMs - 2000) break

      if (curr.actorId !== actorId) continue

      const rangeOrder: Record<string, number> = { close: 0, mid: 1, long: 2, unknown: -1 }
      const prevR = rangeOrder[prev.rangeToOther ?? 'unknown'] ?? -1
      const currR = rangeOrder[curr.rangeToOther ?? 'unknown'] ?? -1

      // Range is closing
      if (currR < prevR && currR >= 0) {
        closeMoment = curr.tMs
        break
      }
    }

    if (closeMoment !== null) {
      entryGaps.push({
        gapMs: strikeTMs - closeMoment,
        strikeMs: strikeTMs,
        closeMs: closeMoment,
      })
    }
  }

  if (entryGaps.length < 3) return null

  // Check consistency: are the gaps within 200ms of each other?
  const gaps = entryGaps.map((e) => e.gapMs)
  const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length
  const consistent = gaps.filter((g) => Math.abs(g - avgGap) < 200)

  if (consistent.length < 3) return null

  const occurrences: TimeRangeMs[] = entryGaps
    .filter((e) => Math.abs(e.gapMs - avgGap) < 200)
    .map((e) => ({ startMs: e.closeMs, endMs: e.strikeMs }))

  return {
    id: makeId('pat_one_beat_entry'),
    kind: 'one_beat_entry',
    actorId,
    occurrences,
    confidence: { score: confidenceFromCount(occurrences.length), basis: 'heuristic' },
    evidence: [
      makeEvidenceRef({
        id: makeId(`ev_pat_onebeat_${actorId}`),
        source: 'compiler',
        actorId,
        t: makeTimeRangeMs(occurrences[0]!.startMs, occurrences[occurrences.length - 1]!.endMs),
        note: `One-beat entry: ${occurrences.length} entries with consistent ~${Math.round(avgGap)}ms gap from range-close to strike.`,
      }),
    ],
    summary: `Enters on a single beat (avg ${Math.round(avgGap)}ms) ${occurrences.length} times — timing is readable, counter opportunity on the entry.`,
  }
}

// ---------------------------------------------------------------------------
// Circling — fighter moves laterally around the opponent
// ---------------------------------------------------------------------------

function hipMidpoint(lms: ReadonlyArray<{ x: number; y: number }> | undefined): { x: number; y: number } | null {
  if (!lms || lms.length < 26) return null
  const lh = lms[23]!
  const rh = lms[24]!
  return { x: (lh.x + rh.x) / 2, y: (lh.y + rh.y) / 2 }
}

function angleBetween(
  center: { x: number; y: number },
  point: { x: number; y: number }
): number {
  return Math.atan2(point.y - center.y, point.x - center.x)
}

function signedAngleDelta(a: number, b: number): number {
  let d = b - a
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}

type PoseFrameForCircling = {
  tMs: number
  actors: Partial<Record<string, ReadonlyArray<{ x: number; y: number }>>>
}

function detectCircling(
  actorId: ActorId,
  actorStates: ReadonlyArray<ActorState>,
  _kinematics: ReadonlyArray<KinematicSnapshot>,
  poseFrames?: ReadonlyArray<PoseFrameForCircling>
): FightPattern | null {
  if (!poseFrames || poseFrames.length < 6) return null

  const otherId: ActorId = actorId === 'A' ? 'B' : 'A'

  const WINDOW = 8
  const MIN_ARC_DEG = 35
  const occurrences: TimeRangeMs[] = []
  let totalArcDeg = 0

  for (let i = WINDOW; i < poseFrames.length; i++) {
    const window = poseFrames.slice(i - WINDOW, i + 1)
    let cumAngle = 0
    let valid = true

    for (let j = 1; j < window.length; j++) {
      const prevF = window[j - 1]!
      const currF = window[j]!
      const pivotPrev = hipMidpoint(prevF.actors[otherId] as any)
      const pivotCurr = hipMidpoint(currF.actors[otherId] as any)
      const moverPrev = hipMidpoint(prevF.actors[actorId] as any)
      const moverCurr = hipMidpoint(currF.actors[actorId] as any)

      if (!pivotPrev || !pivotCurr || !moverPrev || !moverCurr) { valid = false; break }

      const pivot = { x: (pivotPrev.x + pivotCurr.x) / 2, y: (pivotPrev.y + pivotCurr.y) / 2 }
      const angPrev = angleBetween(pivot, moverPrev)
      const angCurr = angleBetween(pivot, moverCurr)
      cumAngle += signedAngleDelta(angPrev, angCurr)
    }

    if (!valid) continue
    const arcDeg = Math.abs(cumAngle) * (180 / Math.PI)
    if (arcDeg >= MIN_ARC_DEG) {
      const startMs = window[0]!.tMs
      const endMs = window[window.length - 1]!.tMs
      if (occurrences.length === 0 || startMs - occurrences[occurrences.length - 1]!.endMs > 500) {
        occurrences.push({ startMs, endMs })
        totalArcDeg += arcDeg
      } else {
        occurrences[occurrences.length - 1] = { startMs: occurrences[occurrences.length - 1]!.startMs, endMs }
        totalArcDeg += arcDeg
      }
    }
  }

  if (occurrences.length < 1) return null

  const direction = totalArcDeg > 0 ? 'counter-clockwise' : 'clockwise'
  return {
    id: makeId('pat_circling'),
    kind: 'circling',
    actorId,
    occurrences,
    confidence: { score: Math.min(0.85, confidenceFromCount(occurrences.length) + 0.1), basis: 'heuristic' },
    evidence: [
      makeEvidenceRef({
        id: makeId(`ev_pat_circling_${actorId}`),
        source: 'compiler',
        actorId,
        t: makeTimeRangeMs(occurrences[0]!.startMs, occurrences[occurrences.length - 1]!.endMs),
        note: `Circling pattern: ${occurrences.length} arcs, ~${Math.round(totalArcDeg)}° total, predominantly ${direction}.`,
      }),
    ],
    summary: `${actorId} circling ${direction} around opponent — ${occurrences.length} arc segments (~${Math.round(totalArcDeg)}° total).`,
  }
}

// ---------------------------------------------------------------------------
// Ring cutting — fighter moves to cut off the circling opponent
// ---------------------------------------------------------------------------

function detectRingCutting(
  actorId: ActorId,
  actorStates: ReadonlyArray<ActorState>,
  kinematics: ReadonlyArray<KinematicSnapshot>,
  poseFrames?: ReadonlyArray<PoseFrameForCircling>
): FightPattern | null {
  if (!poseFrames || poseFrames.length < 6) return null

  const otherId: ActorId = actorId === 'A' ? 'B' : 'A'
  const WINDOW = 6
  const occurrences: TimeRangeMs[] = []

  for (let i = WINDOW; i < poseFrames.length; i++) {
    const window = poseFrames.slice(i - WINDOW, i + 1)

    const firstFrame = window[0]!
    const lastFrame = window[window.length - 1]!
    const cutterFirst = hipMidpoint(firstFrame.actors[actorId] as any)
    const cutterLast = hipMidpoint(lastFrame.actors[actorId] as any)
    const otherFirst = hipMidpoint(firstFrame.actors[otherId] as any)
    const otherLast = hipMidpoint(lastFrame.actors[otherId] as any)

    if (!cutterFirst || !cutterLast || !otherFirst || !otherLast) continue

    const cutterDx = cutterLast.x - cutterFirst.x
    const cutterDy = cutterLast.y - cutterFirst.y
    const cutterDist = Math.sqrt(cutterDx * cutterDx + cutterDy * cutterDy)
    const otherDx = otherLast.x - otherFirst.x
    const otherDy = otherLast.y - otherFirst.y
    const otherDist = Math.sqrt(otherDx * otherDx + otherDy * otherDy)

    if (cutterDist < 0.015 || otherDist < 0.01) continue

    const distFirst = Math.sqrt(
      (cutterFirst.x - otherFirst.x) ** 2 + (cutterFirst.y - otherFirst.y) ** 2
    )
    const distLast = Math.sqrt(
      (cutterLast.x - otherLast.x) ** 2 + (cutterLast.y - otherLast.y) ** 2
    )

    const isClosing = distLast < distFirst * 0.88
    const cutterAngle = Math.atan2(cutterDy, cutterDx)
    const directAngle = Math.atan2(otherFirst.y - cutterFirst.y, otherFirst.x - cutterFirst.x)
    const angDiff = Math.abs(signedAngleDelta(cutterAngle, directAngle))
    const isAngling = angDiff < Math.PI / 3

    if (isClosing && isAngling && cutterDist > otherDist * 0.6) {
      const startMs = firstFrame.tMs
      const endMs = lastFrame.tMs
      if (occurrences.length === 0 || startMs - occurrences[occurrences.length - 1]!.endMs > 500) {
        occurrences.push({ startMs, endMs })
      } else {
        occurrences[occurrences.length - 1] = { startMs: occurrences[occurrences.length - 1]!.startMs, endMs }
      }
    }
  }

  if (occurrences.length < 1) return null

  return {
    id: makeId('pat_ring_cutting'),
    kind: 'ring_cutting',
    actorId,
    occurrences,
    confidence: { score: confidenceFromCount(occurrences.length), basis: 'heuristic' },
    evidence: [
      makeEvidenceRef({
        id: makeId(`ev_pat_ringcut_${actorId}`),
        source: 'compiler',
        actorId,
        t: makeTimeRangeMs(occurrences[0]!.startMs, occurrences[occurrences.length - 1]!.endMs),
        note: `Ring-cutting: ${actorId} repositioned to cut off opponent's angle ${occurrences.length} time(s).`,
      }),
    ],
    summary: `${actorId} cutting off the ring ${occurrences.length} time(s) — closing distance while angling to block escape routes.`,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectPatterns(input: PatternDetectionInput & { poseFrames?: ReadonlyArray<PoseFrameForCircling> }): FightPattern[] {
  const { actorId, events, faults, actorStates, kinematics, poseFrames } = input
  const patterns: FightPattern[] = []

  const guardDrop = detectGuardDropBeforeEntry(actorId, events, faults)
  if (guardDrop) patterns.push(guardDrop)

  if (actorStates && kinematics) {
    const retreat = detectLinearRetreat(actorId, actorStates, kinematics)
    if (retreat) patterns.push(retreat)

    const oneBeat = detectOneBeatEntry(actorId, events, actorStates, kinematics)
    if (oneBeat) patterns.push(oneBeat)

    const circling = detectCircling(actorId, actorStates, kinematics, poseFrames)
    if (circling) patterns.push(circling)

    const ringCut = detectRingCutting(actorId, actorStates, kinematics, poseFrames)
    if (ringCut) patterns.push(ringCut)
  }

  return patterns
}
