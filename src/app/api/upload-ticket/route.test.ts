import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requireUserMock, createUploadTicketMock, getDbMock } = vi.hoisted(() => ({
  requireUserMock: vi.fn(),
  createUploadTicketMock: vi.fn(),
  getDbMock: vi.fn(() => ({})),
}))

vi.mock('@/lib/musashiAuth', () => ({
  requireUser: requireUserMock,
}))

vi.mock('@/lib/marketplace/types', () => ({
  getDb: getDbMock,
}))

vi.mock('@/lib/storage/assets', () => ({
  createUploadTicket: createUploadTicketMock,
}))

import { POST } from './route'

describe('POST /api/upload-ticket', () => {
  beforeEach(() => {
    requireUserMock.mockReset()
    createUploadTicketMock.mockReset()
    requireUserMock.mockResolvedValue({ id: 'user_1', role: 'free' })
  })

  it('returns presignedUrl + assetId and forces requireDirectR2', async () => {
    createUploadTicketMock.mockResolvedValue({
      asset: {
        id: 'asset_abc',
        object_key: 'marketplace/analysis_clip/user_1/x.mp4',
        status: 'pending_upload',
        purpose: 'analysis_clip',
        content_type: 'video/mp4',
      },
      upload: {
        provider: 'r2',
        method: 'PUT',
        url: 'https://account.r2.cloudflarestorage.com/musashi-uploads/key?X-Amz-Signature=abc',
        headers: { 'Content-Type': 'video/mp4' },
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      },
    })

    const res = await POST(
      new Request('https://app.duncanazsmith.workers.dev/api/upload-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalName: 'phone.mov',
          contentType: 'video/quicktime',
          sizeBytes: 180_000_000,
        }),
      }),
    )

    expect(res.status).toBe(201)
    const json = (await res.json()) as { assetId: string; presignedUrl: string }
    expect(json.assetId).toBe('asset_abc')
    expect(json.presignedUrl).toMatch(/^https:\/\/account\.r2\.cloudflarestorage\.com/)
    expect(createUploadTicketMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        purpose: 'analysis_clip',
        requireDirectR2: true,
        sizeBytes: 180_000_000,
      }),
    )
  })

  it('returns 413 when signing is unavailable', async () => {
    createUploadTicketMock.mockRejectedValue(new Error('DIRECT_R2_REQUIRED'))
    const res = await POST(
      new Request('https://app.duncanazsmith.workers.dev/api/upload-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          originalName: 'phone.mov',
          contentType: 'video/quicktime',
          sizeBytes: 180_000_000,
        }),
      }),
    )
    expect(res.status).toBe(413)
    const json = (await res.json()) as { code: string }
    expect(json.code).toBe('DIRECT_R2_REQUIRED')
  })
})
