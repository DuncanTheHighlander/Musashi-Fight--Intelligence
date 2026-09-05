import { requireUser, type MusashiUser } from '@/lib/musashiAuth'
import { embedText } from '@/lib/ai/gemini-embed'
import { getDb, getDbOrNull } from '@/lib/db'

type VectorizeLike = {
  insert: (vectors: VectorizeVector[]) => Promise<VectorizeMutationResult>
  upsert: (vectors: VectorizeVector[]) => Promise<VectorizeMutationResult>
  query: (vector: number[], options?: VectorizeQueryOptions) => Promise<VectorizeMatches>
  deleteByIds: (ids: string[]) => Promise<VectorizeMutationResult>
}

type VectorizeVector = {
  id: string
  values: number[]
  metadata?: Record<string, string | number | boolean>
}

type VectorizeMutationResult = {
  mutationId: string
  count: number
}

type VectorizeQueryOptions = {
  topK?: number
  filter?: Record<string, any>
  returnValues?: boolean
  returnMetadata?: boolean
}

type VectorizeMatch = {
  id: string
  score: number
  values?: number[]
  metadata?: Record<string, any>
}

type VectorizeMatches = {
  matches: VectorizeMatch[]
  count: number
}

const getVectorize = (): VectorizeLike | null => {
  const vec = (process.env.VECTORIZE as any) as VectorizeLike
  if (!vec?.query) {
    return null
  }
  return vec
}

export type LibraryDocument = {
  id: string
  title: string
  sourceType: 'manual' | 'url' | 'file' | 'api'
  author: string | null
  tags: string[]
  status: 'pending' | 'processing' | 'ready' | 'error'
  /** Moderation state — only 'approved' documents feed AI coaching retrieval. */
  reviewState: 'pending' | 'approved' | 'rejected'
  content: string
  chunkCount: number
  vectorCount: number
  metadata: Record<string, any>
  createdAt: string
  updatedAt: string
}

export type LibraryChunk = {
  id: string
  documentId: string
  chunkIndex: number
  content: string
  vectorId: string | null
  metadata: Record<string, any>
  createdAt: string
}

export type LibraryIngestion = {
  id: string
  documentId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  error: string | null
  attempts: number
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ActivityLogEntry = {
  id: string
  type: 'library' | 'chat' | 'analyze' | 'reflex' | 'track' | 'auth'
  subtype: string | null
  referenceId: string | null
  metadata: Record<string, any>
  createdAt: string
}

const CHUNK_SIZE = 512
const CHUNK_OVERLAP = 64

const chunkText = (text: string): string[] => {
  const chunks: string[] = []
  const words = text.split(/\s+/)
  
  let currentChunk: string[] = []
  let currentLength = 0
  
  for (const word of words) {
    if (currentLength + word.length > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk.join(' '))
      const overlapWords = Math.floor(currentChunk.length * (CHUNK_OVERLAP / CHUNK_SIZE))
      currentChunk = currentChunk.slice(-overlapWords)
      currentLength = currentChunk.join(' ').length
    }
    currentChunk.push(word)
    currentLength += word.length + 1
  }
  
  if (currentChunk.length > 0) {
    chunks.push(currentChunk.join(' '))
  }
  
  return chunks
}

export const createDocument = async (params: {
  title: string
  content: string
  sourceType?: 'manual' | 'url' | 'file' | 'api'
  author?: string
  tags?: string[]
  metadata?: Record<string, any>
  /** Moderation state. Defaults to 'pending' — callers pass 'approved' only for
   *  trusted authors (e.g. admin-created docs). */
  reviewState?: 'pending' | 'approved' | 'rejected'
}): Promise<LibraryDocument> => {
  const db = getDb()
  const id = crypto.randomUUID()
  const now = new Date().toISOString()

  const doc: LibraryDocument = {
    id,
    title: params.title,
    sourceType: params.sourceType || 'manual',
    author: params.author || null,
    tags: params.tags || [],
    status: 'pending',
    reviewState: params.reviewState || 'pending',
    content: params.content,
    chunkCount: 0,
    vectorCount: 0,
    metadata: params.metadata || {},
    createdAt: now,
    updatedAt: now,
  }

  await db
    .prepare(
      `INSERT INTO musashi_library_documents
       (id, title, source_type, author, tags, status, review_state, content, chunk_count, vector_count, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      doc.id,
      doc.title,
      doc.sourceType,
      doc.author,
      JSON.stringify(doc.tags),
      doc.status,
      doc.reviewState,
      doc.content,
      doc.chunkCount,
      doc.vectorCount,
      JSON.stringify(doc.metadata),
      doc.createdAt,
      doc.updatedAt
    )
    .run()
  
  const ingestionId = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO musashi_library_ingestions (id, document_id, status, attempts, created_at, updated_at)
       VALUES (?, ?, 'pending', 0, ?, ?)`
    )
    .bind(ingestionId, doc.id, now, now)
    .run()
  
  await logActivity('library', 'document_created', doc.id, { title: doc.title })
  
  // Auto-trigger ingestion so the document gets chunked and vectorized immediately
  try {
    await processIngestion(ingestionId)
  } catch (e) {
    // Non-fatal: document is created, ingestion can be retried later
    console.warn('Auto-ingestion failed (will retry later):', e instanceof Error ? e.message : String(e))
  }
  
  return doc
}

export const getDocument = async (id: string): Promise<LibraryDocument | null> => {
  const db = getDb()
  const row = await db
    .prepare('SELECT * FROM musashi_library_documents WHERE id = ?')
    .bind(id)
    .first()
  
  if (!row) return null
  
  return rowToDocument(row)
}

export const listDocuments = async (params?: {
  status?: string
  limit?: number
  offset?: number
}): Promise<{ documents: LibraryDocument[]; total: number }> => {
  const db = getDb()
  const limit = params?.limit || 50
  const offset = params?.offset || 0
  
  let query = 'SELECT * FROM musashi_library_documents'
  let countQuery = 'SELECT COUNT(*) as count FROM musashi_library_documents'
  const binds: any[] = []
  
  if (params?.status) {
    query += ' WHERE status = ?'
    countQuery += ' WHERE status = ?'
    binds.push(params.status)
  }
  
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
  binds.push(limit, offset)
  
  const [rows, countRow] = await Promise.all([
    db.prepare(query).bind(...binds).all(),
    db.prepare(countQuery).bind(...(params?.status ? [params.status] : [])).first(),
  ])
  
  const documents = (rows?.results || []).map(rowToDocument)
  const total = Number(countRow?.count || 0)
  
  return { documents, total }
}

/** Documents awaiting admin moderation (review_state = 'pending'), newest first. */
export const listPendingReviewDocuments = async (
  limit = 50,
): Promise<LibraryDocument[]> => {
  const db = getDb()
  const rows = await db
    .prepare(
      `SELECT * FROM musashi_library_documents
       WHERE review_state = 'pending'
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all()
  return (rows?.results || []).map(rowToDocument)
}

/** Approve or reject a submitted document. Only 'approved' docs feed the AI. */
export const setDocumentReviewState = async (
  id: string,
  reviewState: 'approved' | 'rejected',
): Promise<boolean> => {
  const db = getDb()
  const existing = await db
    .prepare('SELECT id FROM musashi_library_documents WHERE id = ?')
    .bind(id)
    .first()
  if (!existing) return false
  const now = new Date().toISOString()
  await db
    .prepare(
      'UPDATE musashi_library_documents SET review_state = ?, updated_at = ? WHERE id = ?',
    )
    .bind(reviewState, now, id)
    .run()
  await logActivity('library', `document_${reviewState}`, id, {})
  return true
}

export const deleteDocument = async (id: string): Promise<void> => {
  const db = getDb()
  const vectorize = getVectorize()
  
  const chunks = await db
    .prepare('SELECT vector_id FROM musashi_library_chunks WHERE document_id = ? AND vector_id IS NOT NULL')
    .bind(id)
    .all()
  
  const vectorIds = (chunks?.results || [])
    .map((r: any) => r.vector_id)
    .filter(Boolean)
  
  if (vectorize && vectorIds.length > 0) {
    try {
      await vectorize.deleteByIds(vectorIds)
    } catch {
      // Continue even if vector deletion fails
    }
  }
  
  await db.prepare('DELETE FROM musashi_library_documents WHERE id = ?').bind(id).run()
  
  await logActivity('library', 'document_deleted', id, {})
}

export const processIngestion = async (ingestionId: string): Promise<void> => {
  const db = getDb()
  const vectorize = getVectorize()
  const now = new Date().toISOString()
  
  await db
    .prepare(
      `UPDATE musashi_library_ingestions 
       SET status = 'processing', started_at = ?, attempts = attempts + 1, updated_at = ?
       WHERE id = ?`
    )
    .bind(now, now, ingestionId)
    .run()
  
  const ingestion = await db
    .prepare('SELECT * FROM musashi_library_ingestions WHERE id = ?')
    .bind(ingestionId)
    .first()
  
  if (!ingestion) {
    throw new Error('Ingestion not found')
  }
  
  const documentId = String(ingestion.document_id)
  
  try {
    const doc = await getDocument(documentId)
    if (!doc) {
      throw new Error('Document not found')
    }
    
    const chunks = chunkText(doc.content)
    
    for (let i = 0; i < chunks.length; i++) {
      const chunkId = crypto.randomUUID()
      let vectorId: string | null = null
      
      if (vectorize) {
        try {
          const embedding = (await embedText(chunks[i]!, { taskType: 'RETRIEVAL_DOCUMENT' })) as number[]

          if (Array.isArray(embedding) && embedding.length > 0) {
            vectorId = `chunk_${chunkId}`
            await vectorize.upsert([
              {
                id: vectorId,
                values: embedding,
                metadata: {
                  documentId,
                  chunkIndex: i,
                  title: doc.title,
                },
              },
            ])
          }
        } catch (e) {
          console.error('Vectorize error:', e)
        }
      }
      
      await db
        .prepare(
          `INSERT INTO musashi_library_chunks (id, document_id, chunk_index, content, vector_id, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(chunkId, documentId, i, chunks[i], vectorId, '{}', now)
        .run()
    }
    
    const vectorCount = vectorize
      ? (await db.prepare('SELECT COUNT(*) as c FROM musashi_library_chunks WHERE document_id = ? AND vector_id IS NOT NULL').bind(documentId).first())?.c || 0
      : 0
    
    await db
      .prepare(
        `UPDATE musashi_library_documents 
         SET status = 'ready', chunk_count = ?, vector_count = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(chunks.length, vectorCount, now, documentId)
      .run()
    
    await db
      .prepare(
        `UPDATE musashi_library_ingestions 
         SET status = 'completed', completed_at = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(now, now, ingestionId)
      .run()
    
    await logActivity('library', 'ingestion_completed', documentId, {
      chunkCount: chunks.length,
      vectorCount,
    })
    
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : 'Unknown error'
    
    await db
      .prepare(
        `UPDATE musashi_library_ingestions 
         SET status = 'failed', error = ?, updated_at = ?
         WHERE id = ?`
      )
      .bind(errorMsg, now, ingestionId)
      .run()
    
    await db
      .prepare(`UPDATE musashi_library_documents SET status = 'error', updated_at = ? WHERE id = ?`)
      .bind(now, documentId)
      .run()
    
    await logActivity('library', 'ingestion_failed', documentId, { error: errorMsg })
    
    throw e
  }
}

export const getPendingIngestions = async (limit = 10): Promise<LibraryIngestion[]> => {
  const db = getDb()
  const rows = await db
    .prepare(
      `SELECT * FROM musashi_library_ingestions 
       WHERE status = 'pending' 
       ORDER BY created_at ASC 
       LIMIT ?`
    )
    .bind(limit)
    .all()
  
  return (rows?.results || []).map(rowToIngestion)
}

export const searchKnowledge = async (
  query: string,
  options?: { topK?: number; filter?: Record<string, any> }
): Promise<{ chunks: LibraryChunk[]; scores: number[] }> => {
  const vectorize = getVectorize()
  const db = getDbOrNull()
  
  if (!db) {
    return { chunks: [], scores: [] }
  }

  if (!vectorize) {
    const rows = await db
      .prepare(
        `SELECT c.*, d.title as doc_title
         FROM musashi_library_chunks c
         JOIN musashi_library_documents d ON c.document_id = d.id
         WHERE c.content LIKE ?
           AND d.review_state = 'approved'
         LIMIT ?`
      )
      .bind(`%${query}%`, options?.topK || 5)
      .all()
    
    const chunks = (rows?.results || []).map(rowToChunk)
    return { chunks, scores: chunks.map(() => 1.0) }
  }
  
  const queryEmbedding = (await embedText(query, { taskType: 'RETRIEVAL_QUERY' })) as number[]
  
  if (!Array.isArray(queryEmbedding) || queryEmbedding.length === 0) {
    return { chunks: [], scores: [] }
  }
  
  const matches = await vectorize.query(queryEmbedding, {
    topK: options?.topK || 5,
    returnMetadata: true,
  })
  
  if (!matches?.matches?.length) {
    return { chunks: [], scores: [] }
  }
  
  const vectorIds = matches.matches.map((m) => m.id)
  const placeholders = vectorIds.map(() => '?').join(',')
  
  // Filter to APPROVED documents only — a pending/rejected submission may have
  // been embedded into Vectorize, so the moderation gate is enforced here at
  // retrieval, not just at ingestion. Without this join, unvetted user content
  // would leak into AI coaching.
  const rows = await db
    .prepare(
      `SELECT c.* FROM musashi_library_chunks c
       JOIN musashi_library_documents d ON c.document_id = d.id
       WHERE c.vector_id IN (${placeholders})
         AND d.review_state = 'approved'`
    )
    .bind(...vectorIds)
    .all()

  const chunkMap = new Map((rows?.results || []).map((r: any) => [r.vector_id, rowToChunk(r)]))
  
  const chunks: LibraryChunk[] = []
  const scores: number[] = []
  
  for (const match of matches.matches) {
    const chunk = chunkMap.get(match.id) as any
    if (chunk && chunk.id) {
      chunks.push(chunk)
      scores.push(match.score)
    }
  }
  
  return { chunks, scores }
}

export const getKnowledgeContext = async (
  query: string,
  maxTokens = 2000
): Promise<string> => {
  const { chunks, scores } = await searchKnowledge(query, { topK: 8 })
  
  if (chunks.length === 0) {
    return ''
  }
  
  let context = '## Relevant Knowledge Base Context\n\n'
  let currentLength = context.length
  
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const score = scores[i]
    const entry = `**[Relevance: ${(score * 100).toFixed(0)}%]**\n${chunk.content}\n\n`
    
    if (currentLength + entry.length > maxTokens * 4) break
    
    context += entry
    currentLength += entry.length
  }
  
  return context
}

export const logActivity = async (
  type: string,
  subtype: string | null,
  referenceId: string | null,
  metadata: Record<string, any>
): Promise<void> => {
  const db = getDbOrNull()
  if (!db) return
  const now = new Date().toISOString()
  
  await db
    .prepare(
      `INSERT INTO musashi_activity_log (id, type, subtype, reference_id, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), type, subtype, referenceId, JSON.stringify(metadata), now)
    .run()
}

export const getRecentActivity = async (limit = 20): Promise<ActivityLogEntry[]> => {
  const db = getDb()
  const rows = await db
    .prepare('SELECT * FROM musashi_activity_log ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all()
  
  return (rows?.results || []).map(rowToActivity)
}

export const getActivityStats = async (): Promise<{
  today: { library: number; chat: number; analyze: number }
  week: { library: number; chat: number; analyze: number }
  documentCount: number
  chunkCount: number
}> => {
  const db = getDb()
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()
  
  const [todayRows, weekRows, docCount, chunkCount] = await Promise.all([
    db.prepare(`SELECT type, COUNT(*) as c FROM musashi_activity_log WHERE created_at >= ? GROUP BY type`).bind(todayStart).all(),
    db.prepare(`SELECT type, COUNT(*) as c FROM musashi_activity_log WHERE created_at >= ? GROUP BY type`).bind(weekStart).all(),
    db.prepare('SELECT COUNT(*) as c FROM musashi_library_documents WHERE status = ?').bind('ready').first(),
    db.prepare('SELECT COUNT(*) as c FROM musashi_library_chunks').bind().first(),
  ])
  
  const todayMap = Object.fromEntries((todayRows?.results || []).map((r: any) => [r.type, Number(r.c)]))
  const weekMap = Object.fromEntries((weekRows?.results || []).map((r: any) => [r.type, Number(r.c)]))
  
  return {
    today: {
      library: todayMap.library || 0,
      chat: todayMap.chat || 0,
      analyze: todayMap.analyze || 0,
    },
    week: {
      library: weekMap.library || 0,
      chat: weekMap.chat || 0,
      analyze: weekMap.analyze || 0,
    },
    documentCount: Number(docCount?.c || 0),
    chunkCount: Number(chunkCount?.c || 0),
  }
}

const rowToDocument = (row: any): LibraryDocument => ({
  id: String(row.id),
  title: String(row.title),
  sourceType: row.source_type as LibraryDocument['sourceType'],
  author: row.author ? String(row.author) : null,
  tags: JSON.parse(row.tags || '[]'),
  status: row.status as LibraryDocument['status'],
  reviewState: (row.review_state || 'pending') as LibraryDocument['reviewState'],
  content: String(row.content || ''),
  chunkCount: Number(row.chunk_count || 0),
  vectorCount: Number(row.vector_count || 0),
  metadata: JSON.parse(row.metadata || '{}'),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
})

const rowToChunk = (row: any): LibraryChunk => ({
  id: String(row.id),
  documentId: String(row.document_id),
  chunkIndex: Number(row.chunk_index),
  content: String(row.content),
  vectorId: row.vector_id ? String(row.vector_id) : null,
  metadata: JSON.parse(row.metadata || '{}'),
  createdAt: String(row.created_at),
})

const rowToIngestion = (row: any): LibraryIngestion => ({
  id: String(row.id),
  documentId: String(row.document_id),
  status: row.status as LibraryIngestion['status'],
  error: row.error ? String(row.error) : null,
  attempts: Number(row.attempts || 0),
  startedAt: row.started_at ? String(row.started_at) : null,
  completedAt: row.completed_at ? String(row.completed_at) : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at),
})

const rowToActivity = (row: any): ActivityLogEntry => ({
  id: String(row.id),
  type: row.type as ActivityLogEntry['type'],
  subtype: row.subtype ? String(row.subtype) : null,
  referenceId: row.reference_id ? String(row.reference_id) : null,
  metadata: JSON.parse(row.metadata || '{}'),
  createdAt: String(row.created_at),
})
