/**
 * Node.js-only instrumentation — env validation and local D1 init.
 * Loaded dynamically from instrumentation.ts (Node runtime only).
 */
import 'server-only'

import { initLocalD1Binding } from '@/lib/localD1Binding'

export async function registerNodeInstrumentation(): Promise<void> {
  const { validateEnv, validateProductionSecrets } = await import('@/lib/env')
  const result = validateEnv()
  const secretWarnings = await validateProductionSecrets()

  for (const w of [...result.warnings, ...secretWarnings]) {
    console.warn(`[Musashi] WARNING: ${w}`)
  }

  if (!result.valid) {
    for (const e of result.errors) {
      console.error(`[Musashi] ENV ERROR: ${e}`)
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        `[Musashi] Production environment validation failed:\n${result.errors.join('\n')}`
      )
    }
  }

  if (process.env.MUSASHI_D1_LOCAL === '1') {
    await initLocalD1Binding()
  }

  console.log('[Musashi] Environment validation passed.')
}
