/**
 * Marketplace upload asset lifecycle — mock local storage or R2 presigned URLs.
 */
import type { D1Database } from '@/lib/db'
import type {
  MarketplaceAssetPurpose,
  MarketplaceAssetRow,
  MarketplaceAssetStatus,
} from '@/lib/marketplace/types'
import { newId } from '@/lib/marketplace/types'
import { mockObjectExists, mockObjectSize, readMockObject, writeMockObject } from './mockStorage'
import {
  assertStorageConfigured,
  createSignedReadUrl,
  createSignedUploadUrl,
  isR2SigningConfigured,
  resolveStorageMode,
  type SignedR2Url,
} from './r2'
import { getWorkerUploadsBucket, putWorkerR2Object } from './workerR2'

export type CreateUploadTicketInput = {
  userId: string
  purpose: MarketplaceAssetPurpose
  originalName: string
  contentType: string
  sizeBytes: number
  jobId?: string | null
  disputeId?: string | null
  origin?: string
}

export type UploadTicket = {
  asset: Pick<MarketplaceAssetRow, 'id' | 'object_key' | 'status' | 'purpose' | 'content_type'>
  upload: {
    provider: 'mock' | 'r2' | 'worker'
    method: 'PUT'
    url: string
    headers: Record<string, string>
    expiresAt: string
  }
}

export type CompleteUploadInput = {
  assetId: string
  userId: string
  sizeBytes?: number
  sha256?: string | null
}

export type GetAssetInput = {
  assetId: string
  userId: string
  isAdmin?: boolean
}

const MAX_JOB_VIDEO_BYTES = 500 * 1024 * 1024
const MAX_PROFILE_MEDIA_BYTES = 10 * 1024 * 1024
// Stay below Cloudflare's documented 100 MB Free/Pro Worker request ceiling.
// Larger originals require a browser-direct presigned R2 URL.
export const MAX_WORKER_PROXY_UPLOAD_BYTES = 90 * 1024 * 1024

const JOB_VIDEO_TYPES = new Set(['video/mp4', 'video/quicktime', 'video/webm'])
const DELIVERABLE_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'video/mp4',
  'video/quicktime',
  'video/webm',
])
const DISPUTE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'video/mp4',
  'video/quicktime',
  'video/webm',
])
const PROFILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function sanitizeFileName(name: string): string {
  const base = String(name || 'file')
    .split(/[/\\]/)
    .pop()!
    .replace(/[^\w.\-()+ ]/g, '_')
    .slice(0, 180)
  return base || 'file'
}

/** Browsers often send empty or application/octet-stream for .mp4/.mov — coerce from the name. */
function normalizeVideoContentType(contentType: string, originalName: string): string {
  const raw = String(contentType || '')
    .toLowerCase()
    .split(';')[0]
    .trim()
  if (JOB_VIDEO_TYPES.has(raw)) return raw
  const lower = String(originalName || '').toLowerCase()
  if (lower.endsWith('.mov') || lower.endsWith('.qt')) return 'video/quicktime'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v') || !raw || raw === 'application/octet-stream') {
    return 'video/mp4'
  }
  return raw
}

function validateUploadInput(input: CreateUploadTicketInput): void {
  let contentType = String(input.contentType || '').toLowerCase().split(';')[0].trim()
  const sizeBytes = Math.trunc(Number(input.sizeBytes) || 0)
  if (sizeBytes <= 0) throw new Error('sizeBytes required')
  if (!input.originalName?.trim()) throw new Error('originalName required')

  switch (input.purpose) {
    case 'job_video':
      contentType = normalizeVideoContentType(contentType, input.originalName)
      input.contentType = contentType
      if (!JOB_VIDEO_TYPES.has(contentType)) throw new Error('Unsupported content type for job video')
      if (sizeBytes > MAX_JOB_VIDEO_BYTES) throw new Error('File too large (max 500 MB)')
      break
    case 'analysis_clip':
      contentType = normalizeVideoContentType(contentType, input.originalName)
      input.contentType = contentType
      if (!JOB_VIDEO_TYPES.has(contentType)) throw new Error('Unsupported content type for analysis clip')
      if (sizeBytes > MAX_JOB_VIDEO_BYTES) throw new Error('File too large (max 500 MB)')
      break
    case 'deliverable':
      if (!DELIVERABLE_TYPES.has(contentType)) throw new Error('Unsupported content type for deliverable')
      if (sizeBytes > MAX_JOB_VIDEO_BYTES) throw new Error('File too large (max 500 MB)')
      break
    case 'dispute_evidence':
      if (!DISPUTE_TYPES.has(contentType)) throw new Error('Unsupported content type for dispute evidence')
      if (sizeBytes > MAX_JOB_VIDEO_BYTES) throw new Error('File too large (max 500 MB)')
      break
    case 'profile_media':
      if (!PROFILE_TYPES.has(contentType)) throw new Error('Unsupported content type for profile media')
      if (sizeBytes > MAX_PROFILE_MEDIA_BYTES) throw new Error('File too large (max 10 MB)')
      break
    default:
      throw new Error('Invalid purpose')
  }
}

function buildObjectKey(userId: string, purpose: MarketplaceAssetPurpose, originalName: string): string {
  const safeName = sanitizeFileName(originalName)
  const stamp = Date.now()
  return `marketplace/${purpose}/${userId}/${stamp}_${safeName}`
}

function mockBucketName(): string {
  return 'mock-local'
}

export async function createUploadTicket(
  db: D1Database,
  input: CreateUploadTicketInput,
): Promise<UploadTicket> {
  validateUploadInput(input)
  const mode = resolveStorageMode()
  const contentType = String(input.contentType).toLowerCase().split(';')[0].trim()
  const id = newId('asset')
  const now = new Date().toISOString()
  const objectKey = buildObjectKey(input.userId, input.purpose, input.originalName)
  const canPresign = mode === 'r2' && isR2SigningConfigured()
  const workerBucket = mode === 'r2' && !canPresign ? await getWorkerUploadsBucket() : null
  if (mode === 'r2' && !canPresign && !workerBucket) assertStorageConfigured()
  if (mode === 'r2' && !canPresign && input.sizeBytes > MAX_WORKER_PROXY_UPLOAD_BYTES) {
    throw new Error('DIRECT_R2_REQUIRED')
  }
  const bucket = mode === 'r2' && canPresign ? assertStorageConfigured().bucket : mode === 'r2' ? 'musashi-uploads' : mockBucketName()

  await db
    .prepare(
      `INSERT INTO marketplace_assets (
         id, owner_user_id, job_id, dispute_id, purpose, bucket, object_key,
         original_name, content_type, size_bytes, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_upload', ?, ?)`,
    )
    .bind(
      id,
      input.userId,
      input.jobId ?? null,
      input.disputeId ?? null,
      input.purpose,
      bucket,
      objectKey,
      sanitizeFileName(input.originalName),
      contentType,
      Math.trunc(input.sizeBytes),
      now,
      now,
    )
    .run()

  let signed: SignedR2Url
  if (mode === 'r2' && canPresign) {
    signed = await createSignedUploadUrl({ key: objectKey, contentType })
  } else if (mode === 'r2') {
    signed = {
      // Worker-backed uploads must stay on the app's current origin so the
      // browser includes its authenticated session. A relative URL also
      // avoids trusting forwarded/request origins when the app is behind a
      // proxy or custom hostname.
      url: `/api/uploads/${id}/content`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }
  } else {
    const origin = String(input.origin || 'http://localhost:3000').replace(/\/$/, '')
    signed = {
      url: `${origin}/api/uploads/${id}/content`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }
  }

  return {
    asset: {
      id,
      object_key: objectKey,
      status: 'pending_upload',
      purpose: input.purpose,
      content_type: contentType,
    },
    upload: {
      provider: mode === 'r2' && !canPresign ? 'worker' : mode,
      method: 'PUT',
      url: signed.url,
      headers: signed.headers,
      expiresAt: signed.expiresAt,
    },
  }
}

async function getAssetRow(db: D1Database, assetId: string): Promise<MarketplaceAssetRow | null> {
  return db
    .prepare('SELECT * FROM marketplace_assets WHERE id = ?')
    .bind(assetId)
    .first<MarketplaceAssetRow>()
}

async function assertCanAccessAsset(
  db: D1Database,
  asset: MarketplaceAssetRow,
  userId: string,
  isAdmin = false,
): Promise<void> {
  if (isAdmin || asset.owner_user_id === userId) return

  if (asset.job_id) {
    const job = await db
      .prepare('SELECT fighter_id, analyst_id FROM marketplace_jobs WHERE id = ?')
      .bind(asset.job_id)
      .first<{ fighter_id: string; analyst_id: string | null }>()
    if (job && (job.fighter_id === userId || job.analyst_id === userId)) return
  }

  if (asset.dispute_id) {
    const dispute = await db
      .prepare(
        `SELECT d.opened_by_id, j.fighter_id, j.analyst_id
           FROM marketplace_disputes d
           JOIN marketplace_jobs j ON j.id = d.job_id
          WHERE d.id = ?`,
      )
      .bind(asset.dispute_id)
      .first<{ opened_by_id: string; fighter_id: string; analyst_id: string | null }>()
    if (
      dispute &&
      (dispute.opened_by_id === userId ||
        dispute.fighter_id === userId ||
        dispute.analyst_id === userId)
    ) {
      return
    }
  }

  throw new Error('FORBIDDEN')
}

export async function completeUpload(
  db: D1Database,
  input: CompleteUploadInput,
): Promise<MarketplaceAssetRow> {
  const asset = await getAssetRow(db, input.assetId)
  if (!asset) throw new Error('NOT_FOUND')
  if (asset.owner_user_id !== input.userId) throw new Error('FORBIDDEN')
  if (asset.status === 'deleted') throw new Error('ASSET_DELETED')
  if (asset.status !== 'pending_upload' && asset.status !== 'uploaded') {
    throw new Error('ASSET_NOT_PENDING_UPLOAD')
  }

  const expectedSizeBytes = Math.trunc(Number(asset.size_bytes))
  if (!Number.isFinite(expectedSizeBytes) || expectedSizeBytes <= 0) {
    throw new Error('UPLOAD_SIZE_MISMATCH')
  }

  // The ticketed size is server-owned. A completion request may echo it, but
  // it cannot replace it with a different value.
  if (input.sizeBytes !== undefined) {
    const reportedSizeBytes = Math.trunc(Number(input.sizeBytes))
    if (!Number.isFinite(reportedSizeBytes) || reportedSizeBytes !== expectedSizeBytes) {
      throw new Error('UPLOAD_SIZE_MISMATCH')
    }
  }

  const mode = resolveStorageMode()
  let storedSizeBytes = 0
  if (mode === 'mock') {
    if (!mockObjectExists(asset.object_key)) throw new Error('UPLOAD_INCOMPLETE')
    storedSizeBytes = Math.trunc(Number(mockObjectSize(asset.object_key)))
  } else {
    // Completion is authoritative only after a storage-side HEAD. This is
    // required for both Worker-proxied and browser-direct presigned PUTs.
    const bucket = await getWorkerUploadsBucket()
    if (!bucket) throw new Error('UPLOAD_VERIFICATION_UNAVAILABLE')
    const object = await bucket.head(asset.object_key)
    if (!object) throw new Error('UPLOAD_INCOMPLETE')
    storedSizeBytes = Math.trunc(Number(object.size))
  }

  if (!Number.isFinite(storedSizeBytes) || storedSizeBytes <= 0) {
    throw new Error('UPLOAD_INCOMPLETE')
  }
  if (storedSizeBytes !== expectedSizeBytes) {
    throw new Error('UPLOAD_SIZE_MISMATCH')
  }

  // Idempotency is allowed only after re-verifying that the durable object is
  // still present and exactly matches the server-issued ticket.
  if (asset.status === 'uploaded') {
    return asset
  }

  const now = new Date().toISOString()
  await db
    .prepare(
      `UPDATE marketplace_assets
          SET status = 'uploaded',
              size_bytes = ?,
              sha256 = COALESCE(?, sha256),
              uploaded_at = ?,
              updated_at = ?
        WHERE id = ?`,
    )
    .bind(expectedSizeBytes, input.sha256 ?? null, now, now, input.assetId)
    .run()

  const updated = await getAssetRow(db, input.assetId)
  if (!updated) throw new Error('NOT_FOUND')
  return updated
}

export async function getReadableAsset(
  db: D1Database,
  input: GetAssetInput,
): Promise<{ asset: MarketplaceAssetRow; readUrl: string }> {
  const asset = await getAssetRow(db, input.assetId)
  if (!asset) throw new Error('NOT_FOUND')
  if (asset.status !== 'uploaded') throw new Error('ASSET_NOT_READY')

  await assertCanAccessAsset(db, asset, input.userId, input.isAdmin)

  const mode = resolveStorageMode()
  if (mode === 'r2') {
    if (!isR2SigningConfigured()) {
      const object = await getWorkerUploadsBucket().then((bucket) => bucket?.head(asset.object_key))
      if (!object) throw new Error('OBJECT_NOT_FOUND')
      return { asset, readUrl: `/api/uploads/${asset.id}/content` }
    }
    const readUrl = await createSignedReadUrl({ key: asset.object_key })
    return { asset, readUrl }
  }
  return { asset, readUrl: `/api/uploads/${asset.id}/content` }
}

/** Server-side bytes for an uploaded asset (Gemini tape upload without re-POSTing FormData). */
export async function readUploadedAssetBytes(
  db: D1Database,
  input: GetAssetInput,
): Promise<{ bytes: Buffer; contentType: string; originalName: string; sizeBytes: number }> {
  const { asset, readUrl } = await getReadableAsset(db, input)
  const mode = resolveStorageMode()

  if (mode === 'mock') {
    const bytes = readMockObject(asset.object_key)
    return {
      bytes,
      contentType: asset.content_type,
      originalName: asset.original_name,
      sizeBytes: bytes.length,
    }
  }

  if (mode === 'r2' && !isR2SigningConfigured()) {
    const object = await getWorkerUploadsBucket().then((bucket) => bucket?.get(asset.object_key))
    if (!object?.body) throw new Error('OBJECT_NOT_FOUND')
    const ab = await new Response(object.body).arrayBuffer()
    const bytes = Buffer.from(ab)
    return {
      bytes,
      contentType: object.httpMetadata?.contentType || asset.content_type,
      originalName: asset.original_name,
      sizeBytes: bytes.length,
    }
  }

  const res = await fetch(readUrl)
  if (!res.ok) throw new Error(`ASSET_READ_FAILED:${res.status}`)
  const ab = await res.arrayBuffer()
  const bytes = Buffer.from(ab)
  return {
    bytes,
    contentType: res.headers.get('content-type') || asset.content_type,
    originalName: asset.original_name,
    sizeBytes: bytes.length,
  }
}

/**
 * Server-side stream for a completed asset. Unlike readUploadedAssetBytes this
 * never copies a phone video into Worker memory, which is essential for the
 * R2 -> normalizer -> Gemini ingestion path.
 */
export async function readUploadedAssetStream(
  db: D1Database,
  input: GetAssetInput,
): Promise<{
  asset: MarketplaceAssetRow
  body: ReadableStream<Uint8Array>
  contentType: string
  originalName: string
  sizeBytes: number
}> {
  const { asset, readUrl } = await getReadableAsset(db, input)
  const mode = resolveStorageMode()

  if (mode === 'mock') {
    const bytes = readMockObject(asset.object_key)
    return {
      asset,
      body: new Blob([Uint8Array.from(bytes)]).stream(),
      contentType: asset.content_type,
      originalName: asset.original_name,
      sizeBytes: bytes.length,
    }
  }

  if (mode === 'r2' && !isR2SigningConfigured()) {
    const object = await getWorkerUploadsBucket().then((bucket) => bucket?.get(asset.object_key))
    if (!object?.body) throw new Error('OBJECT_NOT_FOUND')
    return {
      asset,
      body: object.body as ReadableStream<Uint8Array>,
      contentType: object.httpMetadata?.contentType || asset.content_type,
      originalName: asset.original_name,
      sizeBytes: object.size || asset.size_bytes,
    }
  }

  const response = await fetch(readUrl)
  if (!response.ok || !response.body) throw new Error(`ASSET_READ_FAILED:${response.status}`)
  return {
    asset,
    body: response.body,
    contentType: response.headers.get('content-type') || asset.content_type,
    originalName: asset.original_name,
    sizeBytes: Number(response.headers.get('content-length')) || asset.size_bytes,
  }
}

/**
 * Persist the FFmpeg-normalized tape as a distinct R2 asset. The original
 * upload remains immutable and is the canonical user source; downstream AI
 * always consumes this H.264/AAC derivative.
 */
export async function storeNormalizedAnalysisAsset(
  db: D1Database,
  input: {
    sourceAssetId: string
    userId: string
    body: ReadableStream<Uint8Array>
    expectedSizeBytes: number
  },
): Promise<MarketplaceAssetRow> {
  const source = await getAssetRow(db, input.sourceAssetId)
  if (!source) throw new Error('NOT_FOUND')
  if (source.owner_user_id !== input.userId) throw new Error('FORBIDDEN')
  if (source.purpose !== 'analysis_clip' || source.status !== 'uploaded') {
    throw new Error('ORIGINAL_ASSET_NOT_READY')
  }

  const id = newId('asset')
  const now = new Date().toISOString()
  const objectKey = buildObjectKey(input.userId, 'analysis_clip', `${source.original_name}.normalized.mp4`)
  const contentType = 'video/mp4'
  const mode = resolveStorageMode()
  let storedSize = 0

  if (mode === 'mock') {
    const bytes = new Uint8Array(await new Response(input.body).arrayBuffer())
    writeMockObject(objectKey, bytes)
    storedSize = bytes.byteLength
  } else {
    const bucket = await getWorkerUploadsBucket()
    if (!bucket) throw new Error('NORMALIZED_STORAGE_UNAVAILABLE')
    try {
      await putWorkerR2Object(bucket, {
        key: objectKey,
        body: input.body,
        sizeBytes: input.expectedSizeBytes,
        contentType,
      })
    } catch {
      throw new Error('NORMALIZED_STORAGE_UNAVAILABLE')
    }
    const head = await bucket.head(objectKey)
    storedSize = Number(head?.size || 0)
  }

  if (!Number.isFinite(storedSize) || storedSize <= 0) {
    throw new Error('NORMALIZED_STORAGE_INCOMPLETE')
  }
  if (Number.isFinite(input.expectedSizeBytes) && input.expectedSizeBytes > 0 && storedSize !== input.expectedSizeBytes) {
    throw new Error('NORMALIZED_STORAGE_SIZE_MISMATCH')
  }

  await db
    .prepare(
      `INSERT INTO marketplace_assets (
         id, owner_user_id, job_id, dispute_id, purpose, bucket, object_key,
         original_name, content_type, size_bytes, status, created_at, uploaded_at, updated_at
       ) VALUES (?, ?, NULL, NULL, 'analysis_clip', ?, ?, ?, ?, ?, 'uploaded', ?, ?, ?)`,
    )
    .bind(
      id,
      input.userId,
      source.bucket,
      objectKey,
      `${source.original_name}.normalized.mp4`.slice(0, 180),
      contentType,
      storedSize,
      now,
      now,
      now,
    )
    .run()

  const stored = await getAssetRow(db, id)
  if (!stored) throw new Error('NORMALIZED_STORAGE_INCOMPLETE')
  return stored
}

export async function markAssetFailed(db: D1Database, assetId: string, userId: string): Promise<void> {
  const asset = await getAssetRow(db, assetId)
  if (!asset) throw new Error('NOT_FOUND')
  if (asset.owner_user_id !== userId) throw new Error('FORBIDDEN')
  const now = new Date().toISOString()
  await db
    .prepare(`UPDATE marketplace_assets SET status = 'failed', updated_at = ? WHERE id = ?`)
    .bind(now, assetId)
    .run()
}

export async function assertUploadedAssetsOwned(
  db: D1Database,
  assetIds: string[],
  userId: string,
  purpose?: MarketplaceAssetPurpose,
): Promise<void> {
  for (const assetId of assetIds) {
    const asset = await getAssetRow(db, assetId)
    if (!asset) throw new Error(`Asset not found: ${assetId}`)
    if (asset.owner_user_id !== userId) throw new Error('FORBIDDEN')
    if (asset.status !== 'uploaded') throw new Error(`Asset not ready: ${assetId}`)
    if (purpose && asset.purpose !== purpose) throw new Error(`Invalid asset purpose: ${assetId}`)
  }
}

export type { MarketplaceAssetStatus }
