import { embedVideo } from '@/lib/ai/gemini-embed'
import { upsertVideoSegmentDoc } from './d1Store'
import type { VideoSegmentDoc } from './types'

type D1Database = {
  prepare: (query: string) => {
    bind: (...args: any[]) => {
      all: <T = any>() => Promise<{ results: T[] }>
      first: <T = any>() => Promise<T | null>
      run: () => Promise<{ success: boolean; meta: Record<string, any> }>
    }
  }
}

export type SegmentWindow = { startMs: number; endMs: number }

export function planSegments(
  totalDurationMs: number,
  opts?: { maxSegmentMs?: number; overlapMs?: number }
): SegmentWindow[] {
  const maxSeg = opts?.maxSegmentMs ?? 10_000
  const overlap = opts?.overlapMs ?? 2_000

  if (totalDurationMs <= 0) return []
  if (totalDurationMs <= maxSeg) return [{ startMs: 0, endMs: totalDurationMs }]

  const stride = Math.max(1000, maxSeg - overlap)
  const windows: SegmentWindow[] = []
  let cursor = 0

  while (cursor < totalDurationMs) {
    const endMs = Math.min(cursor + maxSeg, totalDurationMs)
    windows.push({ startMs: cursor, endMs })
    if (endMs >= totalDurationMs) break
    cursor += stride
  }

  return windows
}

export async function embedAndStoreSegments(args: {
  db: D1Database | null
  userId: string
  sessionId: string
  clipId: string
  fileUri: string
  mimeType: string
  totalDurationMs: number
  metadata?: Record<string, unknown>
}): Promise<{ stored: number; errors: number }> {
  if (!args.db) return { stored: 0, errors: 0 }

  const segments = planSegments(args.totalDurationMs)
  if (segments.length === 0) return { stored: 0, errors: 0 }

  const embeddingModel = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-2-preview'
  let stored = 0
  let errors = 0

  for (const seg of segments) {
    try {
      const vec = await embedVideo(
        { kind: 'file', fileUri: args.fileUri, mimeType: args.mimeType },
        { taskType: 'RETRIEVAL_DOCUMENT' }
      )

      const doc: VideoSegmentDoc = {
        id: `vseg_${args.clipId}_${seg.startMs}_${seg.endMs}`,
        userId: args.userId,
        sessionId: args.sessionId,
        clipId: args.clipId,
        sourceFileUri: args.fileUri,
        mimeType: args.mimeType,
        segmentStartMs: seg.startMs,
        segmentEndMs: seg.endMs,
        displayText: `clip ${args.clipId} ${(seg.startMs / 1000).toFixed(1)}s–${(seg.endMs / 1000).toFixed(1)}s`,
        embedding: vec,
        embeddingModel,
        metadata: {
          ...(args.metadata || {}),
          sessionId: args.sessionId,
          totalDurationMs: args.totalDurationMs,
        },
      }

      await upsertVideoSegmentDoc(args.db, doc)
      stored++
    } catch {
      errors++
    }
  }

  return { stored, errors }
}
