import { NextResponse } from 'next/server'
import { readSecretEnv } from '@/lib/env'
import { runSam3VideoRle, SAM3_FAL_MODEL_ID } from '@/lib/fal/sam3Client'
import { requireUser } from '@/lib/musashiAuth'
import { aiGuard } from '@/lib/ai/aiGuard'
import { assertPublicHttpUrl } from '@/lib/urlAllowlist'

export const maxDuration = 300

function isFalDryRun(): boolean {
  return process.env.FAL_DRY_RUN === '1' || process.env.OFFLINE_MODE === '1'
}

/** Tier 2 SAM3 status — no fal.ai call, no key in response. */
export async function GET(req: Request) {
  try {
    await requireUser(req)
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.json({
    route: '/api/fal/sam3',
    tier: 2,
    model: SAM3_FAL_MODEL_ID,
    configured: Boolean(readSecretEnv('FAL_KEY')),
    dryRun: isFalDryRun(),
  })
}

/**
 * Tier 2 SAM3 video segmentation (upload-only: pass a public video URL).
 * POST { "videoUrl": "https://...", "prompt": "person" }
 */
export async function POST(req: Request) {
  const guard = await aiGuard(req, 'track')
  if (!guard.ok) return guard.response

  if (isFalDryRun()) {
    return NextResponse.json({
      dryRun: true,
      tier: 2,
      model: SAM3_FAL_MODEL_ID,
      message: 'SAM3 fal call skipped (FAL_DRY_RUN or OFFLINE_MODE)',
      data: null,
    })
  }

  const falKey = readSecretEnv('FAL_KEY')
  if (!falKey) {
    return NextResponse.json(
      { error: 'FAL_KEY not configured', code: 'FAL_KEY_MISSING' },
      { status: 503 }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const videoUrl =
    typeof body === 'object' && body !== null && 'videoUrl' in body
      ? String((body as { videoUrl: unknown }).videoUrl || '').trim()
      : ''
  const prompt =
    typeof body === 'object' && body !== null && 'prompt' in body
      ? String((body as { prompt: unknown }).prompt || '').trim()
      : undefined

  if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
    return NextResponse.json(
      { error: 'videoUrl required (must be http or https)' },
      { status: 400 }
    )
  }

  try {
    assertPublicHttpUrl(videoUrl, { requestOrigin: new URL(req.url).origin })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'VIDEO_URL_NOT_ALLOWED'
    return NextResponse.json(
      {
        error:
          code === 'INVALID_VIDEO_URL'
            ? 'videoUrl must be a valid http or https URL'
            : 'videoUrl must be hosted on this app or an allowed CDN',
        code,
      },
      { status: 400 }
    )
  }

  try {
    const result = await runSam3VideoRle(falKey, {
      videoUrl,
      prompt: prompt || undefined,
    })
    return NextResponse.json({
      tier: 2,
      model: result.model,
      requestId: result.requestId,
      data: result.data,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'SAM3 request failed'
    console.error('[fal/sam3]', message)
    return NextResponse.json({ error: message, code: 'FAL_SAM3_ERROR' }, { status: 502 })
  }
}
