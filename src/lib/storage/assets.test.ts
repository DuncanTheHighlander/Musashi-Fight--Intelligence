import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMockD1 } from '@/lib/marketplace/mockD1'
import { createUploadTicket, completeUpload } from './assets'
import { writeMockObject } from './mockStorage'

describe('upload assets', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
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
    writeMockObject(ticket.asset.object_key, Buffer.from('pdf-bytes'))
    const completed = await completeUpload(db, {
      assetId: ticket.asset.id,
      userId: 'dev',
    })
    expect(completed.status).toBe('uploaded')
    expect(completed.size_bytes).toBeGreaterThan(0)
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
