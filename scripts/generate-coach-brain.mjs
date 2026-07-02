#!/usr/bin/env node
/**
 * Generates src/lib/coachBrain/brains.generated.ts from coach-brain/**\/*.md.
 *
 * Why generated instead of fs.readFile at runtime: the app deploys to
 * Cloudflare Workers (open-next), where there is no filesystem. The markdown
 * under coach-brain/ stays the human-editable source of truth; this script
 * inlines it into a TS module the prompt builders can import anywhere.
 *
 * Run after editing any coach-brain markdown:
 *   pnpm gen:coach-brain
 *
 * A vitest guard (src/lib/coachBrain/coachBrain.test.ts) fails when the
 * generated file is out of sync with the markdown.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const brainDir = join(root, 'coach-brain')
const outFile = join(root, 'src', 'lib', 'coachBrain', 'brains.generated.ts')

function collectMarkdown(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectMarkdown(full))
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

const files = collectMarkdown(brainDir)
  .map((full) => ({
    key: relative(brainDir, full).replaceAll('\\', '/'),
    content: readFileSync(full, 'utf8').replace(/\r\n/g, '\n'),
  }))
  .sort((a, b) => a.key.localeCompare(b.key))

const entries = files
  .map((f) => `  ${JSON.stringify(f.key)}: ${JSON.stringify(f.content)},`)
  .join('\n')

const ts = `/**
 * AUTO-GENERATED from coach-brain/**\\/*.md — do not edit by hand.
 * Source of truth: the markdown files under coach-brain/.
 * Regenerate with: pnpm gen:coach-brain
 */

export const COACH_BRAIN_FILES: Record<string, string> = {
${entries}
}
`

mkdirSync(dirname(outFile), { recursive: true })
writeFileSync(outFile, ts, 'utf8')
console.log(`[coach-brain] Wrote ${files.length} markdown files into ${relative(root, outFile)}`)
