import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { searchKnowledge, getKnowledgeContext, logActivity, type LibraryChunk } from '@/lib/musashiLibrary'

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    
    const body = await req.json() as Record<string, any>
    const { query, topK, returnContext } = body
    
    if (!query) {
      return NextResponse.json({ error: 'Query is required' }, { status: 400 })
    }
    
    await logActivity('library', 'search', null, { query, userId: user.id })
    
    if (returnContext) {
      const context = await getKnowledgeContext(query, 2000)
      return NextResponse.json({ context })
    }
    
    const { chunks, scores } = await searchKnowledge(query, { topK: topK || 5 })
    
    return NextResponse.json({
      results: chunks.map((chunk: LibraryChunk, i: number) => ({
        id: chunk.id,
        documentId: chunk.documentId,
        content: chunk.content,
        score: scores[i],
      })),
    })
    
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
