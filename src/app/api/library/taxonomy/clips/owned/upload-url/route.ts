import { NextResponse } from 'next/server'
import { createSignedUploadUrl } from '@/lib/storage/r2'
import { makeId } from '@/lib/fightlang/fightlang.ids'

interface UploadUrlRequest {
  contentType: string
}

/**
 * POST /api/library/taxonomy/clips/owned/upload-url
 *
 * Step 1 of the owned-footage ingestion path: mint a signed R2 upload URL
 * for a coach/admin-supplied clip. The returned objectKey is passed to
 * /clips/owned/ingest once the upload completes.
 */
export async function POST(req: Request) {
  try {
    const isDev = process.env.NODE_ENV === 'development'
    if (!isDev) {
      const { requireUser } = await import('@/lib/musashiAuth')
      await requireUser(req, { role: 'shogun' })
    }

    const body = (await req.json()) as UploadUrlRequest
    if (!body.contentType) {
      return NextResponse.json({ error: 'contentType is required' }, { status: 400 })
    }

    const objectKey = `technique-clips/${makeId('clip')}`
    const upload = await createSignedUploadUrl({ key: objectKey, contentType: body.contentType })

    return NextResponse.json({ objectKey, upload })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    if (code === 'STORAGE_NOT_CONFIGURED') {
      return NextResponse.json({ error: 'R2 storage is not configured' }, { status: 503 })
    }
    return NextResponse.json({ error: 'Failed to create upload URL', details: code }, { status: 500 })
  }
}
