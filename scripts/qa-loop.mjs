#!/usr/bin/env node
/**
 * Musashi QA loop — run before ship or after pipeline changes.
 *
 *   pnpm test:loop          fast (tsc + unit tests + offline replay gates)
 *   pnpm test:loop --e2e    also run browser dense-pass on 3 clips (slow, needs dev server)
 *
 * Fast loop (~30s): proves identity/kinematics + replay JSON still meet baselines.
 * E2E loop (~15–45 min): proves live MediaPipe dense pass in browser (optional).
 */
import { spawnSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const args = process.argv.slice(2)
const runE2e = args.includes('--e2e')
const skipTsc = args.includes('--skip-tsc')

function run(cmd, cmdArgs, opts = {}) {
  console.log(`\n> ${cmd} ${cmdArgs.join(' ')}`)
  const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit', shell: true, ...opts })
  if (r.status !== 0) {
    console.error(`\n[qa-loop] FAILED: ${cmd} ${cmdArgs.join(' ')}`)
    process.exit(r.status ?? 1)
  }
}

function section(title) {
  console.log(`\n${'='.repeat(60)}\n  ${title}\n${'='.repeat(60)}`)
}

section('1/5 — Test videos on disk')
const manifest = JSON.parse(readFileSync(join(root, 'public/test-videos/clips.manifest.json'), 'utf8'))
let missingVideos = 0
for (const clip of manifest.clips) {
  const p = join(root, 'public/test-videos', clip.file)
  const ok = existsSync(p)
  console.log(`  ${ok ? '✓' : '✗'} ${clip.id}: ${clip.file}${ok ? '' : ' (MISSING — add to public/test-videos/)'}`)
  if (!ok) missingVideos++
}
if (missingVideos) {
  console.warn(`\n  ${missingVideos} test video(s) missing. E2E clip loop will skip; offline replay still runs.`)
}

section('2/5 — RTMPose model (optional upgrade)')
const rtmPath = join(root, 'public/models/rtmpose-halpe26.onnx')
const rtmReady = existsSync(rtmPath)
console.log(`  RTMPose ONNX: ${rtmReady ? '✓ present' : '✗ not installed (MediaPipe-only — OK for ship)'}`)
if (!rtmReady) {
  console.log('  To test RTM: pnpm fetch:rtm-model  then  ?poseBackend=rtmpose')
}

if (!skipTsc) {
  section('3/5 — TypeScript')
  run('npx', ['tsc', '--noEmit'])
} else {
  section('3/5 — TypeScript (skipped)')
}

section('4/5 — Unit tests (identity + kinematics + boot)')
run('npx', [
  'vitest',
  'run',
  'src/lib/identityTracking.test.ts',
  'src/lib/kinematics.test.ts',
  'src/lib/__tests__/bootVerification.test.ts',
  'src/lib/pose/fighterSelection.test.ts',
])

section('5/5 — Offline replay vs baselines (3 clips)')
const evalDir = 'tracking-eval-2026-06-11'
run('node', [
  'scripts/trackEval.mjs',
  '--compare',
  join(evalDir, 'baselines.json'),
  `clip1=${join(evalDir, 'clip1_replay_v14.json')}`,
  `clip2=${join(evalDir, 'clip2_replay_v14.json')}`,
  `clip3=${join(evalDir, 'clip3_replay_v14.json')}`,
])

run('node', ['scripts/jointEval.mjs',
  join(evalDir, 'clip1_replay_v14.json'),
  join(evalDir, 'clip2_replay_v14.json'),
  join(evalDir, 'clip3_replay_v14.json'),
])

if (runE2e) {
  section('6/6 — Browser E2E dense pass (3 clips)')
  if (missingVideos) {
    console.error('[qa-loop] Cannot run E2E — test videos missing.')
    process.exit(1)
  }
  run('node', ['scripts/e2e-clip-loop.mjs', '--url', process.env.MUSASHI_QA_URL || 'http://localhost:3000'])
}

console.log('\n✓ QA loop complete.')
if (!rtmReady) {
  console.log('  Note: RTMPose not tested (no model). MediaPipe path verified.')
}
console.log('  Browser manual loop: http://localhost:3000/?qaLoop=1')
console.log('  RTM A/B: add ?poseBackend=rtmpose (after fetch:rtm-model)\n')
