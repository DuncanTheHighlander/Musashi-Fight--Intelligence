import { embedText } from '@/lib/ai/gemini-embed'
import type { FactualLedger } from '@/lib/fightAnalysisPrompt'
import type { RetrievedContextBundle, RetrievedSnippet, RetrievalNamespace } from './types'
import { listCandidateDocs, listVideoCandidates } from './d1Store'
import { buildRetrievalQueryText } from './text'
import { fusedRerank } from './rerank'
import { InMemoryRetrievalStore } from '@/lib/retrieval/retrieval'
import { seedFightKnowledge } from '@/lib/retrieval/fight-knowledge-seed'

let ledgerFallbackStore: InMemoryRetrievalStore | null = null
let ledgerFallbackSeed: Promise<void> | null = null

async function getLedgerFallbackStore(): Promise<InMemoryRetrievalStore> {
  if (!ledgerFallbackStore) ledgerFallbackStore = new InMemoryRetrievalStore()
  if (!ledgerFallbackSeed) {
    ledgerFallbackSeed = seedFightKnowledge(ledgerFallbackStore).catch((e) => {
      console.warn('[Retrieval] ledger fallback seed failed:', e instanceof Error ? e.message : e)
    })
  }
  await ledgerFallbackSeed
  return ledgerFallbackStore
}

type D1Database = {
  prepare: (query: string) => {
    bind: (...args: any[]) => {
      all: <T = any>() => Promise<{ results: T[] }>
      first: <T = any>() => Promise<T | null>
      run: () => Promise<{ success: boolean; meta: Record<string, any> }>
    }
  }
}

const dot = (a: number[], b: number[]): number => {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i] * b[i]
  return s
}

const norm = (a: number[]): number => Math.sqrt(dot(a, a))

const cosine = (a: number[], b: number[]): number => {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return 0
  return dot(a, b) / (na * nb)
}

export async function retrieveForLedger(args: {
  db: D1Database | null
  userId: string
  ledger: FactualLedger | null
  userIntent?: string
  namespaces?: RetrievalNamespace[]
  topK?: number
  topKVideo?: number
  candidateLimit?: number
  videoCandidateLimit?: number
}): Promise<RetrievedContextBundle> {
  const queryText = buildRetrievalQueryText({ ledger: args.ledger, userIntent: args.userIntent })
  const topK = Math.max(1, Math.min(12, args.topK ?? 6))
  const topKVideo = Math.max(0, Math.min(8, args.topKVideo ?? 4))
  const candidateLimit = Math.max(20, Math.min(300, args.candidateLimit ?? 160))
  const videoCandidateLimit = Math.max(10, Math.min(200, args.videoCandidateLimit ?? 80))

  const textNamespaces: RetrievalNamespace[] =
    args.namespaces && args.namespaces.length
      ? args.namespaces.filter((ns) => ns !== 'video_segment')
      : ['ledger_summary', 'prior_coaching', 'style_drill_library']

  const queryEmbeddingModel = (process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-2-preview') as string
  const queryVec = (await embedText(queryText, { taskType: 'RETRIEVAL_QUERY' })) as number[]

  if (!args.db) {
    const store = await getLedgerFallbackStore()
    const textCandidates = await store.listCandidates({
      namespaces: ['style_drill_library'],
      limit: candidateLimit,
    })
    const textScored: RetrievedSnippet[] = textCandidates
      .filter((d) => Array.isArray(d.embedding) && d.embedding.length > 0)
      .map((d) => ({
        docId: d.id,
        namespace: 'style_drill_library',
        score: cosine(queryVec, d.embedding as number[]),
        title: null,
        text: d.text,
        metadata: { ...(d.metadata ?? {}) },
      }))
    const reranked = fusedRerank(textScored)
    const out: RetrievedSnippet[] = []
    const seen = new Set<string>()
    for (const s of reranked) {
      if (seen.has(s.docId)) continue
      if (s.score < 0.15) continue
      seen.add(s.docId)
      out.push(s)
      if (out.length >= topK + topKVideo) break
    }
    return { queryText, queryEmbeddingModel, topK: topK + topKVideo, snippets: out }
  }

  // ── Text channel ────────────────────────────────────────────────────────
  const textCandidates = await listCandidateDocs(args.db, {
    userId: args.userId,
    namespaces: textNamespaces,
    limit: candidateLimit,
  })

  const textScored: RetrievedSnippet[] = textCandidates
    .filter((d) => Array.isArray(d.embedding) && d.embedding.length > 0)
    .map((d) => ({
      docId: d.id,
      namespace: d.namespace,
      score: cosine(queryVec, d.embedding as number[]),
      title: d.title ?? null,
      text: d.text,
      metadata: { ...d.metadata, createdAt: d.createdAt, clipId: d.clipId },
    }))

  // ── Video channel (cross-modal: text query vec vs video doc vecs) ───────
  const videoCandidates = await listVideoCandidates(args.db, {
    userId: args.userId,
    limit: videoCandidateLimit,
  })

  const videoScored: RetrievedSnippet[] = videoCandidates
    .filter((d) => Array.isArray(d.embedding) && d.embedding.length > 0)
    .map((d) => ({
      docId: d.id,
      namespace: 'video_segment' as const,
      score: cosine(queryVec, d.embedding as number[]),
      title: d.title ?? null,
      text: d.text,
      metadata: { ...d.metadata, createdAt: d.createdAt, clipId: d.clipId },
      segmentStartMs: d.segmentStartMs ?? null,
      segmentEndMs: d.segmentEndMs ?? null,
      sourceFileUri: d.sourceFileUri ?? null,
    }))

  // ── Fuse + rerank ───────────────────────────────────────────────────────
  const allScored = [...textScored, ...videoScored]
  const reranked = fusedRerank(allScored)

  const out: RetrievedSnippet[] = []
  const seen = new Set<string>()
  for (const s of reranked) {
    if (seen.has(s.docId)) continue
    if (s.score < 0.15) continue
    seen.add(s.docId)
    out.push(s)
    if (out.length >= topK + topKVideo) break
  }

  return { queryText, queryEmbeddingModel, topK: topK + topKVideo, snippets: out }
}
