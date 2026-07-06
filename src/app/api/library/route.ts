import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import {
  createDocument,
  listDocuments,
  getDocument,
  deleteDocument,
  logActivity,
} from '@/lib/musashiLibrary'

export async function GET(req: Request) {
  try {
    const user = await requireUser(req)

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const status = searchParams.get('status') || undefined
    const limit = Number(searchParams.get('limit') || 50)
    const offset = Number(searchParams.get('offset') || 0)
    
    if (id) {
      const doc = await getDocument(id)
      if (!doc) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }
      return NextResponse.json({ document: doc })
    }
    
    const { documents, total } = await listDocuments({ status, limit, offset })
    
    return NextResponse.json({ documents, total, limit, offset })
    
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Failed to fetch documents' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    
    const body = await req.json() as Record<string, any>
    const { title, content, sourceType, author, tags, metadata } = body
    
    if (!title || !content) {
      return NextResponse.json({ error: 'Title and content are required' }, { status: 400 })
    }
    
    // Only admins can publish straight to the AI knowledge base. Everyone
    // else's submissions wait in the moderation queue until a shogun approves.
    const reviewState = user.role === 'shogun' ? 'approved' : 'pending'

    const doc = await createDocument({
      title,
      content,
      sourceType: sourceType || 'manual',
      author: author || user.email,
      tags: tags || [],
      metadata: metadata || {},
      reviewState,
    })

    return NextResponse.json(
      {
        document: doc,
        pendingReview: reviewState === 'pending',
        message:
          reviewState === 'pending'
            ? 'Submitted for review. It will feed AI coaching once an admin approves it.'
            : 'Document published to the knowledge base.',
      },
      { status: 201 },
    )
    
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Failed to create document' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireUser(req, { role: 'shogun' })
    
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    
    if (!id) {
      return NextResponse.json({ error: 'Document ID required' }, { status: 400 })
    }
    
    await deleteDocument(id)
    
    return NextResponse.json({ success: true })
    
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    if (code === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Failed to delete document' }, { status: 500 })
  }
}
