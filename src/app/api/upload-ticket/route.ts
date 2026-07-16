/**
 * POST /api/upload-ticket
 *
 * Issues a short-lived (15 min) browser-direct R2/S3 PUT URL for analysis clips.
 * The raw video bytes must never enter a Cloudflare Worker request body —
 * phones routinely exceed the ~100 MB Free/Pro limit.
 *
 * Response: { presignedUrl, assetId, headers, expiresAt }
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import { createUploadTicket } from '@/lib/storage/assets'

function handleError(e: unknown) {
  const code = e instanceof Error ? e.message : 'UNKNOWN'
  if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
  if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (code === 'STORAGE_NOT_CONFIGURED') {
    return NextResponse.json(
      {
        error: 'Direct R2 upload is not configured. Set STORAGE_* Worker secrets.',
        code,
      },
      { status: 501 },
    )
  }
  if (code === 'DIRECT_R2_REQUIRED') {
    return NextResponse.json(
      {
        error:
          'Direct-to-R2 signing credentials are missing. Phone videos over ~100MB cannot use the Worker upload path.',
        code,
      },
      { status: 413 },
    )
  }
  return NextResponse.json({ error: code || 'Upload ticket failed' }, { status: 400 })
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = (await req.json()) as Record<string, unknown>

    const originalName = String(body?.originalName || body?.fileName || '').trim()
    const contentType = String(body?.contentType || body?.mimeType || '').trim()
    const sizeBytes = Math.trunc(Number(body?.sizeBytes ?? body?.size ?? 0) || 0)

    const ticket = await createUploadTicket(getDb(), {
      userId: user.id,
      purpose: 'analysis_clip',
      originalName,
      contentType,
      sizeBytes,
      origin: new URL(req.url).origin,
      // Always mint a browser-direct R2 URL — never Worker-proxied content PUT.
      requireDirectR2: true,
    })

    if (ticket.upload.provider !== 'r2' || !/^https?:\/\//i.test(ticket.upload.url)) {
      return NextResponse.json(
        {
          error: 'Expected a browser-direct R2 presigned URL',
          code: 'DIRECT_R2_REQUIRED',
        },
        { status: 413 },
      )
    }

    return NextResponse.json(
      {
        assetId: ticket.asset.id,
        presignedUrl: ticket.upload.url,
        method: ticket.upload.method,
        headers: ticket.upload.headers,
        expiresAt: ticket.upload.expiresAt,
        // Keep the full ticket shape for clients that already speak /api/uploads.
        asset: ticket.asset,
        upload: ticket.upload,
      },
      { status: 201 },
    )
  } catch (e) {
    return handleError(e)
  }
}
