import { safeParseResponse } from '@/lib/safeJson'

export type YoutubeSearchResult = {
  videoId: string
  title: string
  channelId: string
  channelTitle: string
}

type YoutubeSearchResponse = {
  items?: Array<{
    id?: { videoId?: string }
    snippet?: { title?: string; channelId?: string; channelTitle?: string }
  }>
  error?: { message?: string }
}

const getKey = (): string => {
  const key = process.env.YOUTUBE_API_KEY
  if (!key) throw new Error('YOUTUBE_API_KEY not configured')
  return key
}

/**
 * Search YouTube for candidate technique videos, optionally restricted to an
 * allowlist of trusted channel IDs. This is metadata-only discovery via the
 * official Data API — playback always goes through the official embed, clips
 * are never downloaded.
 */
export async function searchYoutubeVideos(args: {
  query: string
  channelIds?: string[]
  maxResults?: number
}): Promise<YoutubeSearchResult[]> {
  const apiKey = getKey()
  const maxResults = Math.max(1, Math.min(25, args.maxResults ?? 10))

  const runSearch = async (channelId?: string): Promise<YoutubeSearchResult[]> => {
    const params = new URLSearchParams({
      part: 'snippet',
      type: 'video',
      q: args.query,
      maxResults: String(maxResults),
      key: apiKey,
    })
    if (channelId) params.set('channelId', channelId)

    const resp = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`)
    const data = (await safeParseResponse(resp)) as YoutubeSearchResponse
    if (!resp.ok) throw new Error(data?.error?.message || `YouTube search error: ${resp.status}`)

    return (data.items || [])
      .filter((item) => item.id?.videoId)
      .map((item) => ({
        videoId: String(item.id!.videoId),
        title: String(item.snippet?.title || ''),
        channelId: String(item.snippet?.channelId || ''),
        channelTitle: String(item.snippet?.channelTitle || ''),
      }))
  }

  if (!args.channelIds?.length) return runSearch()

  const perChannel = await Promise.all(args.channelIds.map((id) => runSearch(id)))
  return perChannel.flat()
}
