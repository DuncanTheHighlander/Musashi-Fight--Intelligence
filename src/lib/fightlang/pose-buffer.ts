import type { PoseFrame } from '@/lib/fightlang/fightlang.types'

/** Keep one sample per time bucket (ms) so loops/replays don't duplicate the timeline. */
export function dedupePoseFramesByVideoMs(frames: ReadonlyArray<PoseFrame>, bucketMs = 100): PoseFrame[] {
  if (frames.length === 0) return []
  const sorted = [...frames].sort((a, b) => a.tMs - b.tMs)
  const byBucket = new Map<number, PoseFrame>()
  for (const f of sorted) {
    const bucket = Math.floor(f.tMs / bucketMs) * bucketMs
    byBucket.set(bucket, f)
  }
  return Array.from(byBucket.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, f]) => f)
}

/** Sliding window ending at the latest frame (for live analysis). */
export function slicePoseFramesWindow(frames: ReadonlyArray<PoseFrame>, windowMs: number): PoseFrame[] {
  if (frames.length === 0) return []
  const endMs = frames[frames.length - 1]!.tMs
  const startMs = Math.max(0, endMs - windowMs)
  const raw = frames.filter((f) => f.tMs >= startMs && f.tMs <= endMs)
  return dedupePoseFramesByVideoMs(raw, 100)
}

/** Full clip [0, durationMs] — best for replay / end-of-clip pass. */
export function slicePoseFramesFullClip(frames: ReadonlyArray<PoseFrame>, durationMs: number): PoseFrame[] {
  if (frames.length === 0 || durationMs <= 0) return []
  const raw = frames.filter((f) => f.tMs >= 0 && f.tMs <= durationMs + 150)
  return dedupePoseFramesByVideoMs(raw, 100)
}

/** True when pose data reaches near the end of the file (full watch or replay filled gaps). */
export function hasNearFullClipCoverage(frames: ReadonlyArray<PoseFrame>, durationMs: number): boolean {
  if (frames.length === 0 || durationMs <= 0) return false
  const d = dedupePoseFramesByVideoMs(frames, 100)
  if (d.length < 6) return false
  const lastT = d[d.length - 1]!.tMs
  return lastT >= durationMs - 450
}
