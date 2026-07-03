import { existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const defaultOutputDir = '.open-next'
const defaultAttempts = 5
const defaultDelayMs = 500

export async function cleanOpenNextOutput({
  outputDir = defaultOutputDir,
  attempts = defaultAttempts,
  delayMs = defaultDelayMs,
  removeOutput = rmSync,
} = {}) {
  if (!existsSync(outputDir)) {
    return { removed: false, attempts: 0 }
  }

  let lastError

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      removeOutput(outputDir, { recursive: true, force: true })
      return { removed: true, attempts: attempt }
    } catch (error) {
      lastError = error

      if (attempt < attempts) {
        await delay(delayMs)
      }
    }
  }

  throw lastError
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await cleanOpenNextOutput()

  if (result.removed) {
    console.log(`Removed stale OpenNext output in ${result.attempts} attempt(s).`)
  }
}
