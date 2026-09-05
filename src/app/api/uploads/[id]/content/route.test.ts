import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PUT } from './route'
import { createUploadTicket } from '@/lib/storage/assets'
import type { D1Database } from '@/lib/db'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'

const { getWorkerUploadsBucketMock } = vi.hoisted(() => ({
  getWorkerUploadsBucketMock: vi.fn(),
}))
const { putWorkerR2ObjectMock } = vi.hoisted(() => ({
  putWorkerR2ObjectMock: vi.fn(),
}))
const { resolveStorageModeMock, isR2SigningConfiguredMock } = vi.hoisted(() => ({
  resolveStorageModeMock: vi.fn(),
  isR2SigningConfiguredMock: vi.fn(),
}))

vi.mock('@/lib/storage/workerR2', () => ({
  getWorkerUploadsBucket: getWorkerUploadsBucketMock,
  putWorkerR2Object: putWorkerR2ObjectMock,
}))
vi.mock('@/lib/storage/r2', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/storage/r2')>()
  return {
    ...actual,
    resolveStorageMode: resolveStorageModeMock,
    isR2SigningConfigured: isR2SigningConfiguredMock,
  }
})

describe('PUT /api/uploads/[id]/content', () => {
  let db: D1Database

  beforeEach(() => {
    vi.stubEnv('MUSASHI_DISABLE_AUTH', '1')
    vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'mock')
    resolveStorageModeMock.mockReturnValue('mock')
    isR2SigningConfiguredMock.mockReturnValue(false)
    db = createMockD1()
    pinMockD1(db)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    getWorkerUploadsBucketMock.mockReset()
    putWorkerR2ObjectMock.mockReset()
    resolveStorageModeMock.mockReset()
    isR2SigningConfiguredMock.mockReset()
    unpinMockD1()
  })

  it('accepts mock-mode bytes for pending asset', async () => {
    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'job_video',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 64,
      origin: 'http://localhost:3000',
    })

    const res = await PUT(
      new Request(`http://localhost/api/uploads/${ticket.asset.id}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        body: Buffer.from('mock-upload'),
      }),
      { params: Promise.resolve({ id: ticket.asset.id }) },
    )

    expect(res.status).toBe(200)
  })

  it('returns 405 when storage mode is r2', async () => {
    resolveStorageModeMock.mockReturnValue('r2')
    isR2SigningConfiguredMock.mockReturnValue(true)

    const res = await PUT(
      new Request('http://localhost/api/uploads/asset_x/content', {
        method: 'PUT',
        body: Buffer.from('x'),
      }),
      { params: Promise.resolve({ id: 'asset_x' }) },
    )
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBe(405)
    expect(body.error).toMatch(/mock storage/i)
  })

  it('streams to the bound R2 bucket without invalid HTTP metadata', async () => {
    resolveStorageModeMock.mockReturnValue('r2')
    isR2SigningConfiguredMock.mockReturnValue(false)
    const bucket = { put: vi.fn() }
    getWorkerUploadsBucketMock.mockResolvedValue(bucket)
    putWorkerR2ObjectMock.mockResolvedValue(undefined)

    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'analysis_clip',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 64,
      origin: 'http://localhost:3000',
    })

    const res = await PUT(
      new Request(`http://localhost/api/uploads/${ticket.asset.id}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
        body: Buffer.from('r2-upload'),
      }),
      { params: Promise.resolve({ id: ticket.asset.id }) },
    )

    expect(res.status).toBe(200)
    expect(putWorkerR2ObjectMock).toHaveBeenCalledWith(bucket, {
      key: ticket.asset.object_key,
      body: expect.any(ReadableStream),
      sizeBytes: 64,
      contentType: 'video/mp4',
    })
  })

  it('rejects Worker PUT when the authenticated user does not own the asset', async () => {
    resolveStorageModeMock.mockReturnValue('r2')
    isR2SigningConfiguredMock.mockReturnValue(false)
    getWorkerUploadsBucketMock.mockResolvedValue({ put: vi.fn() })

    const ticket = await createUploadTicket(db, {
      userId: 'another-user',
      purpose: 'analysis_clip',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 64,
    })
    const res = await PUT(
      new Request(`http://localhost/api/uploads/${ticket.asset.id}/content`, {
        method: 'PUT',
        body: Buffer.alloc(64),
      }),
      { params: Promise.resolve({ id: ticket.asset.id }) },
    )

    expect(res.status).toBe(403)
    expect(putWorkerR2ObjectMock).not.toHaveBeenCalled()
  })

  it('rejects Worker PUT once the asset is no longer pending_upload', async () => {
    resolveStorageModeMock.mockReturnValue('r2')
    isR2SigningConfiguredMock.mockReturnValue(false)
    getWorkerUploadsBucketMock.mockResolvedValue({ put: vi.fn() })

    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'analysis_clip',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 64,
    })
    await db
      .prepare(`UPDATE marketplace_assets SET status = 'uploaded' WHERE id = ?`)
      .bind(ticket.asset.id)
      .run()

    const res = await PUT(
      new Request(`http://localhost/api/uploads/${ticket.asset.id}/content`, {
        method: 'PUT',
        body: Buffer.alloc(64),
      }),
      { params: Promise.resolve({ id: ticket.asset.id }) },
    )
    const body = (await res.json()) as { error?: string }

    expect(res.status).toBe(409)
    expect(body.error).toMatch(/no longer pending/i)
    expect(putWorkerR2ObjectMock).not.toHaveBeenCalled()
  })
})
