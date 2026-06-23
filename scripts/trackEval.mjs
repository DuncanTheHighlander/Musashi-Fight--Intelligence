/**
 * Tracking quality metrics for dense-track or offline-replay JSON.
 *
 * Accepts either format:
 *   - Dense: { tMs, A, B }[]  (window.__denseTrack)
 *   - Replay: { f, tMs, rawA, rawB, A, B }[]  (identityReplay output)
 *
 * Usage:
 *   node scripts/trackEval.mjs path/to/track.json
 *   node scripts/trackEval.mjs --compare baselines.json clip1=path.json clip2=path.json
 */
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')

function pt(lm, i) {
  const p = lm?.[i]
  if (!p) return null
  if (Array.isArray(p)) return { x: p[0], y: p[1], visibility: p[2] ?? 1 }
  return p
}

const distPt = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0)

function anchor(lm) {
  if (!lm || lm.length < 25) return null
  const pts = [pt(lm, 11), pt(lm, 12), pt(lm, 23), pt(lm, 24)].filter(Boolean)
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

function torsoScale(lm) {
  if (!lm || lm.length < 25) return 0
  const ls = pt(lm, 11), rs = pt(lm, 12), lh = pt(lm, 23), rh = pt(lm, 24)
  if (!ls || !rs || !lh || !rh) return 0
  const shoulderW = distPt(ls, rs)
  const hipW = distPt(lh, rh)
  const torsoH = (distPt(ls, lh) + distPt(rs, rh)) / 2
  return Math.max(0.08, shoulderW, hipW, torsoH)
}

function spanRatio(lm) {
  const sc = torsoScale(lm)
  if (!(sc > 0)) return 0
  const idxs = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
  let span = 0
  for (let a = 0; a < idxs.length; a++) {
    for (let b = a + 1; b < idxs.length; b++) {
      const pi = pt(lm, idxs[a]), pj = pt(lm, idxs[b])
      if (!pi || !pj) continue
      span = Math.max(span, distPt(pi, pj))
    }
  }
  return span / sc
}

function collapseFrame(lm) {
  if (!lm || lm.length < 25) return false
  const lsh = pt(lm, 11), rsh = pt(lm, 12), lhip = pt(lm, 23), rhip = pt(lm, 24)
  if (!lsh || !rsh || !lhip || !rhip) return false
  const sw = distPt(lsh, rsh)
  const hw = distPt(lhip, rhip)
  const sc = { x: (lsh.x + rsh.x) / 2, y: (lsh.y + rsh.y) / 2 }
  const hc = { x: (lhip.x + rhip.x) / 2, y: (lhip.y + rhip.y) / 2 }
  const th = Math.hypot(sc.x - hc.x, sc.y - hc.y) || 0.001
  return Math.min(sw, hw) / th < 0.15
}

function pct(arr, q) {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * q))]
}

/** Score one clip track / replay array. */
export function evalTrack(frames, opts = {}) {
  const useRaw = opts.scoreRaw !== false
  let collapseN = 0, collapseD = 0
  let exploded = 0
  let aPresent = 0, bPresent = 0, bothPresent = 0
  let teleports = 0
  const armRatios = []
  const legRatios = []
  const ARMS = [[11, 13], [12, 14], [13, 15], [14, 16]]
  const LEGS = [[23, 25], [24, 26], [25, 27], [26, 28]]
  const prevAnchor = { A: null, B: null }
  const TELEPORT_THRESH = opts.teleportThresh ?? 0.14

  for (const fr of frames) {
    const hasA = Boolean(fr.A?.length)
    const hasB = Boolean(fr.B?.length)
    if (hasA) aPresent++
    if (hasB) bPresent++
    if (hasA && hasB) bothPresent++

    for (const slot of ['A', 'B']) {
      const raw = slot === 'A' ? fr.rawA : fr.rawB
      const pose = fr[slot]
      // Replay JSON uses rawA/rawB booleans; dense track has no raw flags.
      const isReal = useRaw
        ? (raw === true || (Array.isArray(raw) && raw.length > 0)) && Boolean(pose)
        : Boolean(pose)
      if (!isReal || !pose?.length) {
        prevAnchor[slot] = null
        continue
      }

      if (collapseFrame(pose)) {
        collapseN++
        collapseD++
      } else {
        collapseD++
      }

      const span = spanRatio(pose)
      if (span > 4.5) exploded++

      const sc = torsoScale(pose)
      if (sc > 0) {
        armRatios.push(Math.max(...ARMS.map(([i, j]) => distPt(pt(pose, i), pt(pose, j)) / sc)))
        legRatios.push(Math.max(...LEGS.map(([i, j]) => distPt(pt(pose, i), pt(pose, j)) / sc)))
      }

      const a = anchor(pose)
      const pa = prevAnchor[slot]
      if (a && pa && Math.hypot(a.x - pa.x, a.y - pa.y) > TELEPORT_THRESH) teleports++
      prevAnchor[slot] = a
    }
  }

  const n = frames.length || 1
  return {
    frames: frames.length,
    collapsePct: collapseD ? Math.round((100 * collapseN) / collapseD) : 0,
    exploded,
    presenceA: Math.round((100 * aPresent) / n),
    presenceB: Math.round((100 * bPresent) / n),
    bothPresencePct: Math.round((100 * bothPresent) / n),
    teleports,
    armBoneP95: pct(armRatios, 0.95),
    legBoneP95: pct(legRatios, 0.95),
  }
}

function loadJson(p) {
  return JSON.parse(readFileSync(p, 'utf8'))
}

function compareClip(id, metrics, gate) {
  const fails = []
  if (metrics.exploded > gate.maxExploded) fails.push(`exploded ${metrics.exploded} > ${gate.maxExploded}`)
  if (metrics.collapsePct > gate.maxCollapsePct) fails.push(`collapse ${metrics.collapsePct}% > ${gate.maxCollapsePct}%`)
  if (metrics.bothPresencePct < gate.minBothPresencePct) {
    fails.push(`both-presence ${metrics.bothPresencePct}% < ${gate.minBothPresencePct}%`)
  }
  if (metrics.teleports > gate.maxTeleportFrames) fails.push(`teleports ${metrics.teleports} > ${gate.maxTeleportFrames}`)
  if (metrics.armBoneP95 > gate.maxArmBoneP95) fails.push(`arm p95 ${metrics.armBoneP95.toFixed(3)} > ${gate.maxArmBoneP95}`)
  if (metrics.legBoneP95 > gate.maxLegBoneP95) fails.push(`leg p95 ${metrics.legBoneP95.toFixed(3)} > ${gate.maxLegBoneP95}`)
  return fails
}

function printMetrics(label, m) {
  console.log(`\n## ${label}`)
  console.log(`  frames=${m.frames}  collapse=${m.collapsePct}%  exploded=${m.exploded}  teleports=${m.teleports}`)
  console.log(`  presence A=${m.presenceA}% B=${m.presenceB}% both=${m.bothPresencePct}%`)
  console.log(`  arm p95=${m.armBoneP95.toFixed(3)}  leg p95=${m.legBoneP95.toFixed(3)}`)
}

function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--compare') {
    const baselinePath = args[1]
    const pairs = args.slice(2)
    const baselines = loadJson(baselinePath)
    let failed = 0
    console.log('=== TRACK EVAL vs BASELINES ===')
    for (const pair of pairs) {
      const [id, file] = pair.split('=')
      const gate = baselines.clips[id]
      if (!gate) {
        console.error(`Unknown clip id: ${id}`)
        failed++
        continue
      }
      const trackPath = file.startsWith('/') || file.includes(':') ? file : join(root, file)
      const metrics = evalTrack(loadJson(trackPath))
      printMetrics(`${id} (${trackPath.split(/[/\\]/).pop()})`, metrics)
      const fails = compareClip(id, metrics, gate)
      if (fails.length) {
        console.log('  FAIL:', fails.join('; '))
        failed++
      } else {
        console.log('  PASS (equal-or-better vs baseline)')
      }
    }
    process.exit(failed ? 1 : 0)
  }

  if (!args[0]) {
    console.error('usage: node scripts/trackEval.mjs <track.json>')
    console.error('       node scripts/trackEval.mjs --compare baselines.json clip1=path.json ...')
    process.exit(2)
  }

  const metrics = evalTrack(loadJson(args[0]))
  printMetrics(args[0], metrics)
}

main()
