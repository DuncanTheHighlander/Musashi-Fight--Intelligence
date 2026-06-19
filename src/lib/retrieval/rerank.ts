import type { RetrievedSnippet, RetrievalNamespace } from './types'

const nsWeight: Record<RetrievalNamespace, number> = {
  ledger_summary: 1.0,
  prior_coaching: 0.75,
  style_drill_library: 0.9,
  video_segment: 0.85,
  outcome_memory: 0.70,
}

function recencyMultiplier(createdAt?: string | null): number {
  if (!createdAt) return 1.0
  const ageMs = Date.now() - new Date(createdAt).getTime()
  if (Number.isNaN(ageMs) || ageMs < 0) return 1.0
  const ageDays = ageMs / (1000 * 60 * 60 * 24)
  if (ageDays <= 7) return 1.15
  if (ageDays <= 30) return 1.05
  return 1.0
}

export function fusedRerank(snippets: RetrievedSnippet[]): RetrievedSnippet[] {
  const weighted = snippets.map((s) => ({
    ...s,
    score:
      s.score *
      (nsWeight[s.namespace] ?? 1.0) *
      recencyMultiplier((s.metadata as any)?.createdAt ?? null),
  }))

  weighted.sort((a, b) => b.score - a.score)

  const bestByClip = new Map<string, number>()
  return weighted.map((s) => {
    const clipKey = (s.metadata as any)?.clipId ?? s.docId
    const seenCount = bestByClip.get(clipKey) ?? 0
    bestByClip.set(clipKey, seenCount + 1)
    if (seenCount > 0 && s.namespace === 'video_segment') {
      return { ...s, score: s.score * 0.5 }
    }
    return s
  }).sort((a, b) => b.score - a.score)
}

/** @deprecated Use fusedRerank instead */
export function rerankSnippets(snippets: RetrievedSnippet[]): RetrievedSnippet[] {
  return fusedRerank(snippets)
}
