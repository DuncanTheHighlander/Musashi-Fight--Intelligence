import { NextResponse } from 'next/server'
import { getEntriesByCategory } from '@/lib/taxonomyService'
import { tagClipsForVideo } from '@/lib/clips/clipTagger'
import { insertTaggedSegments } from '@/lib/clips/clipsService'
import { createSignedReadUrl } from '@/lib/storage/r2'

interface OwnedIngestRequest {
  objectKey: string
  contentType: string
  discipline: string
  categoryId: string
}

/**
 * POST /api/library/taxonomy/clips/owned/ingest
 *
 * Step 2 of the owned-footage path: given a clip already uploaded to R2 via
 * /clips/owned/upload-url, tag it against a technique vocabulary the same
 * way the YouTube path does (clipTagger takes either source uniformly).
 */
export async function POST(req: Request) {
  try {
    const isDev = process.env.NODE_ENV === 'development'
    if (!isDev) {
      const { requireUser } = await import('@/lib/musashiAuth')
      await requireUser(req, { role: 'shogun' })
    }

    const body = (await req.json()) as OwnedIngestRequest
    const { objectKey, contentType, discipline, categoryId } = body

    if (!objectKey || !contentType || !discipline || !categoryId) {
      return NextResponse.json(
        { error: 'objectKey, contentType, discipline, and categoryId are required' },
        { status: 400 }
      )
    }

    const vocabulary = await getEntriesByCategory(categoryId)
    if (vocabulary.length === 0) {
      return NextResponse.json({ error: `No technique entries found for categoryId ${categoryId}` }, { status: 404 })
    }

    const readUrl = await createSignedReadUrl({ key: objectKey })
    const segments = await tagClipsForVideo({
      source: { kind: 'file', fileUri: readUrl, mimeType: contentType },
      vocabulary,
    })
    const stored = await insertTaggedSegments({
      segments,
      discipline,
      source: { sourceType: 'owned', r2ObjectKey: objectKey },
    })

    return NextResponse.json({ success: true, stored })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    return NextResponse.json({ error: 'Owned clip ingestion failed', details: code }, { status: 500 })
  }
}
