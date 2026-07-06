import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createMockD1, pinMockD1, unpinMockD1 } from './marketplace/mockD1'
import {
  createDocument,
  searchKnowledge,
  getKnowledgeContext,
  listPendingReviewDocuments,
  setDocumentReviewState,
} from './musashiLibrary'

type MockDb = ReturnType<typeof createMockD1>

async function insertDoc(db: MockDb, id: string, reviewState: string) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO musashi_library_documents
        (id, title, source_type, author, tags, status, review_state, content, chunk_count, vector_count, metadata, created_at, updated_at)
       VALUES (?, ?, 'manual', 'author', '[]', 'ready', ?, 'x', 1, 0, '{}', ?, ?)`,
    )
    .bind(id, `Doc ${id}`, reviewState, now, now)
    .run()
}

async function insertChunk(db: MockDb, id: string, docId: string, content: string) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO musashi_library_chunks
        (id, document_id, chunk_index, content, vector_id, metadata, created_at)
       VALUES (?, ?, 0, ?, NULL, '{}', ?)`,
    )
    .bind(id, docId, content, now)
    .run()
}

describe('knowledge library moderation gate', () => {
  let db: MockDb

  beforeEach(() => {
    db = createMockD1()
    pinMockD1(db)
    // Route library getDb() through the pinned mock singleton.
    vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
    // Force the keyword (non-Vectorize) retrieval path, and make ingestion
    // fail fast (no key) so createDocument never hits the network.
    delete (process.env as Record<string, string | undefined>).VECTORIZE
    vi.stubEnv('GEMINI_API_KEY', '')
  })

  afterEach(() => {
    unpinMockD1()
    vi.unstubAllEnvs()
  })

  test('createDocument defaults to pending; approved only when explicitly passed', async () => {
    const submitted = await createDocument({ title: 'A', content: 'jab defense drill' })
    expect(submitted.reviewState).toBe('pending')

    const trusted = await createDocument({
      title: 'B',
      content: 'cross counter drill',
      reviewState: 'approved',
    })
    expect(trusted.reviewState).toBe('approved')
  })

  test('retrieval excludes pending and rejected documents', async () => {
    await insertDoc(db, 'doc_ok', 'approved')
    await insertChunk(db, 'chunk_ok', 'doc_ok', 'jab defense footwork approved content')
    await insertDoc(db, 'doc_pending', 'pending')
    await insertChunk(db, 'chunk_pending', 'doc_pending', 'jab defense footwork pending content')
    await insertDoc(db, 'doc_rejected', 'rejected')
    await insertChunk(db, 'chunk_rejected', 'doc_rejected', 'jab defense footwork rejected content')

    const ids = (await searchKnowledge('jab defense', { topK: 10 })).chunks.map((c) => c.id)
    expect(ids).toContain('chunk_ok')
    expect(ids).not.toContain('chunk_pending')
    expect(ids).not.toContain('chunk_rejected')
  })

  test('getKnowledgeContext never surfaces unapproved content to the AI', async () => {
    await insertDoc(db, 'doc_pending', 'pending')
    await insertChunk(db, 'chunk_pending', 'doc_pending', 'SECRET_INJECTION pending content')

    const ctx = await getKnowledgeContext('SECRET_INJECTION', 2000)
    expect(ctx).not.toContain('SECRET_INJECTION')
  })

  test('approving a pending doc opens it to retrieval', async () => {
    await insertDoc(db, 'doc_x', 'pending')
    await insertChunk(db, 'chunk_x', 'doc_x', 'uppercut slip content')

    expect((await searchKnowledge('uppercut slip', { topK: 10 })).chunks).toHaveLength(0)

    expect(await setDocumentReviewState('doc_x', 'approved')).toBe(true)

    const ids = (await searchKnowledge('uppercut slip', { topK: 10 })).chunks.map((c) => c.id)
    expect(ids).toContain('chunk_x')
  })

  test('listPendingReviewDocuments returns only pending submissions', async () => {
    await insertDoc(db, 'p1', 'pending')
    await insertDoc(db, 'a1', 'approved')
    const ids = (await listPendingReviewDocuments()).map((d) => d.id)
    expect(ids).toContain('p1')
    expect(ids).not.toContain('a1')
  })
})
