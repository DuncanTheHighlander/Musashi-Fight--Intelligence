import type { KinematicsSnapshot as ExistingKinematicsSnapshot } from '@/lib/kinematics'
import { makeEvidenceRef, makeId, makeTimeRangeMs } from '@/lib/fightlang/fightlang.ids'
import type { ActorId, EvidenceRef, KinematicSnapshot, RangeBand } from '@/lib/fightlang/fightlang.types'
import { rangeBandFromDistance } from '@/lib/fightlang/fightlang.defaults'

export type KinematicsAdapterOptions = Readonly<{
  evidenceSourceId?: string
}>

function toRangeBand(band: unknown): RangeBand {
  return band === 'close' || band === 'mid' || band === 'long' ? band : 'unknown'
}

export function kinematicSnapshotFromExisting(
  snap: ExistingKinematicsSnapshot,
  options?: KinematicsAdapterOptions
): KinematicSnapshot {
  const tMs = Math.round(snap.capturedAtMs)
  const videoTimeSec = typeof snap.videoTimeSec === 'number' ? snap.videoTimeSec : null

  const evBase = (actorId?: ActorId): EvidenceRef =>
    makeEvidenceRef({
      source: 'kinematics',
      actorId,
      t: makeTimeRangeMs(tMs),
      pointer: options?.evidenceSourceId,
      note: 'Kinematics snapshot derived from app pipeline.',
    })

  const range = snap.range
    ? {
        distanceBw: snap.range.distanceBw,
        closingBwps: snap.range.closingBwps,
        band: toRangeBand(snap.range.band),
      }
    : undefined

  return {
    tMs,
    actorId: undefined,
    videoTimeSec,
    actors: {
      A: snap.fighters.A
        ? {
            torsoScalePx: snap.fighters.A.torsoScalePx,
            handSpeedBwps: snap.fighters.A.handSpeedBwps,
            handBurstBwps: snap.fighters.A.handBurstBwps,
            footSpeedBwps: snap.fighters.A.footSpeedBwps,
            hipSpeedBwps: snap.fighters.A.hipSpeedBwps,
            powerIndex: snap.fighters.A.powerIndex,
          }
        : undefined,
      B: snap.fighters.B
        ? {
            torsoScalePx: snap.fighters.B.torsoScalePx,
            handSpeedBwps: snap.fighters.B.handSpeedBwps,
            handBurstBwps: snap.fighters.B.handBurstBwps,
            footSpeedBwps: snap.fighters.B.footSpeedBwps,
            hipSpeedBwps: snap.fighters.B.hipSpeedBwps,
            powerIndex: snap.fighters.B.powerIndex,
          }
        : undefined,
    },
    range,
    evidence: [evBase()],
  }
}

export function buildRangeFromDistance(distanceBw: number, closingBwps: number): NonNullable<KinematicSnapshot['range']> {
  return {
    distanceBw,
    closingBwps,
    band: rangeBandFromDistance(distanceBw),
  }
}

export function makePlaceholderRecoveryEventId(actorId: ActorId): string {
  return makeId(`recovery_${actorId}`)
}

