import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const outputDir = '.open-next'
const workerPath = join(outputDir, 'worker.js')
const handlerPath = join(outputDir, 'server-functions', 'default', 'handler.mjs')

if (!existsSync(workerPath)) {
  throw new Error('OpenNext output is missing .open-next/worker.js')
}

if (existsSync(handlerPath)) {
  const before = readFileSync(handlerPath, 'utf8')
  const after = before.replaceAll(
    'import(url5,{with:{[CF_ATTR]:CF_NO_CACHE_VALUE}})',
    'import(url5)'
  )

  if (after !== before) {
    writeFileSync(handlerPath, after)
    console.log('Patched generated OpenNext import attributes for Wrangler bundling.')
  }
}

const assetsDir = join(outputDir, 'assets')
const maxAssetBytes = 25_000_000
let removed = 0

const walk = (dir) => {
  if (!existsSync(dir)) return

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(path)
      continue
    }

    if (entry.isFile() && statSync(path).size > maxAssetBytes) {
      rmSync(path, { force: true })
      removed += 1
    }
  }
}

walk(assetsDir)

if (removed > 0) {
  console.log(`Removed ${removed} generated asset(s) over Cloudflare's 25 MB asset limit.`)
}
