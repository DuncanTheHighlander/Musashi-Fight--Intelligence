import { NextResponse } from 'next/server'
import { queryClips, type TechniqueClipWithEntry } from '@/lib/clips/clipsService'
import { parseClipQuery } from '@/lib/clips/queryParser'
import { resolveStorageMode, createSignedReadUrl } from '@/lib/storage/r2'

async function withPlaybackUrl(clip: TechniqueClipWithEntry): Promise<TechniqueClipWithEntry & { playbackUrl: string | null }> {
  if (clip.sourceType === 'youtube') {
    return { ...clip, playbackUrl: `https://www.youtube.com/embed/${clip.youtubeVideoId}?start=${Math.floor(clip.startSec)}` }
  }
  if (clip.r2ObjectKey && resolveStorageMode() === 'r2') {
    try {
      const url = await createSignedReadUrl({ key: clip.r2ObjectKey })
      return { ...clip, playbackUrl: url }
    } catch {
      return { ...clip, playbackUrl: null }
    }
  }
  return { ...clip, playbackUrl: null }
}

/**
 * GET /api/library/taxonomy/clips/search
 *
 * Query params:
 *   discipline  — filter by discipline (e.g. bjj)
 *   categoryId  — filter by technique_categories id
 *   techniqueId — filter to a single technique_entries id
 *   difficulty  — filter by technique difficulty
 *   tag         — filter by an exact-known tag (repeatable)
 *   q           — free-text query, e.g. "K-guard entries that aren't from closed guard"
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const discipline = url.searchParams.get('discipline') || undefined
    const categoryId = url.searchParams.get('categoryId') || undefined
    const techniqueId = url.searchParams.get('techniqueId') || undefined
    const difficulty = url.searchParams.get('difficulty') || undefined
    const tags = url.searchParams.getAll('tag')
    const q = url.searchParams.get('q')

    let includeTags = [...tags]
    let excludeTags: string[] = []

    if (q) {
      const parsed = await parseClipQuery(q)
      includeTags = [...includeTags, ...parsed.includeTags]
      excludeTags = parsed.excludeTags
    }

    const clips = await queryClips({
      discipline,
      categoryId,
      techniqueId,
      difficulty,
      includeTags,
      excludeTags,
    })
    const enriched = await Promise.all(clips.map(withPlaybackUrl))

    return NextResponse.json({ clips: enriched, parsedQuery: q ? { includeTags, excludeTags } : undefined })
  } catch (e) {
    console.error('Clip search error:', e)
    return NextResponse.json(
      { error: 'Clip search failed', details: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    )
  }
}
