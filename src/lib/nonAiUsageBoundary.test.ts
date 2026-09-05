import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const routeFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? routeFiles(path) : entry.name === 'route.ts' ? [path] : []
  })

describe('non-AI API quota boundary', () => {
  it('does not charge AI chat usage for social or notification requests', () => {
    const roots = [
      join(process.cwd(), 'src', 'app', 'api', 'social'),
      join(process.cwd(), 'src', 'app', 'api', 'notifications'),
    ]
    const offenders = roots
      .flatMap(routeFiles)
      .filter((path) => /\benforceUsage\b/.test(readFileSync(path, 'utf8')))

    expect(offenders).toEqual([])
  })
})
