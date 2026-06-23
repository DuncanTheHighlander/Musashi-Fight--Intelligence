#!/usr/bin/env node
/**
 * Browser E2E: load each test clip, wait for dense track, score metrics.
 *
 * Prereqs:
 *   pnpm dev   (or set MUSASHI_QA_URL to deployed app)
 *   npx playwright install chromium
 *
 * Usage:
 *   node scripts/e2e-clip-loop.mjs
 *   node scripts/e2e-clip-loop.mjs --url http://localhost:3000 --clip clip1
 *   node scripts/e2e-clip-loop.mjs --poseBackend rtmpose
 */
import { readFileSync } from 'fs'
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
const timeoutMs = Number(readOpt('--timeout', '900000')) // 15 min per clip

const manifest = JSON.parse(readFileSync(join(root, 'public/test-videos/clips.manifest.json'), 'utf8'))
const baselines = JSON.parse(readFileSync(join(root, 'tracking-eval-2026-06-11/baselines.json'), 'utf8'))

let playwright
try {
  playwright = await import('playwright')
} catch {
  console.error('Install Playwright: pnpm add -D playwright && npx playwright install chromium')
  process.exit(1)
}

/** Same metrics as trackEval.mjs — runs inside the browser on __denseTrack. */
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

const clips = onlyClip ? manifest.clips.filter((c) => c.id === onlyClip) : manifest.clips
if (!clips.length) {
  console.error('No clips to run')
  process.exit(2)
}

const browser = await playwright.chromium.launch({ headless: true })
let failed = 0

try {
  for (const clip of clips) {
    console.log(`\n=== E2E ${clip.id}: ${clip.label} ===`)
    const page = await browser.newPage()
    const params = new URLSearchParams({
      fixtureVideo: clip.url,
      fixtureAutoplay: '0',
      qaLoop: '1',
    })
    if (poseBackend) params.set('poseBackend', poseBackend)
    const url = `${baseUrl}/?${params}`

    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 })

    // Wait for dense track (FightAnalyzer sets window.__denseTrack in dev after pass)
    const started = Date.now()
    let metrics = null
    while (Date.now() - started < timeoutMs) {
      metrics = await page.evaluate(evalDenseTrackFn)
      if (metrics?.frames > 10) break
      await page.waitForTimeout(2000)
    }

    if (!metrics?.frames) {
      console.error(`  TIMEOUT — no __denseTrack after ${timeoutMs / 1000}s`)
      console.error('  Ensure dev server is running and NODE_ENV !== production')
      failed++
      await page.close()
      continue
    }

    console.log(`  frames=${metrics.frames} collapse=${metrics.collapsePct}% exploded=${metrics.exploded} teleports=${metrics.teleports}`)
    console.log(`  presence A=${metrics.presenceA}% B=${metrics.presenceB}% both=${metrics.bothPresencePct}%`)
    if (poseBackend) console.log(`  RTM ready=${metrics.rtmReady} requested=${metrics.rtmRequested}`)

    const gate = baselines.clips[clip.id]
    const fails = compare(clip.id, metrics, gate)
    if (fails.length) {
      console.log('  FAIL:', fails.join('; '))
      failed++
    } else {
      console.log('  PASS')
    }
    await page.close()
  }
} finally {
  await browser.close()
}

process.exit(failed ? 1 : 0)
