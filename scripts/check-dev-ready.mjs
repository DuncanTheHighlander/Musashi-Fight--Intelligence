#!/usr/bin/env node
/**
 * Pre-flight checks before `pnpm dev`.
 * Exits 0 when ready; prints actionable errors and exits 1 otherwise.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createConnection } from 'node:net'
import { join } from 'node:path'

const root = process.cwd()
const port = Number(process.env.MUSASHI_DEV_PORT || 3000)
const skipPort = process.env.MUSASHI_SKIP_PORT_CHECK === '1'
const errors = []
const warnings = []

function portListening(p) {
  return new Promise((resolve) => {
    const socket = createConnection({ port: p, host: '127.0.0.1' })
    socket.once('connect', () => {
      socket.destroy()
      resolve(true)
    })
    socket.once('error', () => resolve(false))
    socket.setTimeout(1500, () => {
      socket.destroy()
      resolve(false)
    })
  })
}

async function healthOk(p) {
  try {
    const res = await fetch(`http://127.0.0.1:${p}/api/health`, {
      signal: AbortSignal.timeout(3000),
    })
    return res.ok
  } catch {
    return false
  }
}

if (!existsSync(join(root, 'node_modules', 'next'))) {
  errors.push('Dependencies missing. Run: pnpm install')
}

const envPath = join(root, '.env.local')
if (!existsSync(envPath)) {
  errors.push('Missing .env.local. Copy .env.example → .env.local and set GEMINI_API_KEY.')
} else {
  const envText = readFileSync(envPath, 'utf8')
  if (!/^GEMINI_API_KEY=\s*\S+/m.test(envText)) {
    warnings.push('GEMINI_API_KEY is empty in .env.local — AI routes will be limited.')
  }
  if (/your-gemini-api-key-here/i.test(envText)) {
    warnings.push('GEMINI_API_KEY still uses the .env.example placeholder.')
  }
  if (!/^MUSASHI_DISABLE_AUTH=1/m.test(envText) && !/^MUSASHI_D1_LOCAL=1/m.test(envText)) {
    warnings.push(
      'For local dev without Cloudflare, set MUSASHI_DISABLE_AUTH=1 in .env.local (see README).'
    )
  }
}

if (!skipPort) {
  const listening = await portListening(port)
  if (listening) {
    const healthy = await healthOk(port)
    if (healthy) {
      console.log(`[check-dev-ready] Musashi already running on http://localhost:${port}`)
      process.exit(0)
    }
    errors.push(
      `Port ${port} is in use but /api/health did not respond. ` +
        `Stop the stale process (Task Manager → Node, or: Get-NetTCPConnection -LocalPort ${port} | Select OwningProcess) ` +
        `or run: pnpm dev:alt (port 3001).`
    )
  }
}

for (const w of warnings) console.warn(`[check-dev-ready] WARN: ${w}`)
if (errors.length) {
  for (const e of errors) console.error(`[check-dev-ready] ERROR: ${e}`)
  process.exit(1)
}

console.log('[check-dev-ready] OK — ready to start dev server')
process.exit(0)
