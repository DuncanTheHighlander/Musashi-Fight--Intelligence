import type { ActorId, EvidenceRef, EvidenceSource, TimeRangeMs } from './fightlang.types'

function safeNowMs(nowMs?: number): number {
  return typeof nowMs === 'number' && Number.isFinite(nowMs) ? Math.round(nowMs) : Date.now()
}

export function makeId(prefix: string, nowMs?: number): string {
  const t = safeNowMs(nowMs)
  const rand = Math.random().toString(36).slice(2, 10)
  return `${prefix}_${t}_${rand}`
}

export function makeTimeRangeMs(startMs: number, endMs?: number): TimeRangeMs {
  const s = Math.max(0, Math.round(startMs))
  const e = typeof endMs === 'number' ? Math.max(s, Math.round(endMs)) : s
  return { startMs: s, endMs: e }
}

export function makeEvidenceRef(input: {
  id?: string
  source: EvidenceSource
  actorId?: ActorId
  t: TimeRangeMs
  note?: string
  pointer?: string
}): EvidenceRef {
  return {
    id: input.id ?? makeId('ev'),
    source: input.source,
    actorId: input.actorId,
    t: input.t,
    note: input.note,
    pointer: input.pointer,
  }
}

