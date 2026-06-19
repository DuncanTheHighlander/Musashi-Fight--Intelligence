import { embedText } from '@/lib/ai/gemini-embed'
import { makeId } from '@/lib/fightlang/fightlang.ids'
import type { FightEvidenceLedger } from '@/lib/fightlang/fightlang.types'

export type RetrievalNamespace = 'fightlang_ledger' | 'fightlang_coaching' | 'style_drill_library'

export type RetrievalDoc = Readonly<{
  id: string
  namespace: RetrievalNamespace
  text: string
  embedding: number[]
  embeddingModel: string
  metadata?: Record<string, unknown>
  createdAtMs: number
}>

export type RetrievedSnippet = Readonly<{
  docId: string
  namespace: RetrievalNamespace
  score: number
  text: string
  metadata?: Record<string, unknown>
}>

export type RetrievedContextBundle = Readonly<{
  queryText: string
  queryEmbeddingModel: string
  topK: number
  snippets: RetrievedSnippet[]
}>

const dot = (a: number[], b: number[]): number => {
  let s = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!
  return s
}
const norm = (a: number[]): number => Math.sqrt(dot(a, a))
const cosine = (a: number[], b: number[]): number => {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return 0
  return dot(a, b) / (na * nb)
}

export interface RetrievalStore {
  upsert(doc: Omit<RetrievalDoc, 'id' | 'createdAtMs'> & { id?: string }): Promise<RetrievalDoc>
  listCandidates(args: { namespaces: RetrievalNamespace[]; limit: number }): Promise<RetrievalDoc[]>
}

export class InMemoryRetrievalStore implements RetrievalStore {
  private docs: RetrievalDoc[] = []

  async upsert(doc: Omit<RetrievalDoc, 'id' | 'createdAtMs'> & { id?: string }): Promise<RetrievalDoc> {
    const id = doc.id ?? makeId('rdoc')
    const now = Date.now()
    const next: RetrievalDoc = { ...doc, id, createdAtMs: now }
    const idx = this.docs.findIndex((d) => d.id === id)
    if (idx >= 0) this.docs[idx] = next
    else this.docs.push(next)
    return next
  }

  async listCandidates(args: { namespaces: RetrievalNamespace[]; limit: number }): Promise<RetrievalDoc[]> {
    const set = new Set(args.namespaces)
    return this.docs.filter((d) => set.has(d.namespace)).slice(-args.limit)
  }
}

export function summarizeLedgerForRetrieval(ledger: FightEvidenceLedger): string {
  const actors = ledger.actors.join(' and ')

  const faultDescriptions: Record<string, string> = {
    guard_low: 'guard dropping, hands falling below chin',
    chin_exposed: 'chin exposed past the base line',
    overextension: 'overextending punches, reaching past base',
    compromised_base: 'compromised base, narrow stance, off balance',
    square_in_pocket: 'squared up in the pocket',
    rhythm_flat: 'flat rhythm, no bounce variation',
  }
  const faultLines = ledger.faults
    .slice(0, 12)
    .map((f) => {
      const desc = faultDescriptions[f.kind] || f.message || f.kind
      return `Fighter ${f.actorId ?? '?'} has ${desc} (${f.severity})`
    })

  const patternDescriptions: Record<string, string> = {
    guard_drop_before_entry: 'drops guard before entering range — counter opportunity',
    linear_retreat: 'retreating in a straight line instead of circling',
    one_beat_entry: 'entering with the same timing every time — predictable',
    predictable_reset: 'predictable reset pattern after exchanges',
    circling: 'lateral movement, circling the opponent',
    ring_cutting: 'cutting off the ring to trap opponent',
  }
  const patternLines = ledger.patterns
    .slice(0, 8)
    .map((p) => {
      const desc = patternDescriptions[p.kind] || p.summary || p.kind
      return `Fighter ${p.actorId ?? '?'}: ${desc}`
    })

  const stateSnap = ledger.actorStateTimeline.length > 0
    ? ledger.actorStateTimeline.slice(-2).map((s) =>
        `Fighter ${s.actorId}: ${s.stanceSide} stance, ${s.guard} guard${s.rangeToOther ? `, ${s.rangeToOther} range` : ''}`
      )
    : []

  const eventKinds = new Map<string, number>()
  for (const e of ledger.events.slice(0, 100)) {
    eventKinds.set(e.kind, (eventKinds.get(e.kind) ?? 0) + 1)
  }
  const eventSummary = Array.from(eventKinds.entries())
    .filter(([k]) => k !== 'stance' && k !== 'guard' && k !== 'range')
    .map(([k, n]) => `${n}× ${k.replace(/_/g, ' ')}`)
    .join(', ')

  return [
    `Fight analysis of ${actors}.`,
    ledger.clip?.durationMs ? `Clip duration: ${(ledger.clip.durationMs / 1000).toFixed(1)} seconds.` : '',
    stateSnap.length ? `Current state: ${stateSnap.join('. ')}.` : '',
    eventSummary ? `Events detected: ${eventSummary}.` : '',
    faultLines.length ? `Faults: ${faultLines.join('. ')}.` : '',
    patternLines.length ? `Patterns: ${patternLines.join('. ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export async function retrieveSimilarContext(args: {
  store: RetrievalStore | null
  ledger: FightEvidenceLedger
  userIntent?: string
  namespaces?: RetrievalNamespace[]
  topK?: number
  candidateLimit?: number
}): Promise<RetrievedContextBundle> {
  const namespaces = args.namespaces?.length
    ? args.namespaces
    : (['fightlang_ledger', 'fightlang_coaching', 'style_drill_library'] as RetrievalNamespace[])
  const topK = Math.max(1, Math.min(12, args.topK ?? 6))
  const candidateLimit = Math.max(20, Math.min(300, args.candidateLimit ?? 160))

  const intentLine = args.userIntent?.trim() || 'Analyze fight for coaching: openings, counters, habits, range control.'
  const queryText = [
    intentLine,
    '',
    summarizeLedgerForRetrieval(args.ledger),
  ].join('\n')

  const queryEmbeddingModel = (process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-2-preview') as string

  if (!args.store) return { queryText, queryEmbeddingModel, topK, snippets: [] }

  const queryVec = (await embedText(queryText, { taskType: 'RETRIEVAL_QUERY' })) as number[]

  const candidates = await args.store.listCandidates({ namespaces, limit: candidateLimit })
  const scored = candidates
    .filter((d) => Array.isArray(d.embedding) && d.embedding.length > 0)
    .map(
      (d): RetrievedSnippet => ({
        docId: d.id,
        namespace: d.namespace,
        score: cosine(queryVec, d.embedding),
        text: d.text,
        metadata: d.metadata,
      })
    )
    .sort((a, b) => b.score - a.score)

  const out: RetrievedSnippet[] = []
  const seen = new Set<string>()
  for (const s of scored) {
    if (seen.has(s.docId)) continue
    if (s.score < 0.12) continue
    seen.add(s.docId)
    out.push(s)
    if (out.length >= topK) break
  }

  return { queryText, queryEmbeddingModel, topK, snippets: out }
}

