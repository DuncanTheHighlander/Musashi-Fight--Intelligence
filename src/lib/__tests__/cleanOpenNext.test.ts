import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'

const tempRoots: string[] = []

const createTempRoot = () => {
  const root = mkdtempSync(join(tmpdir(), 'musashi-clean-open-next-'))
  tempRoots.push(root)
  return root
}

afterEach(() => {
  vi.restoreAllMocks()

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('cleanOpenNextOutput', () => {
  test('removes an existing OpenNext output directory', async () => {
    const { cleanOpenNextOutput } = await import('../../../scripts/clean-open-next.mjs')
    const root = createTempRoot()
    const outputDir = join(root, '.open-next')
    mkdirSync(outputDir)
    writeFileSync(join(outputDir, 'worker.js'), 'old build')

    const result = await cleanOpenNextOutput({ outputDir, delayMs: 0 })

    expect(result.removed).toBe(true)
    expect(result.attempts).toBe(1)
    expect(existsSync(outputDir)).toBe(false)
  })

  test('does nothing when output directory is missing', async () => {
    const { cleanOpenNextOutput } = await import('../../../scripts/clean-open-next.mjs')
    const root = createTempRoot()

    const result = await cleanOpenNextOutput({
      outputDir: join(root, '.open-next'),
      delayMs: 0,
    })

    expect(result).toEqual({ removed: false, attempts: 0 })
  })

  test('retries transient filesystem delete failures', async () => {
    const { cleanOpenNextOutput } = await import('../../../scripts/clean-open-next.mjs')
    const root = createTempRoot()
    const outputDir = join(root, '.open-next')
    mkdirSync(outputDir)
    writeFileSync(join(outputDir, 'worker.js'), 'old build')

    const removeOutput = vi
      .fn()
      .mockImplementationOnce(() => {
        const error = new Error('directory not empty') as NodeJS.ErrnoException
        error.code = 'ENOTEMPTY'
        throw error
      })
      .mockImplementation((path, options) => rmSync(path, options))

    const result = await cleanOpenNextOutput({ outputDir, delayMs: 0, removeOutput })

    expect(result).toEqual({ removed: true, attempts: 2 })
    expect(removeOutput).toHaveBeenCalledTimes(2)
  })
})
