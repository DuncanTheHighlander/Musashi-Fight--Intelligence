import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMockD1 } from '@/lib/marketplace/mockD1'
import { createUploadTicket, completeUpload, MAX_WORKER_PROXY_UPLOAD_BYTES } from './assets'
import { writeMockObject } from './mockStorage'

const { getWorkerUploadsBucketMock, putWorkerR2ObjectMock } = vi.hoisted(() => ({
  getWorkerUploadsBucketMock: vi.fn(),
  putWorkerR2ObjectMock: vi.fn(),
}))

vi.mock('./workerR2', () => ({
  getWorkerUploadsBucket: getWorkerUploadsBucketMock,
  putWorkerR2Object: putWorkerR2ObjectMock,
}))

function configurePresignedR2Mode() {
  vi.stubEnv('MUSASHI_STORAGE_MODE', 'r2')
  vi.stubEnv('NODE_ENV', 'production')
  vi.stubEnv('STORAGE_SERVICE_URL', 'https://account.r2.cloudflarestorage.com')
  vi.stubEnv('STORAGE_ACCESS_KEY', 'test-access-key')
  vi.stubEnv('STORAGE_SECRET_KEY', 'test-secret-key')
  vi.stubEnv('STORAGE_BUCKET_NAME', 'test-uploads')
}

describe('upload assets', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    getWorkerUploadsBucketMock.mockReset()
    putWorkerR2ObjectMock.mockReset()
  })

  test('mock mode works without R2 keys', async () => {
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'mock')
    const db = createMockD1()
    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'job_video',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1024,
      origin: 'http://localhost:3000',
    })
    expect(ticket.upload.provider).toBe('mock')
    expect(ticket.upload.url).toContain('/api/uploads/')
    expect(ticket.asset.status).toBe('pending_upload')
  })

  test('rejects invalid content type for job video', async () => {
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'mock')
    const db = createMockD1()
    await expect(
      createUploadTicket(db, {
        userId: 'dev',
        purpose: 'job_video',
        originalName: 'clip.txt',
        contentType: 'text/plain',
        sizeBytes: 100,
      }),
    ).rejects.toThrow('Unsupported content type')
  })

  test('coerces octet-stream analysis_clip from .mp4 name', async () => {
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'mock')
    const db = createMockD1()
    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'analysis_clip',
      originalName: 'roll.mp4',
      contentType: 'application/octet-stream',
      sizeBytes: 2048,
      origin: 'http://localhost:3000',
    })
    expect(ticket.asset.content_type).toBe('video/mp4')
  })

  test('complete marks asset uploaded after mock bytes land', async () => {
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'mock')
    const db = createMockD1()
    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'deliverable',
      originalName: 'notes.pdf',
      contentType: 'application/pdf',
      sizeBytes: 42,
      origin: 'http://localhost:3000',
    })
    writeMockObject(ticket.asset.object_key, Buffer.alloc(42, 1))
    const completed = await completeUpload(db, {
      assetId: ticket.asset.id,
      userId: 'dev',
    })
    expect(completed.status).toBe('uploaded')
    expect(completed.size_bytes).toBe(42)
  })

  test('mock completion rejects bytes that do not match the ticketed size', async () => {
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'mock')
    const db = createMockD1()
    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'analysis_clip',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 12,
    })
    writeMockObject(ticket.asset.object_key, Buffer.alloc(11))

    await expect(
      completeUpload(db, { assetId: ticket.asset.id, userId: 'dev', sizeBytes: 12 }),
    ).rejects.toThrow('UPLOAD_SIZE_MISMATCH')
  })

  test('worker fallback uses a same-origin relative upload URL', async () => {
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'r2')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('STORAGE_SERVICE_URL', '')
    vi.stubEnv('STORAGE_ACCESS_KEY', '')
    vi.stubEnv('STORAGE_SECRET_KEY', '')
    vi.stubEnv('STORAGE_BUCKET_NAME', '')
    getWorkerUploadsBucketMock.mockResolvedValue({ head: vi.fn() })

    const ticket = await createUploadTicket(createMockD1(), {
      userId: 'dev',
      purpose: 'analysis_clip',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 64,
      origin: 'https://untrusted-forwarded-host.example',
    })

    expect(ticket.upload.provider).toBe('worker')
    expect(ticket.upload.url).toBe(`/api/uploads/${ticket.asset.id}/content`)
  })

  test('worker fallback rejects large originals before issuing an unusable ticket', async () => {
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'r2')
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('STORAGE_SERVICE_URL', '')
    vi.stubEnv('STORAGE_ACCESS_KEY', '')
    vi.stubEnv('STORAGE_SECRET_KEY', '')
    vi.stubEnv('STORAGE_BUCKET_NAME', '')
    getWorkerUploadsBucketMock.mockResolvedValue({ head: vi.fn() })

    await expect(createUploadTicket(createMockD1(), {
      userId: 'dev',
      purpose: 'analysis_clip',
      originalName: 'phone.mov',
      contentType: 'video/quicktime',
      sizeBytes: MAX_WORKER_PROXY_UPLOAD_BYTES + 1,
    })).rejects.toThrow('DIRECT_R2_REQUIRED')
  })

  test('presigned completion still verifies R2 HEAD and exact ticketed size', async () => {
    configurePresignedR2Mode()
    const head = vi.fn().mockResolvedValue({ size: 64 })
    getWorkerUploadsBucketMock.mockResolvedValue({ head })
    const db = createMockD1()
    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'analysis_clip',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 64,
    })

    const completed = await completeUpload(db, {
      assetId: ticket.asset.id,
      userId: 'dev',
      sizeBytes: 64,
    })

    expect(completed.status).toBe('uploaded')
    expect(ticket.upload.provider).toBe('r2')
    expect(head).toHaveBeenCalledWith(ticket.asset.object_key)
  })

  test('R2 completion rejects missing, zero-byte, and mismatched objects', async () => {
    configurePresignedR2Mode()
    const head = vi.fn()
    getWorkerUploadsBucketMock.mockResolvedValue({ head })
    const db = createMockD1()
    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'analysis_clip',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 64,
    })

    head.mockResolvedValueOnce(null)
    await expect(
      completeUpload(db, { assetId: ticket.asset.id, userId: 'dev' }),
    ).rejects.toThrow('UPLOAD_INCOMPLETE')

    head.mockResolvedValueOnce({ size: 0 })
    await expect(
      completeUpload(db, { assetId: ticket.asset.id, userId: 'dev' }),
    ).rejects.toThrow('UPLOAD_INCOMPLETE')

    head.mockResolvedValueOnce({ size: 63 })
    await expect(
      completeUpload(db, { assetId: ticket.asset.id, userId: 'dev' }),
    ).rejects.toThrow('UPLOAD_SIZE_MISMATCH')
  })

  test('uploaded completion is idempotent only while R2 remains consistent', async () => {
    configurePresignedR2Mode()
    const head = vi.fn().mockResolvedValue({ size: 64 })
    getWorkerUploadsBucketMock.mockResolvedValue({ head })
    const db = createMockD1()
    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'analysis_clip',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 64,
    })

    await completeUpload(db, { assetId: ticket.asset.id, userId: 'dev' })
    const repeated = await completeUpload(db, { assetId: ticket.asset.id, userId: 'dev' })
    expect(repeated.status).toBe('uploaded')
    expect(head).toHaveBeenCalledTimes(2)

    head.mockResolvedValue({ size: 63 })
    await expect(
      completeUpload(db, { assetId: ticket.asset.id, userId: 'dev' }),
    ).rejects.toThrow('UPLOAD_SIZE_MISMATCH')
  })

  test('r2 mode falls back to mock in non-production when storage is not configured', async () => {
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'r2')
    vi.stubEnv('STORAGE_SERVICE_URL', '')
    vi.stubEnv('NODE_ENV', 'development')
    const db = createMockD1()
    const ticket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'job_video',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1024,
      origin: 'http://localhost:3000',
    })
    expect(ticket.upload.provider).toBe('mock')
  })

  test('r2 mode fails closed in production when storage is not configured', async () => {
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'r2')
    vi.stubEnv('STORAGE_SERVICE_URL', '')
    vi.stubEnv('NODE_ENV', 'production')
    const db = createMockD1()
    await expect(
      createUploadTicket(db, {
        userId: 'dev',
        purpose: 'job_video',
        originalName: 'clip.mp4',
        contentType: 'video/mp4',
        sizeBytes: 1024,
      }),
    ).rejects.toThrow('STORAGE_NOT_CONFIGURED')
  })
})
