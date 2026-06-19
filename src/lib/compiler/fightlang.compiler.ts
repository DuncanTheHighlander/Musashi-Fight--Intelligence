import { DEFAULT_FIGHTLANG_THRESHOLDS } from '@/lib/fightlang/fightlang.defaults'
import { makeEvidenceRef, makeId, makeTimeRangeMs } from '@/lib/fightlang/fightlang.ids'
import type {
  ActorId,
  ActorState,
  FightEvidenceLedger,
  FightEvent,
  FightFault,
  FightSequence,
  KinematicSnapshot,
  OverlayAnnotation,
  PoseFrame,
} from '@/lib/fightlang/fightlang.types'
import { FIGHTLANG_CONTRACT_VERSION } from '@/lib/fightlang/fightlang.types'
import { detectGuard } from './detectors/guard'
import { detectPatterns } from './detectors/patterns'
import { detectRange } from './detectors/range'
import { detectRhythm } from './detectors/rhythm'
import { detectStance } from './detectors/stance'
import { detectStrikes } from './detectors/strikes'
import { detectFaults } from './detectors/faults'

export type FightLangCompileInput = Readonly<{
  poseFrames: ReadonlyArray<PoseFrame>
  kinematics?: ReadonlyArray<KinematicSnapshot>
  clip?: FightEvidenceLedger['clip']
  actors?: ReadonlyArray<ActorId>
}>

export type FightLangCompileOutput = Readonly<{
  ledger: FightEvidenceLedger
  overlayAnnotations: OverlayAnnotation[]
}>

function uniqueActorsFromFrames(frames: ReadonlyArray<PoseFrame>): ActorId[] {
  const set = new Set<ActorId>()
  for (const f of frames) {
    if (f.actors.A && f.actors.A.length) set.add('A')
    if (f.actors.B && f.actors.B.length) set.add('B')
  }
  // keep stable ordering
  return (['A', 'B'] as const).filter((x) => set.has(x))
}

function latestKinematicsAt(kin: ReadonlyArray<KinematicSnapshot>, tMs: number): KinematicSnapshot | null {
  if (!kin.length) return null
  let best: KinematicSnapshot | null = null
  let bestDt = Number.POSITIVE_INFINITY
  for (const k of kin) {
    const dt = Math.abs(k.tMs - tMs)
    if (dt < bestDt) {
      best = k
      bestDt = dt
    }
  }
  // If extremely far, treat as missing.
  return bestDt <= 500 ? best : best
}

export function compileFightLang(input: FightLangCompileInput): FightLangCompileOutput {
  const poseFrames = [...input.poseFrames].sort((a, b) => a.tMs - b.tMs)
  const actors = (input.actors && input.actors.length ? [...input.actors] : uniqueActorsFromFrames(poseFrames)) as ActorId[]
  const generatedAtMs = Date.now()

  const geometry: Array<FightEvidenceLedger['geometry'][number]> = []
  const kinematics: Array<FightEvidenceLedger['kinematics'][number]> = input.kinematics ? [...input.kinematics] : []
  const actorStateTimeline: ActorState[] = []
  const events: FightEvent[] = []
  const faults: FightFault[] = []

  const evidenceIndex: Array<FightEvidenceLedger['evidenceIndex'][number]> = []

  const overlayAnnotations: OverlayAnnotation[] = []
  const lastAnnotationMs: Record<string, number> = {}
  const ANNOTATION_COOLDOWN_MS = 2000

  for (const frame of poseFrames) {
    const tMs = frame.tMs
    const kin = input.kinematics ? latestKinematicsAt(input.kinematics, tMs) : null
    const range = kin?.range

    for (const actorId of actors) {
      const landmarks = frame.actors[actorId]
      if (!landmarks || landmarks.length === 0) continue

      const opponentId: ActorId = actorId === 'A' ? 'B' : 'A'
      const opponentLandmarks = frame.actors[opponentId]

      const stance = detectStance({ tMs, actorId, landmarks, opponentLandmarks })
      const guard = detectGuard({ tMs, actorId, landmarks })
      const rhythm = detectRhythm({
        actorId,
        poseFrames,
        endMs: tMs,
        windowMs: DEFAULT_FIGHTLANG_THRESHOLDS.rhythm.windowMs,
      })

      const rangeDet = detectRange({
        tMs,
        actorId,
        distanceBw: range?.distanceBw ?? null,
        closingBwps: range?.closingBwps ?? null,
      })

      const geomEvidence = [...stance.evidence, ...guard.evidence, ...rangeDet.evidence, ...rhythm.evidence]
      for (const ev of geomEvidence) evidenceIndex.push(ev)

      geometry.push({
        tMs,
        actorId,
        stanceSide: stance.stanceSide,
        stanceConfidence: stance.stanceConfidence,
        stanceWidthBw: stance.stanceWidthBw,
        stanceAngleDeg: stance.stanceAngleDeg,
        torsoAngleDeg: null,
        headLine: guard.headLine,
        guard: {
          shape: guard.shape,
          handsHigh: guard.handsHigh,
          exposureScore: guard.exposureScore,
        },
        base: {
          compromised: null,
          compromisedScoreBw: null,
          overextended: null,
          overextensionScoreBw: null,
        },
        evidence: geomEvidence,
      })

      const faultList = detectFaults({
        tMs,
        actorId,
        landmarks,
        guardExposureScore: guard.exposureScore,
      })
      for (const f of faultList) {
        faults.push(f)
        for (const ev of f.evidence) evidenceIndex.push(ev)
      }

      // Strike detection from kinematics + pose direction.
      const handBurstBwps = kin?.actors?.[actorId]?.handBurstBwps ?? null
      const footBurstBwps = kin?.actors?.[actorId]?.footSpeedBwps ?? null
      // Find previous frame landmarks for direction analysis
      const frameIdx = poseFrames.indexOf(frame)
      const prevFrame = frameIdx > 0 ? poseFrames[frameIdx - 1] : null
      const prevLandmarks = prevFrame?.actors[actorId]
      const strikeEvts = detectStrikes({
        tMs,
        actorId,
        handBurstBwps,
        footBurstBwps,
        thresholdBwps: 1.2,
        landmarks,
        prevLandmarks,
        stanceSide: stance.stanceSide,
      })
      for (const e of strikeEvts) {
        events.push(e)
        for (const ev of e.evidence) evidenceIndex.push(ev)
      }

      // Emit state timeline sample (stable UI hook).
      actorStateTimeline.push({
        tMs,
        actorId,
        stanceSide: stance.stanceSide,
        guard: guard.shape,
        rangeToOther: rangeDet.band,
        rhythm: { bounceHz: rhythm.bounceHz, cadenceCv: rhythm.cadenceCv },
        evidence: geomEvidence,
      })

      // Overlay annotations for medium+ severity faults (cooldown-limited)
      const notable = faultList.filter((x) => x.severity === 'high' || x.severity === 'medium')
      for (const f of notable) {
        const key = `fault_${f.kind}_${actorId}`
        if (tMs - (lastAnnotationMs[key] ?? -Infinity) < ANNOTATION_COOLDOWN_MS) continue
        lastAnnotationMs[key] = tMs

        const annType = f.severity === 'high' ? 'circle' : 'moment'
        const faultLabels: Record<string, string> = {
          guard_low: 'Guard dropping — chin exposed',
          chin_exposed: 'Chin past base line — counter opportunity',
          overextension: 'Overreaching — off balance',
          compromised_base: 'Narrow base — vulnerable to push',
        }
        overlayAnnotations.push({
          id: makeId('ann_fault'),
          actorId,
          time: makeTimeRangeMs(tMs, tMs + 1200),
          annotationType: annType,
          anchorPoints: [{ kind: 'bbox_center', actorId }],
          message: faultLabels[f.kind] || f.message,
          confidence: f.confidence,
          evidence: f.evidence,
        })
      }

      // Annotations from events (classified strikes) — cooldown-limited
      for (const e of strikeEvts) {
        const key = `strike_${actorId}`
        if (tMs - (lastAnnotationMs[key] ?? -Infinity) < ANNOTATION_COOLDOWN_MS) continue
        lastAnnotationMs[key] = tMs
        const displayLabel = (e.data?.displayLabel as string) || e.label || 'Strike'
        const limb = (e.data?.limb as string) || ''
        const limbTag = limb.includes('leg') ? 'leg' : limb.includes('hand') ? 'hand' : ''
        overlayAnnotations.push({
          id: makeId('ann_strike'),
          actorId,
          time: makeTimeRangeMs(tMs, tMs + 1200),
          annotationType: 'arrow',
          anchorPoints: limbTag === 'leg'
            ? [{ kind: 'landmark', actorId, landmarkIndex: 27 }] // ankle
            : [{ kind: 'landmark', actorId, landmarkIndex: 15 }], // wrist
          message: `${actorId}: ${displayLabel}`,
          confidence: e.confidence,
          evidence: e.evidence,
        })
      }

      // Stance switch annotations
      if (actorStateTimeline.length >= 2) {
        const prev = actorStateTimeline[actorStateTimeline.length - 2]
        const curr = actorStateTimeline[actorStateTimeline.length - 1]!
        if (prev && prev.actorId === actorId && prev.stanceSide !== curr.stanceSide) {
          const key = `stance_${actorId}`
          if (tMs - (lastAnnotationMs[key] ?? -Infinity) >= ANNOTATION_COOLDOWN_MS) {
            lastAnnotationMs[key] = tMs
            overlayAnnotations.push({
              id: makeId('ann_stance'),
              actorId,
              time: makeTimeRangeMs(tMs, tMs + 1200),
              annotationType: 'label',
              anchorPoints: [{ kind: 'bbox_center', actorId }],
              message: `${actorId} switches to ${curr.stanceSide}`,
              confidence: { score: 0.65, basis: 'heuristic' },
              evidence: geomEvidence.slice(0, 2),
            })
          }
        }
        if (prev && prev.actorId === actorId && prev.rangeToOther !== curr.rangeToOther && curr.rangeToOther) {
          const key = `range_${actorId}`
          if (tMs - (lastAnnotationMs[key] ?? -Infinity) >= ANNOTATION_COOLDOWN_MS) {
            lastAnnotationMs[key] = tMs
            overlayAnnotations.push({
              id: makeId('ann_range'),
              actorId,
              time: makeTimeRangeMs(tMs, tMs + 800),
              annotationType: 'label',
              anchorPoints: [{ kind: 'bbox_center', actorId }],
              message: `Range: ${curr.rangeToOther}`,
              confidence: { score: 0.6, basis: 'heuristic' },
              evidence: geomEvidence.slice(0, 2),
            })
          }
        }
      }
    }
  }

  // Patterns (operate on compiled events/faults/states/kinematics + raw pose frames for movement).
  const patterns = actors.flatMap((actorId) => detectPatterns({
    actorId,
    events,
    faults,
    actorStates: actorStateTimeline,
    kinematics,
    poseFrames,
  }))
  for (const p of patterns) {
    for (const ev of p.evidence) evidenceIndex.push(ev)
    const actorId = p.actorId
    const occ0 = p.occurrences[0]
    if (!actorId || !occ0) continue
    const patternLabels: Record<string, string> = {
      repeated_guard_drop: 'Keeps dropping guard — habit',
      repeated_overextension: 'Consistently overreaching',
      stance_oscillation: 'Switching stance frequently — reads available',
      burst_cluster: 'Flurry of activity — exchange happening',
      guard_drop_before_entry: 'Guard drops before entry — counter window',
      linear_retreat: 'Retreating straight back — cut the ring',
      one_beat_entry: 'Same-timing entry — time the counter',
      circling: 'Circling — working angles around opponent',
      ring_cutting: 'Cutting off the ring — closing escape routes',
    }
    overlayAnnotations.push({
      id: makeId('ann_pattern'),
      actorId,
      time: makeTimeRangeMs(occ0.startMs, occ0.endMs),
      annotationType: 'circle',
      anchorPoints: [{ kind: 'bbox_center', actorId }],
      message: patternLabels[p.kind] || `Pattern: ${p.kind}`,
      confidence: p.confidence,
      evidence: p.evidence.slice(0, 3),
    })
  }

  // Overlay callouts now show ONLY when a real detector fires (no filler).
  // Short clips previously padded up to 6 evenly-spaced overlays so the strip
  // looked busy; that read as fake. Honesty over density.

  // Minimal sequences: a single sequence covering full clip.
  const sequences: FightSequence[] = poseFrames.length
    ? [
        {
          id: makeId('seq_clip'),
          t: makeTimeRangeMs(poseFrames[0]!.tMs, poseFrames[poseFrames.length - 1]!.tMs),
          tokens: [],
          evidence: [
            makeEvidenceRef({
              source: 'compiler',
              t: makeTimeRangeMs(poseFrames[0]!.tMs, poseFrames[poseFrames.length - 1]!.tMs),
              note: 'Sequence placeholder for full clip (grammar layer stub).',
            }),
          ],
        },
      ]
    : []

  const ledger: FightEvidenceLedger = {
    contractVersion: FIGHTLANG_CONTRACT_VERSION,
    generatedAtMs,
    clip: input.clip,
    actors,
    poseFrames,
    tracks: [],
    geometry,
    kinematics,
    actorStateTimeline,
    events,
    faults,
    patterns,
    sequences,
    evidenceIndex,
    notes: ['FightLang compiler v1: stance/guard/range/rhythm + placeholder strike events.'],
  }

  return { ledger, overlayAnnotations }
}

