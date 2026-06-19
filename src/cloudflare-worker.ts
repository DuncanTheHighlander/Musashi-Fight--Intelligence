/**
 * Cloudflare Worker entry — re-exports OpenNext fetch handler and runs
 * marketplace cron on the wrangler scheduled trigger (~every 5 minutes).
 */
// @ts-expect-error `.open-next/worker.js` is generated at build time
import { default as handler } from '../.open-next/worker.js'
import { runMarketplaceCron } from './lib/marketplace/cron'
import type { D1Database } from './lib/marketplace/types'

type Env = {
  DB?: D1Database
  MUSASHI_CRON_SECRET?: string
}

export default {
  fetch: handler.fetch,

  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    const db = env.DB
    if (!db?.prepare) {
      console.error('marketplace cron: DB binding missing')
      return
    }
    ctx.waitUntil(
      runMarketplaceCron(db).catch((err) => {
        console.error('marketplace cron failed', err)
      }),
    )
  },
} satisfies ExportedHandler<Env>

// Re-export if the app uses DO queue / tag cache (OpenNext Cloudflare optional)
// @ts-expect-error generated at build time
export { DOQueueHandler, DOShardedTagCache } from '../.open-next/worker.js'
