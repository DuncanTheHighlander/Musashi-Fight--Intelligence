import { NextResponse } from 'next/server'
import { getEntriesByCategory } from '@/lib/taxonomyService'
import { tagClipsForVideo } from '@/lib/clips/clipTagger'
import { insertTaggedSegments } from '@/lib/clips/clipsService'

interface IngestRequest {
  discipline: string
  categoryId: string
  youtubeVideoIds: string[]
}

/**
 * POST /api/library/taxonomy/clips/ingest
 *
 * Admin/curation tool: tags a manually-reviewed batch of YouTube videos
 * against the technique vocabulary for one category, storing the result as
 * technique_clips rows. Not a crawler — costs real Gemini + YouTube quota,
 * so the caller supplies the video ids rather than this route discovering
 * them on its own.
 */
export async function POST(req: Request) {
  try {
    const isDev = process.env.NODE_ENV === 'development'
    if (!isDev) {
      const { requireUser } = await import('@/lib/musashiAuth')
      await requireUser(req, { role: 'shogun' })
    }

    const body = (await req.json()) as IngestRequest
    const { discipline, categoryId, youtubeVideoIds } = body

    if (!discipline || !categoryId || !Array.isArray(youtubeVideoIds) || youtubeVideoIds.length === 0) {
      return NextResponse.json(
        { error: 'discipline, categoryId, and a non-empty youtubeVideoIds array are required' },
        { status: 400 }
      )
    }

    const vocabulary = await getEntriesByCategory(categoryId)
    if (vocabulary.length === 0) {
      return NextResponse.json({ error: `No technique entries found for categoryId ${categoryId}` }, { status: 404 })
    }

    const results: { videoId: string; stored: number }[] = []
    const errors: { videoId: string; error: string }[] = []

    for (const videoId of youtubeVideoIds) {
      try {
        const segments = await tagClipsForVideo({
          source: { kind: 'youtube', videoId },
          vocabulary,
        })
        const stored = await insertTaggedSegments({
          segments,
          discipline,
          source: { sourceType: 'youtube', youtubeVideoId: videoId },
          metadata: { sourceVideoId: videoId },
        })
        results.push({ videoId, stored })
      } catch (e) {
        errors.push({ videoId, error: e instanceof Error ? e.message : String(e) })
      }
    }

    return NextResponse.json({
      success: true,
      totalStored: results.reduce((sum, r) => sum + r.stored, 0),
      results,
      ...(errors.length > 0 ? { errors } : {}),
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    if (code === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }
    return NextResponse.json({ error: 'Clip ingestion failed', details: code }, { status: 500 })
  }
}
