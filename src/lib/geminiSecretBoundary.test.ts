import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith('.test.ts')) return []
    return [path]
  })

describe('Gemini production secret boundary', () => {
  it('does not bypass the Cloudflare Secrets Store resolver at runtime', () => {
    const offenders = sourceFiles(join(process.cwd(), 'src')).filter((path) => {
      const source = readFileSync(path, 'utf8')
      return (
        /process\.env\.GEMINI_API_KEY/.test(source) ||
        /readSecretEnv\(\s*['"]GEMINI_API_KEY['"]\s*\)/.test(source)
      )
    })

    expect(offenders).toEqual([])
  })
})
