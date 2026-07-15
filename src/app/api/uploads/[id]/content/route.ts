/**
 * PUT  /api/uploads/[id]/content — mock-mode upload receiver (dev only).
 * GET  /api/uploads/[id]/content — serve mock bytes or redirect to R2 presigned GET.
 */
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/marketplace/types'
import type { MarketplaceAssetRow } from '@/lib/marketplace/types'
import { getReadableAsset } from '@/lib/storage/assets'
import { readMockObject, writeMockObject } from '@/lib/storage/mockStorage'
import { isR2SigningConfigured, resolveStorageMode } from '@/lib/storage/r2'
import { getWorkerUploadsBucket } from '@/lib/storage/workerR2'

type Params = { id: string }

async function loadAsset(db: ReturnType<typeof getDb>, id: string): Promise<MarketplaceAssetRow | null> {
  return db.prepare('SELECT * FROM marketplace_assets WHERE id = ?').bind(id).first<MarketplaceAssetRow>()
}

export async function PUT(req: Request, context: { params: Promise<Params> }) {
  const mode = resolveStorageMode()
  const useWorkerR2 = mode === 'r2' && !isR2SigningConfigured()
  if (mode !== 'mock' && !useWorkerR2) {
    return NextResponse.json({ error: 'Direct upload only available in mock storage mode' }, { status: 405 })
  }
  try {
    const user = await requireUser(req)
    const { id } = await context.params
    const db = getDb()
    const asset = await loadAsset(db, id)
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (asset.owner_user_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (useWorkerR2) {
      const bucket = await getWorkerUploadsBucket()
      if (!bucket) return NextResponse.json({ error: 'Worker R2 binding unavailable' }, { status: 503 })
      if (!req.body) return NextResponse.json({ error: 'Empty body' }, { status: 400 })
      const contentLength = Number(req.headers.get('content-length') || asset.size_bytes)
      if (!Number.isFinite(contentLength) || contentLength <= 0) {
        return NextResponse.json({ error: 'Content length required' }, { status: 411 })
      }
      await bucket.put(asset.object_key, req.body, {
        httpMetadata: { contentType: asset.content_type, contentLength },
      })
    } else {
      const bytes = await req.arrayBuffer()
      if (!bytes.byteLength) return NextResponse.json({ error: 'Empty body' }, { status: 400 })
      writeMockObject(asset.object_key, Buffer.from(bytes))
    }
    return new NextResponse(null, { status: 200 })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: code || 'Upload failed' }, { status: 400 })
  }
}

export async function GET(req: Request, context: { params: Promise<Params> }) {
  try {
    const user = await requireUser(req)
    const { id } = await context.params
    const mode = resolveStorageMode()

    if (mode === 'r2') {
      if (!isR2SigningConfigured()) {
        const { asset } = await getReadableAsset(getDb(), {
          assetId: id,
          userId: user.id,
          isAdmin: user.role === 'shogun',
        })
        const object = await getWorkerUploadsBucket().then((bucket) => bucket?.get(asset.object_key))
        if (!object?.body) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        return new NextResponse(object.body, {
          status: 200,
          headers: {
            'Content-Type': object.httpMetadata?.contentType || asset.content_type,
            'Content-Length': String(object.size),
            'Content-Disposition': `inline; filename="${asset.original_name.replace(/"/g, '')}"`,
            'Cache-Control': 'private, max-age=3600',
          },
        })
      }
      const { readUrl } = await getReadableAsset(getDb(), {
        assetId: id,
        userId: user.id,
        isAdmin: user.role === 'shogun',
      })
      return NextResponse.redirect(readUrl, 302)
    }

    const { asset } = await getReadableAsset(getDb(), {
      assetId: id,
      userId: user.id,
      isAdmin: user.role === 'shogun',
    })
    const data = readMockObject(asset.object_key)
    return new NextResponse(new Uint8Array(data), {
      status: 200,
      headers: {
        'Content-Type': asset.content_type,
        'Content-Length': String(data.length),
        'Content-Disposition': `inline; filename="${asset.original_name.replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=3600',
      },
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (code === 'NOT_FOUND' || code === 'OBJECT_NOT_FOUND') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ error: code || 'Failed' }, { status: 400 })
  }
}
