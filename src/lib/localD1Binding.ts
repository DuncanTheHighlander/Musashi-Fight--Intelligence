/**
 * Local D1 wiring via wrangler — Node.js only.
 * Imported from instrumentation.node.ts (Node.js only).
 */
import 'server-only'

export async function initLocalD1Binding(): Promise<void> {
  const env = process.env as {
    DB?: { prepare: (q: string) => unknown }
    MUSASHI_D1_LOCAL?: string
  }
  if (env.DB?.prepare) return
  if (env.MUSASHI_D1_LOCAL !== '1') return

  try {
    const { getPlatformProxy } = await import(
      /* webpackIgnore: true */ 'wrangler'
    )
    const proxy = await getPlatformProxy({
      configPath: 'wrangler.toml',
      persist: true,
      remoteBindings: false,
    })
    const db = (proxy.env as { DB?: typeof env.DB }).DB
    if (db?.prepare) {
      env.DB = db
      console.log('[Musashi] Local D1 binding initialized')
    }
  } catch (e) {
    console.warn('[Musashi] Local D1 init failed:', e instanceof Error ? e.message : e)
  }
}
