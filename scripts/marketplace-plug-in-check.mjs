#!/usr/bin/env node
/**
 * Reports which launch API keys/secrets are set vs missing.
 * Never fails in dev — use --strict for production gate (exit 1 if gaps remain).
 *
 *   node scripts/marketplace-plug-in-check.mjs
 *   node scripts/marketplace-plug-in-check.mjs --strict
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const strict = process.argv.includes('--strict')
const skipTests = process.argv.includes('--skip-tests')

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

loadEnvFile(join(root, '.env.local'))
loadEnvFile(join(root, '.env'))

const isPlaceholder = (v) =>
  !v ||
  /your-|placeholder|change-me|change-this|generate-a-strong|xxx|YOUR_/i.test(v)

const has = (key) => !isPlaceholder(process.env[key]?.trim())

const paymentMode = String(process.env.MUSASHI_MARKETPLACE_PAYMENTS || 'mock').toLowerCase()
const emailVerificationRequired = process.env.MUSASHI_REQUIRE_EMAIL_VERIFIED !== '0'
const storageMode =
  String(process.env.MUSASHI_STORAGE_MODE || '').toLowerCase() ||
  (has('STORAGE_SERVICE_URL') &&
  has('STORAGE_ACCESS_KEY') &&
  has('STORAGE_SECRET_KEY') &&
  has('STORAGE_BUCKET_NAME')
    ? 'r2'
    : 'mock')

const groups = [
  {
    title: 'Always required for production',
    items: [
      { key: 'GEMINI_API_KEY', label: 'Gemini AI' },
      { key: 'MUSASHI_SESSION_SECRET', label: 'Session secret' },
      { key: 'MUSASHI_SHOGUN_EMAIL', label: 'Admin email' },
      { key: 'MUSASHI_SHOGUN_PASSWORD', label: 'Admin password (or hash)' },
      { key: 'MUSASHI_CRON_SECRET', label: 'Cron secret' },
      { key: 'MUSASHI_APP_URL', label: 'Public app URL (Connect return links)' },
      ...(emailVerificationRequired
        ? [{ key: 'EMAIL_API_KEY', label: 'Email (required for verify/reset)' }]
        : []),
    ],
  },
  {
    title: 'Cloudflare deploy (CI or manual)',
    items: [
      { key: 'CLOUDFLARE_ACCOUNT_ID', label: 'Account ID (CI)', optional: true },
      { key: 'CLOUDFLARE_API_TOKEN', label: 'API token (CI)', optional: true },
    ],
  },
  {
    title: `Marketplace payments (${paymentMode} mode)`,
    items:
      paymentMode === 'stripe'
        ? [
            { key: 'STRIPE_SECRET_KEY', label: 'Stripe secret' },
            { key: 'STRIPE_PUBLISHABLE_KEY', label: 'Stripe publishable' },
            { key: 'STRIPE_WEBHOOK_SECRET', label: 'Stripe webhook secret' },
          ]
        : [{ key: 'MUSASHI_MARKETPLACE_PAYMENTS', label: 'Set to stripe for real money', mockOk: true }],
  },
  {
    title: `Upload storage (${storageMode} mode)`,
    items:
      storageMode === 'r2'
        ? [
            { key: 'STORAGE_SERVICE_URL', label: 'R2 endpoint' },
            { key: 'STORAGE_ACCESS_KEY', label: 'R2 access key' },
            { key: 'STORAGE_SECRET_KEY', label: 'R2 secret key' },
            { key: 'STORAGE_BUCKET_NAME', label: 'R2 bucket' },
          ]
        : [{ key: 'MUSASHI_STORAGE_MODE', label: 'Set to r2 + STORAGE_* for prod uploads', mockOk: true }],
  },
  {
    title: 'Optional later',
    items: [
      ...(!emailVerificationRequired
        ? [{ key: 'EMAIL_API_KEY', label: 'Email (verify/reset)', optional: true }]
        : []),
      { key: 'MUSASHI_STRIPE_PRICE_ID_PRO', label: 'Pro subscription price', optional: true },
      { key: 'FAL_KEY', label: 'fal.ai segmentation', optional: true },
    ],
  },
]

const blockers = []
const warnings = []

console.log('\n=== Musashi marketplace plug-in checklist ===\n')
console.log(`Payment mode: ${paymentMode}`)
console.log(`Storage mode: ${storageMode}`)
console.log(`Auth bypass:  ${process.env.MUSASHI_DISABLE_AUTH === '1' ? 'ON (dev only)' : 'off'}\n`)

for (const group of groups) {
  console.log(group.title)
  for (const item of group.items) {
    const ok = item.mockOk || has(item.key)
    const mark = ok ? '✓' : item.optional ? '○' : '✗'
    console.log(`  ${mark} ${item.label} (${item.key})`)
    if (!ok && !item.optional) blockers.push(item.key)
    if (!ok && item.optional) warnings.push(item.key)
  }
  console.log('')
}

if (process.env.MUSASHI_DISABLE_AUTH === '1') {
  blockers.push('MUSASHI_DISABLE_AUTH must be off in production')
  console.log('  ✗ MUSASHI_DISABLE_AUTH=1 — remove before launch\n')
}

if (strict && paymentMode !== 'stripe') {
  blockers.push('MUSASHI_MARKETPLACE_PAYMENTS must be stripe')
  console.log('  âœ— Strict launch requires MUSASHI_MARKETPLACE_PAYMENTS=stripe\n')
}

if (strict && storageMode !== 'r2') {
  blockers.push('MUSASHI_STORAGE_MODE must be r2')
  console.log('  âœ— Strict launch requires MUSASHI_STORAGE_MODE=r2\n')
}

const shogunPw = process.env.MUSASHI_SHOGUN_PASSWORD || ''
if (/ChangeThisSecurePassword|password123/i.test(shogunPw)) {
  blockers.push('MUSASHI_SHOGUN_PASSWORD is still default')
  console.log('  ✗ Default shogun password detected\n')
}

if (!skipTests) {
  console.log('Running marketplace test loop (no build)...')
  const r = spawnSync('node', ['scripts/marketplace-test-loop.mjs'], {
    cwd: root,
    stdio: 'inherit',
    shell: true,
  })
  if (r.status !== 0) {
    console.error('\n[plug-in-check] Marketplace tests FAILED')
    process.exit(r.status ?? 1)
  }
}

console.log('--- Summary ---')
if (blockers.length === 0) {
  console.log('Code is ready. Plug in the missing keys above, then deploy.')
  console.log('\nNext steps:')
  console.log('  1. Copy .env.example → production secrets in Cloudflare')
  console.log('  2. pnpm db:migrate:remote')
  console.log('  3. Deploy from WSL/CI: pnpm deploy')
  console.log('  4. Stripe webhook → /api/billing/webhook')
  console.log('  5. Smoke: signup → onboarding → post bounty → Connect payout')
  console.log('\nSee docs/MARKETPLACE_LAUNCH.md\n')
  process.exit(0)
}

console.log(`Blockers (${blockers.length}): ${blockers.join(', ')}`)
if (warnings.length) console.log(`Optional gaps: ${warnings.join(', ')}`)

if (strict) {
  console.error('\n[plug-in-check] Strict mode: fix blockers before deploy.\n')
  process.exit(1)
}

console.log('\nDev mode OK — blockers above are expected until you plug in production keys.\n')
process.exit(0)
