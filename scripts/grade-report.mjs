#!/usr/bin/env node
/**
 * Full grade report: MediaPipe + optional RTMPose on all 3 clips via live browser.
 * Usage: node scripts/grade-report.mjs [--rtm] [--url http://localhost:3000]
 */
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const useRtm = process.argv.includes('--rtm')
const baseUrl = process.argv.includes('--url')
  ? process.argv[process.argv.indexOf('--url') + 1]
  : 'http://localhost:3000'

const manifest = JSON.parse(readFileSync(join(root, 'public/test-videos/clips.manifest.json'), 'utf8'))

const evalFn = () => {
  const dt = window.__denseTrack
  if (!dt?.length) return null
  const D = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0)
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
      const sw = D(lm[11], lm[12]), hw = D(lm[23], lm[24])
      const sc = { x: (lm[11].x + lm[12].x) / 2, y: (lm[11].y + lm[12].y) / 2 }
      const hc = { x: (lm[23].x + lm[24].x) / 2, y: (lm[23].y + lm[24].y) / 2 }
      const th = Math.hypot(sc.x - hc.x, sc.y - hc.y) || 0.001
      if (Math.min(sw, hw) / th < 0.15) collapseN++
      const scale = Math.max(0.08, D(lm[11], lm[12]), D(lm[23], lm[24]), (D(lm[11], lm[23]) + D(lm[12], lm[24])) / 2)
      const idxs = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
      let span = 0
      for (let a = 0; a < idxs.length; a++)
        for (let b = a + 1; b < idxs.length; b++) span = Math.max(span, D(lm[idxs[a]], lm[idxs[b]]))
      if (span / scale > 4.5) exploded++
      const pts = [lm[11], lm[12], lm[23], lm[24]].filter(Boolean)
      let ax = 0, ay = 0, w = 0
      for (const p of pts) {
        const v = Math.max(0.25, p.visibility ?? 1)
        ax += p.x * v; ay += p.y * v; w += v
      }
      const an = w > 0 ? { x: ax / w, y: ay / w } : null
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
    bothPresencePct: Math.round((100 * both) / n),
    presenceA: Math.round((100 * aP) / n),
    presenceB: Math.round((100 * bP) / n),
    rtm: window.__musashiRtm ?? null,
  }
}

function letterGrade(m, clipId) {
  let score = 100
  if (m.bothPresencePct < 70) score -= 25
  else if (m.bothPresencePct < 85) score -= 10
  if (m.collapsePct > 55) score -= 25
  else if (m.collapsePct > 35) score -= 15
  else if (m.collapsePct > 20) score -= 5
  if (m.exploded > 20) score -= 20
  else if (m.exploded > 5) score -= 10
  else if (m.exploded > 2) score -= 5
  if (m.teleports > 80) score -= 15
  else if (m.teleports > 40) score -= 10
  else if (m.teleports > 15) score -= 5
  if (clipId === 'clip3' && m.collapsePct > 40) score -= 5 // extra strict on hard clip
  score = Math.max(0, Math.min(100, score))
  const g = score >= 93 ? 'A' : score >= 87 ? 'A-' : score >= 83 ? 'B+' : score >= 77 ? 'B' : score >= 73 ? 'B-' : score >= 67 ? 'C+' : score >= 60 ? 'C' : 'D'
  return { score, grade: g }
}

let playwright
try {
  playwright = await import('playwright')
} catch {
  console.error('Install: pnpm add -D playwright && npx playwright install chromium')
  process.exit(1)
}

async function testClip(page, clip, backend) {
  const params = new URLSearchParams({ fixtureVideo: clip.url })
  if (backend === 'rtm') params.set('poseBackend', 'rtmpose')
  const url = `${baseUrl}/?${params}#fight-lab-anchor`
  console.log(`\n--- ${clip.id} [${backend}] ---`)
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 })

  // Force fresh dense pass when RTM (cache is MediaPipe-only)
  if (backend === 'rtm') {
    await page.waitForTimeout(3000)
    const rerun = page.getByRole('button', { name: 'Re-run CV' })
    if (await rerun.isEnabled().catch(() => false)) {
      console.log('  Re-run CV (RTM fresh pass)...')
      await rerun.click()
    }
  }

  const deadline = Date.now() + 900_000
  let metrics = null
  while (Date.now() < deadline) {
    const playBtn = page.getByRole('button', { name: 'Play video' })
    if (await playBtn.isVisible().catch(() => false)) {
      await playBtn.click().catch(() => {})
      await page.waitForTimeout(2000)
    }
    metrics = await page.evaluate(evalFn)
    if (metrics?.frames > 50) break
    const prog = await page.evaluate(() => document.body?.innerText?.match(/Deep tracking \d+\/\d+/)?.[0] ?? '')
    process.stdout.write(`  ${prog || 'waiting...'}\r`)
    await page.waitForTimeout(8000)
  }

  if (!metrics?.frames) {
    console.log('  FAIL: timeout — no dense track')
    return { clip: clip.id, backend, error: 'timeout' }
  }

  const { score, grade } = letterGrade(metrics, clip.id)
  console.log(`  frames=${metrics.frames} both=${metrics.bothPresencePct}% collapse=${metrics.collapsePct}% exploded=${metrics.exploded} teleports=${metrics.teleports}`)
  if (backend === 'rtm') console.log(`  RTM ready=${metrics.rtm?.ready} requested=${metrics.rtm?.requested}`)
  console.log(`  GRADE: ${grade} (${score}/100)`)
  return { clip: clip.id, backend, ...metrics, score, grade }
}

const browser = await playwright.chromium.launch({ headless: true })
const page = await browser.newPage()
const results = []

for (const clip of manifest.clips) {
  results.push(await testClip(page, clip, 'mediapipe'))
  if (useRtm) results.push(await testClip(page, clip, 'rtm'))
}

await browser.close()

console.log('\n========== FINAL REPORT CARD ==========')
for (const clip of manifest.clips) {
  const mp = results.find((r) => r.clip === clip.id && r.backend === 'mediapipe')
  const rtm = results.find((r) => r.clip === clip.id && r.backend === 'rtm')
  console.log(`\n${clip.label}`)
  console.log(`  MediaPipe: ${mp?.grade ?? 'FAIL'} ${mp?.error ?? `(${mp?.score}/100)`}`)
  if (useRtm) console.log(`  RTMPose:   ${rtm?.grade ?? 'FAIL'} ${rtm?.error ?? `(${rtm?.score}/100)`}`)
}

const mpScores = results.filter((r) => r.backend === 'mediapipe' && r.score).map((r) => r.score)
const avg = mpScores.length ? Math.round(mpScores.reduce((a, b) => a + b, 0) / mpScores.length) : 0
const overall = letterGrade({ bothPresencePct: avg, collapsePct: 30, exploded: 5, teleports: 20 }, 'clip1')
overall.score = avg
overall.grade = avg >= 93 ? 'A' : avg >= 87 ? 'A-' : avg >= 83 ? 'B+' : avg >= 77 ? 'B' : avg >= 73 ? 'B-' : avg >= 67 ? 'C+' : 'C'
console.log(`\n>>> OVERALL (MediaPipe avg): ${overall.grade} (${avg}/100)`)
console.log('=======================================\n')
