#!/usr/bin/env node
/**
 * E2E skeleton QA: dense pass + playback screenshots every 500ms on all 3 clips.
 *
 * Prereqs: pnpm dev (localhost:3000), npx playwright install chromium
 *
 *   node scripts/e2e-screenshot-qa.mjs
 *   node scripts/e2e-screenshot-qa.mjs --poseBackend rtmpose
 *   node scripts/e2e-screenshot-qa.mjs --clip clip1 --interval 500
 */
import { readFileSync, mkdirSync, existsSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

function readOpt(name, fallback) {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const baseUrl = readOpt('--url', process.env.MUSASHI_QA_URL || 'http://localhost:3000')
const onlyClip = readOpt('--clip', null)
const poseBackend = readOpt('--poseBackend', null)
const intervalMs = Number(readOpt('--interval', '500'))
const timeoutMs = Number(readOpt('--timeout', '900000'))
const stamp = new Date().toISOString().slice(0, 10)
const backendLabel = poseBackend || 'mediapipe'

const manifest = JSON.parse(readFileSync(join(root, 'public/test-videos/clips.manifest.json'), 'utf8'))
const baselines = JSON.parse(readFileSync(join(root, 'tracking-eval-2026-06-11/baselines.json'), 'utf8'))

let playwright
try {
  playwright = await import('playwright')
} catch {
  console.error('Install Playwright: pnpm add -D playwright && npx playwright install chromium')
  process.exit(1)
}

const evalDenseTrackFn = () => {
  const dt = window.__denseTrack
  if (!dt?.length) return null
  const dist = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0)
  const anchor = (lm) => {
    const pts = [lm?.[11], lm?.[12], lm?.[23], lm?.[24]].filter(Boolean)
    if (pts.length < 2) return null
    let x = 0, y = 0, w = 0
    for (const p of pts) {
      const v = Math.max(0.25, p.visibility ?? 1)
      x += p.x * v
      y += p.y * v
      w += v
    }
    return w > 0 ? { x: x / w, y: y / w } : null
  }
  let collapseN = 0, collapseD = 0, exploded = 0, teleports = 0
  let aP = 0, bP = 0, both = 0
  const prev = { A: null, B: null }
  for (const s of dt) {
    if (s.A) aP++
    if (s.B) bP++
    if (s.A && s.B) both++
    for (const k of ['A', 'B']) {
      const lm = s[k]
      if (!lm?.length) { prev[k] = null; continue }
      collapseD++
      const sw = dist(lm[11], lm[12]), hw = dist(lm[23], lm[24])
      const sc = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 }
      const hc = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 }
      const th = Math.hypot(sc.x - hc.x, sc.y - hc.y) || 0.001
      if (Math.min(sw, hw) / th < 0.15) collapseN++
      const ls = lm[11], rs = lm[12], lh = lm[23], rh = lm[24]
      const scale = Math.max(0.08, dist(ls, rs), dist(lh, rh), (dist(ls, lh) + dist(rs, rh)) / 2)
      const idxs = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
      let span = 0
      for (let a = 0; a < idxs.length; a++)
        for (let b = a + 1; b < idxs.length; b++)
          span = Math.max(span, dist(lm[idxs[a]], lm[idxs[b]]))
      if (span / scale > 4.5) exploded++
      const an = anchor(lm)
      if (an && prev[k] && Math.hypot(an.x - prev[k].x, an.y - prev[k].y) > 0.14) teleports++
      prev[k] = an
    }
  }
  const n = dt.length || 1
  return {
    frames: dt.length,
    collapsePct: collapseD ? Math.round((100 * collapseN) / collapseD) : 0,
    exploded,
    teleports,
    presenceA: Math.round((100 * aP) / n),
    presenceB: Math.round((100 * bP) / n),
    bothPresencePct: Math.round((100 * both) / n),
    rtmReady: window.__musashiRtm?.ready ?? false,
    rtmRequested: window.__musashiRtm?.requested ?? false,
  }
}

function compare(id, m, gate) {
  const fails = []
  if (m.exploded > gate.maxExploded) fails.push(`exploded ${m.exploded}`)
  if (m.collapsePct > gate.maxCollapsePct) fails.push(`collapse ${m.collapsePct}%`)
  if (m.bothPresencePct < gate.minBothPresencePct) fails.push(`both ${m.bothPresencePct}%`)
  if (m.teleports > gate.maxTeleportFrames) fails.push(`teleports ${m.teleports}`)
  return fails
}

async function waitForDenseTrack(page) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const metrics = await page.evaluate(evalDenseTrackFn)
    if (metrics?.frames > 10) return metrics
    await page.waitForTimeout(2000)
  }
  return null
}

async function startPlayback(page) {
  const playBtn = page.getByRole('button', { name: 'Play video' })
  await playBtn.waitFor({ state: 'visible', timeout: 120_000 })
  await playBtn.click()
  await page.waitForFunction(() => {
    const v = document.querySelector('video')
    return v && !v.paused && v.currentTime > 0.02
  }, { timeout: 60_000 })
}

async function capturePlaybackScreenshots(page, outDir) {
  mkdirSync(outDir, { recursive: true })
  const shots = []

  await startPlayback(page)

  let lastT = -1
  let idlePausedMs = 0
  while (true) {
    const state = await page.evaluate(() => {
      const v = document.querySelector('video')
      return {
        currentTime: v?.currentTime ?? 0,
        duration: v?.duration ?? 0,
        ended: v?.ended ?? false,
        paused: v?.paused ?? true,
      }
    })

    if (state.ended || (state.duration > 0 && state.currentTime >= state.duration - 0.08)) break

    const tMs = Math.round(state.currentTime * 1000)
    if (tMs !== lastT) {
      const file = join(outDir, `t-${String(tMs).padStart(6, '0')}.png`)
      const canvas = page.locator('canvas').first()
      if (await canvas.count()) {
        await canvas.screenshot({ path: file })
      } else {
        await page.screenshot({ path: file })
      }
      shots.push({ tMs, file })
      lastT = tMs
      idlePausedMs = 0
    }

    if (state.paused) {
      idlePausedMs += intervalMs
      if (idlePausedMs >= 3000) break
    } else {
      idlePausedMs = 0
    }

    await page.waitForTimeout(intervalMs)
  }

  return shots
}

const clips = onlyClip ? manifest.clips.filter((c) => c.id === onlyClip) : manifest.clips
if (!clips.length) {
  console.error('No clips to run')
  process.exit(2)
}

const browser = await playwright.chromium.launch({ headless: true })
const results = []
let failed = 0

try {
  for (const clip of clips) {
    console.log(`\n=== ${backendLabel.toUpperCase()} · ${clip.id}: ${clip.label} ===`)
    const page = await browser.newPage({ viewport: { width: 430, height: 900 } })
    try {
      const params = new URLSearchParams({ fixtureVideo: clip.url })
      if (poseBackend) params.set('poseBackend', poseBackend)

      const url = `${baseUrl}/?${params}`
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 })
      await page.locator('#fight-lab-anchor').scrollIntoViewIfNeeded().catch(() => {})

      const metrics = await waitForDenseTrack(page)
      if (!metrics?.frames) {
        console.error(`  TIMEOUT — no dense track`)
        failed++
        continue
      }

      const outDir = join(root, '.codex-artifacts', 'rtmpose-qa', stamp, clip.id, backendLabel)
      let shots = []
      try {
        shots = await capturePlaybackScreenshots(page, outDir)
      } catch (err) {
        console.error(`  screenshot pass failed: ${err.message}`)
        failed++
      }

      console.log(`  dense: frames=${metrics.frames} collapse=${metrics.collapsePct}% teleports=${metrics.teleports}`)
      console.log(`  screenshots: ${shots.length} → ${outDir}`)
      if (poseBackend) console.log(`  RTM ready=${metrics.rtmReady} requested=${metrics.rtmRequested}`)

      const gate = baselines.clips[clip.id]
      const fails = compare(clip.id, metrics, gate)
      const pass = fails.length === 0
      if (!pass) {
        console.log('  FAIL:', fails.join('; '))
        failed++
      } else {
        console.log('  PASS')
      }

      results.push({ clip: clip.id, backend: backendLabel, metrics, pass, fails, shots: shots.length, outDir })
      writeFileSync(join(outDir, 'metrics.json'), JSON.stringify({ clip, backend: backendLabel, metrics, pass, fails, shots: shots.length }, null, 2))
    } catch (err) {
      console.error(`  ERROR: ${err.message}`)
      failed++
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}

const summaryPath = join(root, '.codex-artifacts', 'rtmpose-qa', stamp, `summary-${backendLabel}.json`)
mkdirSync(dirname(summaryPath), { recursive: true })
writeFileSync(summaryPath, JSON.stringify({ date: stamp, backend: backendLabel, results }, null, 2))
console.log(`\nSummary → ${summaryPath}`)
process.exit(failed ? 1 : 0)
