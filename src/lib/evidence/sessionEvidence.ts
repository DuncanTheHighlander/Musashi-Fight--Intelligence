/**
 * SessionEvidence — single evidence contract for all coaching paths (Phase 2).
 *
 * Pose measures → FightLang symbolizes → Vision audits → mergeEvidence → LLM speaks.
 */

import type { FactualLedger } from '@/lib/fightAnalysisPrompt'
import type { FightEvidenceLedger, FightEventKind, PoseFrame } from '@/lib/fightlang/fightlang.types'
import { isGrapplingClip } from '@/lib/grapplingAnalysisPrompt'
import type { PoseEngine, PoseQualitySummary } from '@/lib/pose/poseQuality'

export type EvidenceMode = 'striking' | 'grappling' | 'hybrid'

export type SessionEvidenceProvenance = {
  poseEngine: PoseEngine | string | null
  poseQuality: PoseQualitySummary | number | string | null
  videoSeen: boolean
  sport: string | null
  clipType: string | null
  mode: EvidenceMode
}

export type MergedLedger = {
  /** Ledger passed to grounded coaching + output validation */
  coachingLedger: FightEvidenceLedger
  /** Verified vision facts (striking factual ledger or grappling timeline) */
  visionFacts: FactualLedger | null
  mergeNotes: string[]
}

export type SessionEvidence = {
  fightLang: FightEvidenceLedger | null
  visionLedger: FactualLedger | null
  merged: MergedLedger
  provenance: SessionEvidenceProvenance
  /** Phase 5: optional 3D-lifted pose sequence from cloud pass. Absent = 2D-only path. */
  pose3DFrames?: PoseFrame[]
}

const STRIKE_EVENT_KINDS = new Set<FightEventKind>([
  'strike_placeholder',
  'jab',
  'cross',
  'lead_hook',
  'rear_hook',
  'lead_uppercut',
  'rear_uppercut',
  'teep',
  'lead_kick',
  'rear_kick',
  'defense_placeholder',
])

const STRIKING_FAULT_KINDS = new Set([
  'guard_low',
  'chin_exposed',
  'overextension',
  'square_in_pocket',
  'rhythm_flat',
])

export function resolveEvidenceMode(args: {
  sport?: string | null
  clipType?: string | null
}): EvidenceMode {
  if (isGrapplingClip(args)) return 'grappling'
  return 'striking'
}

/** Remove pose-compiler striking artifacts from a grappling clip ledger. */
export function stripGrapplingCompilerArtifacts(ledger: FightEvidenceLedger): FightEvidenceLedger {
  const removedEvents = ledger.events.filter((e) => STRIKE_EVENT_KINDS.has(e.kind)).length
  const removedFaults = ledger.faults.filter((f) => STRIKING_FAULT_KINDS.has(f.kind)).length
  return {
    ...ledger,
    events: ledger.events.filter((e) => !STRIKE_EVENT_KINDS.has(e.kind)),
    faults: ledger.faults.filter((f) => !STRIKING_FAULT_KINDS.has(f.kind)),
    evidenceIndex: ledger.evidenceIndex.filter((ref) => {
      const event = ledger.events.find((e) => e.id === ref.id)
      if (event && STRIKE_EVENT_KINDS.has(event.kind)) return false
      return true
    }),
  }
}

/** Build a minimal FactualLedger candidate from FightLang for striking verification. */
export function fightLangToVerificationCandidate(ledger: FightEvidenceLedger): FactualLedger {
  const techniques_observed = ledger.events
    .filter((e) => STRIKE_EVENT_KINDS.has(e.kind))
    .map((e) => {
      const sec = (e.t.startMs / 1000).toFixed(1)
      const who = e.actorId ?? '?'
      return `${sec}s - Fighter ${who} ${e.kind}`
    })

  return {
    combat_type: 'striking',
    techniques_observed,
    observed_facts: ledger.patterns.map((p) => `${p.kind}: ${p.summary}`),
    forbidden_claims: [],
    unknowns: [],
    video_quality_notes: [],
  }
}

/**
 * Deterministic merge:
 * - Striking: FightLang wins strike events; vision may annotate (forbidden_claims, quality).
 * - Grappling: Vision wins positions/techniques; FightLang contributes macro geometry only.
 */
export function mergeEvidence(input: {
  fightLang: FightEvidenceLedger | null
  visionLedger: FactualLedger | null
  provenance: SessionEvidenceProvenance
}): MergedLedger {
  const notes: string[] = []
  const { fightLang, visionLedger, provenance } = input

  if (!fightLang) {
    notes.push('No FightLang ledger — coaching will rely on vision only if present.')
    return {
      coachingLedger: {
        contractVersion: '1.0.0',
        generatedAtMs: 0,
        actors: [],
        geometry: [],
        kinematics: [],
        events: [],
        faults: [],
        patterns: [],
        actorStateTimeline: [],
        sequences: [],
        evidenceIndex: [],
      } as FightEvidenceLedger,
      visionFacts: visionLedger,
      mergeNotes: notes,
    }
  }

  if (provenance.mode === 'grappling') {
    const coachingLedger = stripGrapplingCompilerArtifacts(fightLang)
    const stripped = fightLang.events.length - coachingLedger.events.length
    if (stripped > 0) {
      notes.push(`Grappling mode: stripped ${stripped} striking-shaped compiler event(s).`)
    }
    notes.push('Grappling mode: vision ledger is source of truth for positions and techniques.')
    if (visionLedger?.video_analysis_ledger?.length) {
      notes.push(`Vision timeline: ${visionLedger.video_analysis_ledger.length} verified segment(s).`)
    }
    return { coachingLedger, visionFacts: visionLedger, mergeNotes: notes }
  }

  // Striking mode — FightLang wins; vision annotates only.
  let coachingLedger = fightLang
  if (visionLedger?.forbidden_claims?.length) {
    notes.push(`Vision audit attached ${visionLedger.forbidden_claims.length} forbidden claim(s).`)
  }
  if (visionLedger?.techniques_not_seen?.length) {
    notes.push(`Vision audit: ${visionLedger.techniques_not_seen.length} technique(s) explicitly not seen.`)
  }
  notes.push('Striking mode: FightLang events are primary; vision may remove or annotate only.')

  // If verification returned an explicit technique list, drop FightLang strikes absent from tape.
  if (visionLedger?.techniques_observed && visionLedger.techniques_observed.length > 0) {
    const verified = new Set(
      visionLedger.techniques_observed.map((t) => t.toLowerCase()),
    )
    const before = coachingLedger.events.length
    coachingLedger = {
      ...coachingLedger,
      events: coachingLedger.events.filter((e) => {
        if (!STRIKE_EVENT_KINDS.has(e.kind)) return true
        const needle = `${e.kind}`.toLowerCase()
        return [...verified].some((v) => v.includes(needle) || v.includes('strike') || v.includes('punch'))
      }),
    }
    const removed = before - coachingLedger.events.length
    if (removed > 0) {
      notes.push(`Vision verify removed ${removed} FightLang strike(s) not supported on tape.`)
    }
  }

  return { coachingLedger, visionFacts: visionLedger, mergeNotes: notes }
}

export function buildSessionEvidence(args: {
  fightLang: FightEvidenceLedger
  visionLedger: FactualLedger | null
  sport?: string | null
  clipType?: string | null
  poseEngine?: string | null
  poseQuality?: number | string | null
  videoSeen: boolean
  pose3DFrames?: ReadonlyArray<PoseFrame>
}): SessionEvidence {
  const mode = resolveEvidenceMode({ sport: args.sport, clipType: args.clipType })
  const provenance: SessionEvidenceProvenance = {
    poseEngine: args.poseEngine ?? null,
    poseQuality: args.poseQuality ?? null,
    videoSeen: args.videoSeen,
    sport: args.sport ?? null,
    clipType: args.clipType ?? null,
    mode,
  }
  return {
    fightLang: args.fightLang,
    visionLedger: args.visionLedger,
    merged: mergeEvidence({
      fightLang: args.fightLang,
      visionLedger: args.visionLedger,
      provenance,
    }),
    provenance,
    ...(args.pose3DFrames?.length ? { pose3DFrames: [...args.pose3DFrames] } : {}),
  }
}
