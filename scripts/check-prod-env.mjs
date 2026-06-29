#!/usr/bin/env node
/**
 * Validates production env before `next start` / deploy.
 * Mirrors src/lib/env.ts rules without loading Next.js.
 *
 * Modes:
 *   --production   Validates .env.local for `next start` (default with flag)
 *   --cloudflare   Validates wrangler.toml for Cloudflare deploy (ignores .env.local dev flags)
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const envFile = join(root, '.env.local')
const wranglerFile = join(root, 'wrangler.toml')
const errors = []
const warnings = []

const isCloudflare = process.argv.includes('--cloudflare')
const isProd =
  isCloudflare ||
  process.env.NODE_ENV === 'production' ||
  process.argv.includes('--production')

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

function parseWranglerToml(path) {
  if (!existsSync(path)) return { vars: {}, requiredSecrets: [], storeBindings: [] }
  const text = readFileSync(path, 'utf8')
  const vars = {}
  const requiredSecrets = []
  const varsMatch = text.match(/\[vars\]([\s\S]*?)(?=\n\[|\n#|\Z)/)
  if (varsMatch) {
    for (const line of varsMatch[1].split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"/)
      if (m) vars[m[1]] = m[2]
    }
  }

  const secretsMatch = text.match(/\[secrets\][\s\S]*?required\s*=\s*\[([\s\S]*?)\]/)
  if (secretsMatch) {
    for (const m of secretsMatch[1].matchAll(/"([^"]+)"/g)) {
      requiredSecrets.push(m[1])
    }
  }

  const storeBindings = []
  for (const block of text.split('[[secrets_store_secrets]]').slice(1)) {
    const binding = block.match(/binding\s*=\s*"([^"]+)"/)?.[1]
    const secretName = block.match(/secret_name\s*=\s*"([^"]+)"/)?.[1]
    if (binding && secretName) storeBindings.push({ binding, secretName })
  }

  return { vars, requiredSecrets, storeBindings }
}

const isPlaceholder = (v) =>
  !v || /your-|placeholder|change-me|generate-a-strong|xxx|YOUR_/i.test(String(v))

const has = (key) => !isPlaceholder(process.env[key]?.trim())

function validateCloudflareDeploy() {
  const { vars, requiredSecrets, storeBindings } = parseWranglerToml(wranglerFile)

  if (!existsSync(wranglerFile)) {
    errors.push('Missing wrangler.toml')
    return
  }

  if (vars.MUSASHI_MARKETPLACE_PAYMENTS !== 'stripe') {
    errors.push(
      `wrangler.toml [vars] MUSASHI_MARKETPLACE_PAYMENTS must be "stripe" (got "${vars.MUSASHI_MARKETPLACE_PAYMENTS || 'unset'}")`,
    )
  }
  if (vars.MUSASHI_STORAGE_MODE !== 'r2') {
    errors.push(
      `wrangler.toml [vars] MUSASHI_STORAGE_MODE must be "r2" (got "${vars.MUSASHI_STORAGE_MODE || 'unset'}")`,
    )
  }
  if (vars.NODE_ENV !== 'production') {
    errors.push(
      `wrangler.toml [vars] NODE_ENV must be "production" (got "${vars.NODE_ENV || 'unset'}")`,
    )
  }

  if (storeBindings.length === 0) {
    warnings.push('No secrets_store_secrets bindings found in wrangler.toml')
  } else {
    console.log('[check-prod-env] Secrets Store bindings (account-level, pre-provisioned):')
    for (const { binding, secretName } of storeBindings) {
      console.log(`  - ${binding} → store secret "${secretName}"`)
    }
    console.log('')
  }

  console.log('[check-prod-env] Per-Worker secrets — set via `wrangler secret put` before deploy:')
  for (const key of requiredSecrets) {
    console.log(`  - ${key}`)
  }
  console.log('')

  if (!requiredSecrets.includes('MUSASHI_APP_URL')) {
    warnings.push('MUSASHI_APP_URL not listed in wrangler.toml [secrets].required')
  }

  console.log('[check-prod-env] After login, verify secrets with:')
  console.log('  pnpm exec wrangler secret list')
  console.log(
    '  pnpm exec wrangler secrets-store secret list 3a6ee7307f0b482ab4b3f3dd6794168c --remote',
  )
  console.log('')
}

if (!isProd) {
  console.log('[check-prod-env] NODE_ENV is not production — skipping strict checks')
  process.exit(0)
}

if (isCloudflare) {
  validateCloudflareDeploy()
} else {
  loadEnvFile(envFile)

  const required = [
    'GEMINI_API_KEY',
    'MUSASHI_SESSION_SECRET',
    'MUSASHI_SHOGUN_EMAIL',
    'MUSASHI_CRON_SECRET',
    'MUSASHI_APP_URL',
  ]
  for (const key of required) {
    if (!has(key)) errors.push(`Missing or placeholder: ${key}`)
  }

  const shogunPw = process.env.MUSASHI_SHOGUN_PASSWORD || ''
  const shogunHash = process.env.MUSASHI_SHOGUN_PASSWORD_HASH || ''
  if (!shogunHash && (!shogunPw || /ChangeThisSecurePassword|password123|change-me/i.test(shogunPw))) {
    errors.push('Set MUSASHI_SHOGUN_PASSWORD (strong) or MUSASHI_SHOGUN_PASSWORD_HASH')
  }

  if (process.env.MUSASHI_DISABLE_AUTH === '1') {
    errors.push('MUSASHI_DISABLE_AUTH=1 must NOT be set in production')
  }

  const paymentMode = String(process.env.MUSASHI_MARKETPLACE_PAYMENTS || 'mock').toLowerCase()
  if (paymentMode === 'stripe') {
    for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET']) {
      if (!has(key)) errors.push(`Stripe marketplace mode requires: ${key}`)
    }
  }

  const storageMode = String(process.env.MUSASHI_STORAGE_MODE || '').toLowerCase()
  const storageIsR2 =
    storageMode === 'r2' ||
    (has('STORAGE_SERVICE_URL') &&
      has('STORAGE_ACCESS_KEY') &&
      has('STORAGE_SECRET_KEY') &&
      has('STORAGE_BUCKET_NAME'))
  if (storageIsR2) {
    for (const key of [
      'STORAGE_SERVICE_URL',
      'STORAGE_ACCESS_KEY',
      'STORAGE_SECRET_KEY',
      'STORAGE_BUCKET_NAME',
    ]) {
      if (!has(key)) errors.push(`R2 storage requires: ${key}`)
    }
  } else if (isProd) {
    warnings.push('MUSASHI_STORAGE_MODE is mock — uploads use local storage (not for production)')
  }

  if (paymentMode === 'mock' && isProd) {
    warnings.push('MUSASHI_MARKETPLACE_PAYMENTS=mock — no real marketplace charges in production')
  }
}

for (const icon of ['musashi-icon-192.png', 'musashi-icon-512.png']) {
  if (!existsSync(join(root, 'public', icon))) {
    warnings.push(`Missing public/${icon} — run: pnpm icons`)
  }
}

if (errors.length) {
  console.error('[check-prod-env] Production env validation failed:')
  for (const e of errors) console.error(`  - ${e}`)
  if (warnings.length) {
    console.error('\nWarnings:')
    for (const w of warnings) console.error(`  - ${w}`)
  }
  console.error('\nSee docs/DEPLOY_CHECKLIST.md')
  process.exit(1)
}

console.log('[check-prod-env] OK')
if (warnings.length) {
  console.log('Warnings:')
  for (const w of warnings) console.warn(`  - ${w}`)
}
process.exit(0)
