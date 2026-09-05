import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  approveJob,
  applyTransition,
  claimJob,
  createJob,
  ensureAnalystProfile,
  fundJob,
  releaseJob,
  submitJob,
} from '../jobs'
import { createMockD1 } from '../mockD1'
import {
  assertUploadedAssetsOwned,
  completeUpload,
  createUploadTicket,
} from '@/lib/storage/assets'
import { toAssetRef } from '@/lib/storage/assetRef'
import { writeMockObject } from '@/lib/storage/mockStorage'

async function seedAnalyst(db: ReturnType<typeof createMockD1>, userId: string) {
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT OR IGNORE INTO users (id, role, email, password_hash, first_name, last_name, created_at, updated_at)
       VALUES (?, 'client', ?, '', 'Test', 'Analyst', ?, ?)`,
    )
    .bind(userId, `${userId}@example.test`, now, now)
    .run()
  await ensureAnalystProfile(db, userId)
  await db
    .prepare('UPDATE analyst_profiles SET is_analyst_enabled = 1, belt_tier = ? WHERE user_id = ?')
    .bind('blue', userId)
    .run()
}

describe('marketplace lifecycle with uploads', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('full bounty flow with uploaded job video and deliverable asset refs', async () => {
    vi.stubEnv('MUSASHI_STORAGE_MODE', 'mock')
    const db = createMockD1()
    const analystId = 'lifecycle_analyst'
    await seedAnalyst(db, analystId)

    const videoBytes = Buffer.from('video-bytes')
    const videoTicket = await createUploadTicket(db, {
      userId: 'dev',
      purpose: 'job_video',
      originalName: 'sparring.mp4',
      contentType: 'video/mp4',
      sizeBytes: videoBytes.length,
      origin: 'http://localhost:3000',
    })
    writeMockObject(videoTicket.asset.object_key, videoBytes)
    await completeUpload(db, { assetId: videoTicket.asset.id, userId: 'dev' })
    await assertUploadedAssetsOwned(db, [videoTicket.asset.id], 'dev', 'job_video')

    const job = await createJob(db, {
      fighterId: 'dev',
      jobType: 'open_bounty',
      title: 'Lifecycle bounty',
      brief: 'Check footwork',
      amountCents: 5000,
      videos: [toAssetRef(videoTicket.asset.id)],
      clientRequestId: 'lifecycle_full_flow',
    })
    const funded = await fundJob(db, { jobId: job.id, actorUserId: 'dev' })
    expect(funded.status).toBe('FUNDED')

    const claimed = await claimJob(db, { jobId: job.id, analystId })
    expect(claimed.status).toBe('CLAIMED')

    const started = await applyTransition(db, {
      jobId: job.id,
      event: 'START',
      actorUserId: analystId,
    })
    expect(started.status).toBe('IN_PROGRESS')

    const deliverableBytes = Buffer.from('pdf-bytes')
    const deliverableTicket = await createUploadTicket(db, {
      userId: analystId,
      purpose: 'deliverable',
      originalName: 'breakdown.pdf',
      contentType: 'application/pdf',
      sizeBytes: deliverableBytes.length,
      jobId: job.id,
      origin: 'http://localhost:3000',
    })
    writeMockObject(deliverableTicket.asset.object_key, deliverableBytes)
    await completeUpload(db, { assetId: deliverableTicket.asset.id, userId: analystId })

    const submitted = await submitJob(db, {
      jobId: job.id,
      analystId,
      deliverableUrl: toAssetRef(deliverableTicket.asset.id),
      deliverableNotes: 'Focus on guard recovery.',
    })
    expect(submitted.status).toBe('SUBMITTED')

    await approveJob(db, { jobId: job.id, actorUserId: 'dev' })
    const released = await releaseJob(db, { jobId: job.id, actorUserId: 'dev' })
    expect(released.status).toBe('RELEASED')
    expect(released.deliverable_url).toBe(toAssetRef(deliverableTicket.asset.id))
  })
})
