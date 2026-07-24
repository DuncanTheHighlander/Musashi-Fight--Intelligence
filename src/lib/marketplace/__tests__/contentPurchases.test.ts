import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMockD1 } from '../mockD1'
import { purchaseContentProduct } from '../contentPurchases'

describe('purchaseContentProduct', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  test('rejects zero-price content in stripe mode', async () => {
    vi.stubEnv('MUSASHI_MARKETPLACE_PAYMENTS', 'stripe')
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')

    const db = createMockD1()
    const now = new Date().toISOString()
    await db
      .prepare(
        `INSERT INTO users (id, role, email, password_hash, first_name, last_name, created_at, updated_at)
         VALUES ('creator', 'client', 'creator@test', '', 'Creator', 'User', ?, ?)`,
      )
      .bind(now, now)
      .run()
    await db
      .prepare(
        `INSERT INTO content_products (
           id, creator_id, title, description, type, price, currency, is_published, video_url, created_at, updated_at
         ) VALUES ('prod_free', 'creator', 'Free clip', '', 'breakdown', 0, 'USD', 1, 'https://example.test/video.mp4', ?, ?)`,
      )
      .bind(now, now)
      .run()

    await expect(
      purchaseContentProduct({
        db,
        req: new Request('https://app.musashi.ai/api/social/marketplace/prod_free/purchase'),
        productId: 'prod_free',
        buyer: { id: 'buyer', email: 'buyer@test' },
      }),
    ).rejects.toThrow(/at least \$0\.01/)
  })
})
