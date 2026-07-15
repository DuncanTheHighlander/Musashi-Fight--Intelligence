import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockD1, pinMockD1, unpinMockD1 } from '@/lib/marketplace/mockD1'
import {
  commitVideoAnalysisCredit,
  getVideoCreditBalance,
  releaseVideoAnalysisCredit,
  reserveVideoAnalysisCredit,
} from '@/lib/videoAnalysisSessions'

const USER_ID = 'credit-test-user'
const ROLE = 'user' as const

beforeEach(() => {
  vi.stubEnv('MUSASHI_USE_MOCK_DB', '1')
  vi.stubEnv('MUSASHI_DISABLE_AUTH', '0')
  vi.stubEnv('NODE_ENV', 'test')
  pinMockD1(createMockD1())
})

afterEach(() => {
  unpinMockD1()
  vi.unstubAllEnvs()
})

describe('video analysis credit lifecycle', () => {
  it('does not charge a failed upload reservation', async () => {
    const before = await getVideoCreditBalance(USER_ID, ROLE)
    expect(before).toMatchObject({ tier: 'free', limit: 3, used: 0, remaining: 3 })

    const held = await reserveVideoAnalysisCredit(USER_ID, ROLE, {
      sessionId: 'reserve-only-session-0001',
      clipDurationSec: 10,
    })
    expect(held).toMatchObject({ used: 0, reserved: 1, remaining: 2 })

    await releaseVideoAnalysisCredit(USER_ID, 'reserve-only-session-0001', 'GEMINI_UPLOAD_FAILED')
    const after = await getVideoCreditBalance(USER_ID, ROLE)
    expect(after).toMatchObject({ used: 0, reserved: 0, remaining: 3 })
  })

  it('commits once after a usable provider file and dedupes retry', async () => {
    const sessionId = 'successful-session-0002'
    await reserveVideoAnalysisCredit(USER_ID, ROLE, { sessionId, clipDurationSec: 10 })

    const first = await commitVideoAnalysisCredit(USER_ID, ROLE, {
      sessionId,
      clipKey: 'files/gemini-successful-clip',
    })
    expect(first).toMatchObject({ used: 1, reserved: 0, remaining: 2 })

    const retry = await commitVideoAnalysisCredit(USER_ID, ROLE, {
      sessionId,
      clipKey: 'files/gemini-successful-clip',
    })
    expect(retry).toMatchObject({ used: 1, reserved: 0, remaining: 2 })
  })

  it('does not double-charge simultaneous commits for one session', async () => {
    const sessionId = 'parallel-commit-session-0003'
    await reserveVideoAnalysisCredit(USER_ID, ROLE, { sessionId, clipDurationSec: 10 })

    const commits = await Promise.allSettled([
      commitVideoAnalysisCredit(USER_ID, ROLE, {
        sessionId,
        clipKey: 'files/gemini-parallel-clip',
      }),
      commitVideoAnalysisCredit(USER_ID, ROLE, {
        sessionId,
        clipKey: 'files/gemini-parallel-clip',
      }),
    ])

    expect(commits.filter((commit) => commit.status === 'fulfilled')).toHaveLength(1)
    expect(commits.filter((commit) => commit.status === 'rejected')).toHaveLength(1)
    const balance = await getVideoCreditBalance(USER_ID, ROLE)
    expect(balance).toMatchObject({ used: 1, reserved: 0, remaining: 2 })
  })

  it('enforces three successful Free analyses', async () => {
    for (let i = 0; i < 3; i++) {
      const sessionId = `free-credit-session-${String(i).padStart(4, '0')}`
      await reserveVideoAnalysisCredit(USER_ID, ROLE, { sessionId, clipDurationSec: 10 })
      await commitVideoAnalysisCredit(USER_ID, ROLE, {
        sessionId,
        clipKey: `files/gemini-free-${i}`,
      })
    }

    await expect(
      reserveVideoAnalysisCredit(USER_ID, ROLE, {
        sessionId: 'fourth-free-credit-0004',
        clipDurationSec: 10,
      }),
    ).rejects.toThrow('FREE_VIDEO_QUOTA')
  })

  it('does not over-reserve when many upload attempts start together', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, (_, i) =>
        reserveVideoAnalysisCredit(USER_ID, ROLE, {
          sessionId: `parallel-upload-session-${String(i).padStart(4, '0')}`,
          clipDurationSec: 10,
        }),
      ),
    )

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(3)
    const balance = await getVideoCreditBalance(USER_ID, ROLE)
    expect(balance).toMatchObject({ used: 0, reserved: 3, remaining: 0 })
  })
})
