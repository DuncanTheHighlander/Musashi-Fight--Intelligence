#!/usr/bin/env node
/**
 * Validates production env before `next start` / deploy.
 * Mirrors src/lib/env.ts rules without loading Next.js.
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const envFile = join(root, '.env.local')
const errors = []

function loadEnvFile(path) {
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvFile(envFile)

const isProd = process.env.NODE_ENV === 'production' || process.argv.includes('--production')
if (!isProd) {
  console.log('[check-prod-env] NODE_ENV is not production — skipping strict checks')
  process.exit(0)
}

const required = ['GEMINI_API_KEY', 'MUSASHI_SESSION_SECRET']
for (const key of required) {
  const val = process.env[key]?.trim()
  if (!val || /your-|placeholder|change-me/i.test(val)) {
    errors.push(`Missing or placeholder: ${key}`)
  }
}

if (process.env.MUSASHI_DISABLE_AUTH === '1') {
  errors.push('MUSASHI_DISABLE_AUTH=1 must NOT be set in production')
}

const shogunPw = process.env.MUSASHI_SHOGUN_PASSWORD || ''
if (/ChangeThisSecurePassword|password123|change-me/i.test(shogunPw)) {
  errors.push('MUSASHI_SHOGUN_PASSWORD uses a default/weak value')
}

if (errors.length) {
  console.error('[check-prod-env] Production env validation failed:')
  for (const e of errors) console.error(`  - ${e}`)
  console.error('\nUse a production .env without MUSASHI_DISABLE_AUTH and strong secrets.')
  process.exit(1)
}

console.log('[check-prod-env] OK')
process.exit(0)
