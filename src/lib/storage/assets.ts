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
import { mockObjectExists, mockObjectSize } from './mockStorage'
import {
  assertStorageConfigured,
  createSignedReadUrl,
  createSignedUploadUrl,
  resolveStorageMode,
  type SignedR2Url,
} from './r2'

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
    provider: 'mock' | 'r2'
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

function validateUploadInput(input: CreateUploadTicketInput): void {
  const contentType = String(input.contentType || '').toLowerCase().split(';')[0].trim()
  const sizeBytes = Math.trunc(Number(input.sizeBytes) || 0)
  if (sizeBytes <= 0) throw new Error('sizeBytes required')
  if (!input.originalName?.trim()) throw new Error('originalName required')

  switch (input.purpose) {
    case 'job_video':
      if (!JOB_VIDEO_TYPES.has(contentType)) throw new Error('Unsupported content type for job video')
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
    case 'analysis_clip':
      if (!JOB_VIDEO_TYPES.has(contentType)) throw new Error('Unsupported content type for analysis clip')
      if (sizeBytes > MAX_JOB_VIDEO_BYTES) throw new Error('File too large (max 500 MB)')
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
  const bucket = mode === 'r2' ? assertStorageConfigured().bucket : mockBucketName()

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
  if (mode === 'r2') {
    signed = await createSignedUploadUrl({ key: objectKey, contentType })
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
      provider: mode,
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
  if (asset.status === 'uploaded') return asset

  const mode = resolveStorageMode()
  let sizeBytes = Math.trunc(Number(input.sizeBytes) || asset.size_bytes)
  if (mode === 'mock') {
    if (!mockObjectExists(asset.object_key)) throw new Error('UPLOAD_INCOMPLETE')
    sizeBytes = mockObjectSize(asset.object_key) || sizeBytes
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
    .bind(sizeBytes, input.sha256 ?? null, now, now, input.assetId)
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
    const readUrl = await createSignedReadUrl({ key: asset.object_key })
    return { asset, readUrl }
  }
  return { asset, readUrl: `/api/uploads/${asset.id}/content` }
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
