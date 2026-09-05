import { describe, expect, it } from 'vitest'
import { aiErrorResponse } from './aiGuard'

describe('aiErrorResponse', () => {
  it('returns an actionable response for an unverified account', async () => {
    const res = aiErrorResponse(new Error('EMAIL_NOT_VERIFIED'))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      code: 'EMAIL_NOT_VERIFIED',
      error: expect.stringMatching(/verify your email/i),
      hint: expect.stringMatching(/profile/i),
    })
  })

  it('returns an actionable response when the daily no-video allowance is exhausted', async () => {
    const res = aiErrorResponse(new Error('NO_CLIP_CHAT_QUOTA'))
    expect(res.status).toBe(402)
    expect(await res.json()).toMatchObject({
      code: 'NO_CLIP_CHAT_QUOTA',
      error: expect.stringMatching(/no-video coaching limit/i),
      hint: expect.stringMatching(/daily reset/i),
    })
  })
})
