#!/usr/bin/env node
/**
 * Marketplace wiring test loop — run before shipping marketplace changes.
 *
 *   pnpm test:marketplace
 *   pnpm test:marketplace -- --build   # also run next build (slower)
 */
import { spawnSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const withBuild = process.argv.includes('--build')

function run(cmd, args) {
  console.log(`\n> ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: true })
  if (r.status !== 0) {
    console.error(`\n[marketplace-test-loop] FAILED: ${cmd} ${args.join(' ')}`)
    process.exit(r.status ?? 1)
  }
}

function section(title) {
  console.log(`\n${'='.repeat(60)}\n  ${title}\n${'='.repeat(60)}`)
}

section('1/4 — D1 migration chain')
run('node', ['scripts/test-migrations.mjs'])

section('2/4 — TypeScript')
run('npx', ['tsc', '--noEmit'])

section('3/4 — Marketplace + storage + stripe unit tests')
run('npx', [
  'vitest',
  'run',
  'src/lib/stripe/stripeClient.test.ts',
  'src/lib/storage/assets.test.ts',
  'src/lib/marketplace/__tests__/jobs.test.ts',
  'src/lib/marketplace/__tests__/connect.test.ts',
  'src/lib/marketplace/__tests__/moneyMovement.test.ts',
  'src/lib/marketplace/__tests__/lifecycle.test.ts',
  'src/lib/marketplace/__tests__/coachRank.test.ts',
  'src/lib/marketplace/__tests__/coachRankStore.test.ts',
  'src/lib/marketplace/__tests__/coachPromotion.test.ts',
])

if (withBuild) {
  section('4/4 — Production build')
  run('pnpm', ['run', 'build'])
} else {
  section('4/4 — Production build (skipped; pass --build to include)')
}

console.log('\n✓ Marketplace test loop complete.\n')
