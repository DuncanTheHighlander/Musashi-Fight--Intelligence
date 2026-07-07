import { existsSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const defaultOutputDir = '.open-next'
const defaultOutputDirs = ['.open-next', '.next']
const defaultAttempts = 5
const defaultDelayMs = 500

export async function cleanBuildOutput({
  outputDirs = defaultOutputDirs,
  attempts = defaultAttempts,
  delayMs = defaultDelayMs,
  removeOutput = rmSync,
} = {}) {
  const results = []

  for (const outputDir of outputDirs) {
    if (!existsSync(outputDir)) {
      results.push({ outputDir, removed: false, attempts: 0 })
      continue
    }

    let lastError

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        removeOutput(outputDir, { recursive: true, force: true })
        results.push({ outputDir, removed: true, attempts: attempt })
        lastError = undefined
        break
      } catch (error) {
        lastError = error

        if (attempt < attempts) {
          await delay(delayMs)
        }
      }
    }

    if (lastError) {
      throw lastError
    }
  }

  return results
}

export async function cleanOpenNextOutput(options = {}) {
  const outputDir = options.outputDir ?? defaultOutputDir
  const [result] = await cleanBuildOutput({
    ...options,
    outputDirs: [outputDir],
  })
  const { removed, attempts } = result
  return { removed, attempts }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const outputDirs = process.argv.includes('--open-next-only')
    ? [defaultOutputDir]
    : defaultOutputDirs
  const results = await cleanBuildOutput({ outputDirs })

  for (const result of results) {
    if (result.removed) {
      console.log(`Removed stale ${result.outputDir} output in ${result.attempts} attempt(s).`)
    }
  }
}
