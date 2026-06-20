/**
 * Joint-tightness evaluator for the offline replay outputs.
 *
 * Reads one or more replay JSONs (produced by identityReplay.offline.test.ts)
 * and reports per-joint-group tightness so we can prove a kinematics change
 * makes the skeleton TIGHTER without going backwards:
 *
 *   - bone-length ratio  (bone / torso-scale): a healthy forearm/shank is
 *     ~0.8-1.2; a cross-fighter "spider-web" splay reads 2x+. We report p50,
 *     p95 and the count of frames over 1.8 (the splay floor) per limb group.
 *   - overall span ratio (max joint-pair distance / torso-scale): the
 *     CHECKPOINT "explosion" metric. Healthy full body ~2.3; a web reads 5-8+.
 *   - body-relative jitter (per-joint frame-to-frame move minus the torso's
 *     move, / scale): pure tightness. Lower = steadier joint.
 *
 * Only REAL detection frames (rawA / rawB) are scored — held/coasted poses are
 * the identity layer's job, not the joint layer's.
 *
 * Usage: node scripts/jointEval.mjs clip1.json clip2.json clip3.json
 */
import { readFileSync } from 'fs'

const ARMS = [[11, 13], [12, 14], [13, 15], [14, 16]] // sh→elbow, elbow→wrist
const LEGS = [[23, 25], [24, 26], [25, 27], [26, 28]] // hip→knee, knee→ankle
const ARM_JOINTS = [13, 14, 15, 16]
const LEG_JOINTS = [25, 26, 27, 28, 31, 32]
const HEAD_JOINTS = [0]
const HIP_JOINTS = [23, 24]

const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])

function scaleOf(p) {
  const ls = p[11], rs = p[12], lh = p[23], rh = p[24]
  if (!ls || !rs || !lh || !rh) return 0
  const shoulderW = hyp(ls, rs)
  const hipW = hyp(lh, rh)
  const torsoH = (hyp(ls, lh) + hyp(rs, rh)) / 2
  return Math.max(0.08, shoulderW, hipW, torsoH)
}
const torsoCenter = (p) => [
  (p[11][0] + p[12][0] + p[23][0] + p[24][0]) / 4,
  (p[11][1] + p[12][1] + p[23][1] + p[24][1]) / 4,
]
const pct = (arr, q) => {
  if (!arr.length) return 0
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.min(s.length - 1, Math.floor(s.length * q))]
}
const f3 = (n) => n.toFixed(3)

function evalClip(label, file) {
  const frames = JSON.parse(readFileSync(file, 'utf8'))
  const stat = {
    armRatio: [], legRatio: [], span: [], explode: 0, realFrames: 0,
    jit: { arm: [], leg: [], head: [], hip: [] },
  }
  const prev = { A: null, B: null }
  for (const fr of frames) {
    for (const slot of ['A', 'B']) {
      const real = slot === 'A' ? fr.rawA : fr.rawB
      const p = fr[slot]
      if (!real || !p || p.length < 33) { prev[slot] = null; continue }
      const sc = scaleOf(p)
      if (!(sc > 0)) { prev[slot] = null; continue }
      stat.realFrames++

      // bone ratios
      const arm = Math.max(...ARMS.map(([i, j]) => hyp(p[i], p[j]) / sc))
      const leg = Math.max(...LEGS.map(([i, j]) => hyp(p[i], p[j]) / sc))
      stat.armRatio.push(arm)
      stat.legRatio.push(leg)

      // overall span (max pairwise distance among the named joints) / scale
      const idxs = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
      let span = 0
      for (let a = 0; a < idxs.length; a++)
        for (let b = a + 1; b < idxs.length; b++)
          span = Math.max(span, hyp(p[idxs[a]], p[idxs[b]]))
      span /= sc
      stat.span.push(span)
      if (span > 4.5) stat.explode++

      // body-relative jitter vs previous real frame of same slot
      const pp = prev[slot]
      if (pp) {
        const tc = torsoCenter(p), tp = torsoCenter(pp)
        const bdx = tc[0] - tp[0], bdy = tc[1] - tp[1]
        const jitOf = (group) => {
          const vals = group.map((i) => {
            const dx = (p[i][0] - pp[i][0]) - bdx
            const dy = (p[i][1] - pp[i][1]) - bdy
            return Math.hypot(dx, dy) / sc
          })
          return Math.max(...vals)
        }
        stat.jit.arm.push(jitOf(ARM_JOINTS))
        stat.jit.leg.push(jitOf(LEG_JOINTS))
        stat.jit.head.push(jitOf(HEAD_JOINTS))
        stat.jit.hip.push(jitOf(HIP_JOINTS))
      }
      prev[slot] = p
    }
  }
  return { label, stat }
}

function printRow(r) {
  const s = r.stat
  console.log(`\n## ${r.label}  (real frames scored: ${s.realFrames})`)
  console.log(
    `  arm bone   p50 ${f3(pct(s.armRatio, 0.5))}  p95 ${f3(pct(s.armRatio, 0.95))}  >1.8: ${s.armRatio.filter((x) => x > 1.8).length}`
  )
  console.log(
    `  leg bone   p50 ${f3(pct(s.legRatio, 0.5))}  p95 ${f3(pct(s.legRatio, 0.95))}  >1.8: ${s.legRatio.filter((x) => x > 1.8).length}`
  )
  console.log(
    `  span       p50 ${f3(pct(s.span, 0.5))}  p95 ${f3(pct(s.span, 0.95))}  exploded(>4.5): ${s.explode}`
  )
  console.log(
    `  jitter p95 arm ${f3(pct(s.jit.arm, 0.95))}  leg ${f3(pct(s.jit.leg, 0.95))}  head ${f3(pct(s.jit.head, 0.95))}  hip ${f3(pct(s.jit.hip, 0.95))}`
  )
}

const files = process.argv.slice(2)
if (!files.length) {
  console.error('usage: node scripts/jointEval.mjs <replay1.json> [replay2.json ...]')
  process.exit(1)
}
console.log('=== JOINT TIGHTNESS EVAL (lower = tighter; >1.8 bones & exploded should DROP) ===')
files.forEach((f, i) => printRow(evalClip(`clip${i + 1}  (${f.split(/[\\/]/).pop()})`, f)))
