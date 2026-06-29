import { describe, expect, test } from 'vitest'
import { createMockD1 } from '@/lib/marketplace/mockD1'
import { consumeEmailToken, createEmailToken } from './emailTokens'

describe('email tokens', () => {
  test('consumes token only once for matching purpose', async () => {
    const db = createMockD1()
    const created = await createEmailToken(db, {
      userId: 'dev',
      email: 'dev@local',
      purpose: 'verify_email',
      ttlMs: 60_000,
    })

    await expect(consumeEmailToken(db, created.token, 'verify_email')).resolves.toMatchObject({
      userId: 'dev',
      email: 'dev@local',
    })
    await expect(consumeEmailToken(db, created.token, 'verify_email')).rejects.toThrow('TOKEN_INVALID')
  })

  test('rejects wrong purpose', async () => {
    const db = createMockD1()
    const created = await createEmailToken(db, {
      userId: 'dev',
      email: 'dev@local',
      purpose: 'verify_email',
      ttlMs: 60_000,
    })

    await expect(consumeEmailToken(db, created.token, 'password_reset')).rejects.toThrow('TOKEN_INVALID')
  })

  test('rejects expired token', async () => {
    const db = createMockD1()
    const created = await createEmailToken(db, {
      userId: 'dev',
      email: 'dev@local',
      purpose: 'password_reset',
      ttlMs: -1,
    })

    await expect(consumeEmailToken(db, created.token, 'password_reset')).rejects.toThrow('TOKEN_EXPIRED')
  })
})
