/**
 * Local readiness check for Musashi cloud pose.
 *
 * This never prints secret values. It reads .env.local/.env for presence only
 * and verifies local files/tools needed before Modal deploy and app proxy use.
 *
 * Usage:
 *   node scripts/check-cloud-pose-ready.mjs
 *   node scripts/check-cloud-pose-ready.mjs --online  # also checks Modal auth
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const online = process.argv.includes('--online')

function loadEnvFile(file) {
  const out = {}
  const path = join(root, file)
  if (!existsSync(path)) return out
  const text = readFileSync(path, 'utf8')
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq < 1) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

const fileEnv = {
  ...loadEnvFile('.env'),
  ...loadEnvFile('.env.local'),
}
const env = { ...fileEnv, ...process.env }
let poseTokenSource = 'environment'
const localPoseTokenPath = join(root, '.tools', 'pose_api_token.txt')
if (!String(env.POSE_API_TOKEN ?? '').trim() && existsSync(localPoseTokenPath)) {
  const localPoseToken = readFileSync(localPoseTokenPath, 'utf8').trim()
  if (localPoseToken) {
    env.POSE_API_TOKEN = localPoseToken
    poseTokenSource = '.tools/pose_api_token.txt'
  }
}

const placeholderMarkers = [
  'your-',
  'your_',
  'change-me',
  'changeme',
  'replace-me',
  'placeholder',
  '<',
  '>',
]

function hasSecret(key) {
  const value = String(env[key] ?? '').trim()
  if (!value) return false
  const lower = value.toLowerCase()
  return !placeholderMarkers.some((marker) => lower.includes(marker))
}

function fileStatus(path, opts = {}) {
  const abs = join(root, path)
  if (!existsSync(abs)) return { ok: false, note: 'missing' }
  if (opts.minBytes) {
    const size = statSync(abs).size
    if (size < opts.minBytes) return { ok: false, note: `too small (${size} bytes)` }
    return { ok: true, note: `${Math.round(size / 1024 / 1024)} MB` }
  }
  return { ok: true, note: 'present' }
}

function commandExists(command, args = ['--version']) {
  const result = spawnSync(command, args, { cwd: root, shell: false, encoding: 'utf8' })
  return {
    ok: result.status === 0,
    note: (result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || (result.error?.message ?? 'not found'),
  }
}

const modalCli = isWin
  ? join(root, '.tools', 'modal-venv', 'Scripts', 'modal.exe')
  : join(root, '.tools', 'modal-venv', 'bin', 'modal')

const checks = []
function add(name, ok, note) {
  checks.push({ name, ok, note })
}

for (const [path, opts] of [
  ['public/models/rtmpose-halpe26.onnx', { minBytes: 40 * 1024 * 1024 }],
  ['cloud/pose_pipeline.py', {}],
  ['cloud/modal_app.py', {}],
  ['cloud/modal_cpu_app.py', {}],
  ['src/app/api/fight/cloud-pose/route.ts', {}],
]) {
  const status = fileStatus(path, opts)
  add(path, status.ok, status.note)
}

const modalStatus = existsSync(modalCli)
  ? commandExists(modalCli, ['--version'])
  : commandExists('modal', ['--version'])
add('Modal CLI installed', modalStatus.ok, modalStatus.note)

if (online) {
  const modalCommand = existsSync(modalCli) ? modalCli : 'modal'
  const result = spawnSync(modalCommand, ['app', 'list'], {
    cwd: root,
    shell: false,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
    },
  })
  add(
    'Modal auth token works',
    result.status === 0,
    result.error?.code === 'ETIMEDOUT'
      ? 'timed out after 30s'
      : (result.stdout || result.stderr || '').trim().split(/\r?\n/)[0] || result.error?.message || 'no output'
  )
}

add(
  'POSE_API_TOKEN for Modal deploy shell',
  hasSecret('POSE_API_TOKEN'),
  hasSecret('POSE_API_TOKEN') ? `set (${poseTokenSource})` : 'missing'
)
add(
  'MUSASHI_POSE_CLOUD_TOKEN for app proxy',
  hasSecret('MUSASHI_POSE_CLOUD_TOKEN'),
  hasSecret('MUSASHI_POSE_CLOUD_TOKEN') ? 'set' : 'missing until Modal deploy'
)
add(
  'MUSASHI_POSE_CLOUD_GPU_URL',
  hasSecret('MUSASHI_POSE_CLOUD_GPU_URL'),
  hasSecret('MUSASHI_POSE_CLOUD_GPU_URL') ? 'set' : 'missing until Modal GPU deploy'
)
add(
  'MUSASHI_POSE_CLOUD_CPU_URL',
  hasSecret('MUSASHI_POSE_CLOUD_CPU_URL'),
  hasSecret('MUSASHI_POSE_CLOUD_CPU_URL') ? 'set' : 'optional, missing'
)
add('Gemini API key', hasSecret('GEMINI_API_KEY'), hasSecret('GEMINI_API_KEY') ? 'set' : 'missing')
add('R2 endpoint', hasSecret('STORAGE_SERVICE_URL'), hasSecret('STORAGE_SERVICE_URL') ? 'set' : 'missing')
add('R2 access key', hasSecret('STORAGE_ACCESS_KEY'), hasSecret('STORAGE_ACCESS_KEY') ? 'set' : 'missing')
add('R2 secret key', hasSecret('STORAGE_SECRET_KEY'), hasSecret('STORAGE_SECRET_KEY') ? 'set' : 'missing')
add('R2 bucket', hasSecret('STORAGE_BUCKET_NAME'), hasSecret('STORAGE_BUCKET_NAME') ? 'set' : 'missing')

const width = Math.max(...checks.map((c) => c.name.length), 10)
console.log('=== Musashi cloud pose readiness ===')
for (const check of checks) {
  const mark = check.ok ? 'OK ' : 'MISS'
  console.log(`${mark}  ${check.name.padEnd(width)}  ${check.note}`)
}

const requiredNow = [
  'public/models/rtmpose-halpe26.onnx',
  'cloud/pose_pipeline.py',
  'cloud/modal_app.py',
  'src/app/api/fight/cloud-pose/route.ts',
  'Modal CLI installed',
]
const missingRequired = checks.filter((c) => requiredNow.includes(c.name) && !c.ok)

console.log('\nNext required external action:')
if (!online) {
  console.log('  Run `node scripts/check-cloud-pose-ready.mjs --online` after Modal login to verify auth.')
}
if (!hasSecret('POSE_API_TOKEN')) {
  console.log('  Set POSE_API_TOKEN before `modal deploy`.')
}
if (!hasSecret('MUSASHI_POSE_CLOUD_GPU_URL')) {
  console.log('  Deploy cloud/modal_app.py and paste the GPU endpoint into .env.local.')
}
if (!hasSecret('MUSASHI_POSE_CLOUD_TOKEN')) {
  console.log('  Set MUSASHI_POSE_CLOUD_TOKEN in .env.local to the same value as POSE_API_TOKEN.')
}

process.exit(missingRequired.length ? 1 : 0)
