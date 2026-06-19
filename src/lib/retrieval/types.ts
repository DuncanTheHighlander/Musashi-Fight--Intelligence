export type RetrievalNamespace =
  | 'ledger_summary'
  | 'prior_coaching'
  | 'style_drill_library'
  | 'video_segment'
  | 'outcome_memory'

export type RetrievalDoc = {
  id: string
  userId: string
  namespace: RetrievalNamespace
  sourceId?: string | null
  sessionId?: string | null
  clipId?: string | null
  title?: string | null
  text: string
  metadata?: Record<string, unknown>
  embedding?: number[]
  embeddingModel?: string | null
  mediaKind?: 'text' | 'video_segment'
  sourceFileUri?: string | null
  segmentStartMs?: number | null
  segmentEndMs?: number | null
  createdAt?: string | null
  updatedAt?: string | null
}

export type VideoSegmentDoc = {
  id: string
  userId: string
  sessionId: string
  clipId: string
  sourceFileUri: string
  mimeType: string
  segmentStartMs: number
  segmentEndMs: number
  displayText: string
  embedding: number[]
  embeddingModel: string
  metadata: Record<string, unknown>
  createdAt?: string | null
}

export type RetrievedSnippet = {
  docId: string
  namespace: RetrievalNamespace
  score: number
  title?: string | null
  text: string
  metadata?: Record<string, unknown>
  segmentStartMs?: number | null
  segmentEndMs?: number | null
  sourceFileUri?: string | null
}

export type RetrievedContextBundle = {
  queryText: string
  queryEmbeddingModel: string
  topK: number
  snippets: RetrievedSnippet[]
}
