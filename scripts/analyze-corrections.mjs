#!/usr/bin/env node
/**
 * Analyze exported ledger correction JSONL and suggest detector threshold tweaks.
 *
 * Usage:
 *   node scripts/analyze-corrections.mjs [path/to/export.jsonl]
 *   node scripts/analyze-corrections.mjs --json [path]
 *   node scripts/analyze-corrections.mjs --fixture   # smoke test on sample data
 *
 * Export JSONL from the app: GET /api/fight/ledgers/export (Review page → Export dataset)
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const DEFAULT_FIXTURE = join(__dir, 'fixtures/sample-corrections.jsonl')

const VERDICTS = ['confirm', 'reject', 'relabel']
const STRIKE_KINDS = new Set([
  'jab', 'cross', 'lead_hook', 'rear_hook', 'lead_uppercut', 'rear_uppercut',
  'teep', 'lead_kick', 'rear_kick', 'strike_placeholder',
])
const FAULT_KINDS = new Set(['guard_low', 'chin_exposed', 'overextension', 'compromised_base'])

/** @typedef {{ ledgerId: string, videoFileName: string|null, itemType: string, item: object|null, originalKind: string, verdict: string, correctedKind: string|null, note: string|null, correctedAt: string }} CorrectionRecord */

function parseArgs(argv) {
  const args = { json: false, fixture: false, file: null }
  for (const a of argv) {
    if (a === '--json') args.json = true
    else if (a === '--fixture') args.fixture = true
    else if (!a.startsWith('-')) args.file = resolve(a)
  }
  if (args.fixture) args.file = DEFAULT_FIXTURE
  if (!args.file) {
    const dated = new Date().toISOString().slice(0, 10)
    const guess = join(process.cwd(), `musashi-corrections-${dated}.jsonl`)
    args.file = existsSync(guess) ? guess : DEFAULT_FIXTURE
    if (!existsSync(args.file)) {
      console.error('Usage: node scripts/analyze-corrections.mjs [--json] [--fixture] [export.jsonl]')
      console.error('  No file given and no dated export found in cwd.')
      process.exit(1)
    }
    if (args.file === DEFAULT_FIXTURE) {
      console.error(`(No export file specified — using fixture: ${DEFAULT_FIXTURE})\n`)
    }
  }
  return args
}

/** @param {string} path */
function loadJsonl(path) {
  if (!existsSync(path)) {
    console.error(`File not found: ${path}`)
    process.exit(1)
  }
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l) => l.trim())
  /** @type {CorrectionRecord[]} */
  const records = []
  for (let i = 0; i < lines.length; i++) {
    try {
      records.push(JSON.parse(lines[i]))
    } catch (e) {
      console.error(`Line ${i + 1}: invalid JSON — ${e.message}`)
      process.exit(1)
    }
  }
  return records
}

function pct(n, d) {
  return d === 0 ? 0 : Math.round((1000 * n) / d) / 10
}

function inc(map, key, sub = 1) {
  map.set(key, (map.get(key) ?? 0) + sub)
}

/** @param {CorrectionRecord[]} records */
function summarize(records) {
  const total = records.length
  const byVerdict = Object.fromEntries(VERDICTS.map((v) => [v, 0]))
  /** @type {Map<string, Map<string, number>>} */
  const byItemTypeVerdict = new Map()
  /** @type {Map<string, Map<string, number>>} */
  const byKindVerdict = new Map()
  /** @type {Map<string, number>} */
  const relabelPairs = new Map()
  /** @type {Map<string, { confirm: number, reject: number, relabel: number, total: number }>} */
  const kindStats = new Map()

  for (const r of records) {
    byVerdict[r.verdict] = (byVerdict[r.verdict] ?? 0) + 1

    if (!byItemTypeVerdict.has(r.itemType)) byItemTypeVerdict.set(r.itemType, new Map())
    inc(byItemTypeVerdict.get(r.itemType), r.verdict)

    const kindKey = `${r.itemType}:${r.originalKind}`
    if (!byKindVerdict.has(kindKey)) byKindVerdict.set(kindKey, new Map())
    inc(byKindVerdict.get(kindKey), r.verdict)

    if (!kindStats.has(r.originalKind)) {
      kindStats.set(r.originalKind, { confirm: 0, reject: 0, relabel: 0, total: 0 })
    }
    const ks = kindStats.get(r.originalKind)
    ks.total++
    ks[r.verdict]++

    if (r.verdict === 'relabel' && r.correctedKind) {
      const pair = `${r.originalKind} → ${r.correctedKind}`
      inc(relabelPairs, pair)
    }
  }

  const topRelabelPairs = [...relabelPairs.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)

  const kindAccuracy = [...kindStats.entries()]
    .map(([kind, s]) => ({
      kind,
      total: s.total,
      confirmRate: pct(s.confirm, s.total),
      rejectRate: pct(s.reject, s.total),
      relabelRate: pct(s.relabel, s.total),
    }))
    .sort((a, b) => b.total - a.total)

  const ledgerIds = new Set(records.map((r) => r.ledgerId))
  const videos = new Set(records.map((r) => r.videoFileName).filter(Boolean))

  return {
    total,
    ledgerCount: ledgerIds.size,
    videoCount: videos.size,
    byVerdict,
    byItemTypeVerdict: Object.fromEntries(
      [...byItemTypeVerdict.entries()].map(([t, m]) => [t, Object.fromEntries(m)])
    ),
    topRelabelPairs,
    kindAccuracy,
  }
}

/**
 * Map correction patterns to concrete file/key suggestions.
 * @param {CorrectionRecord[]} records
 * @param {ReturnType<typeof summarize>} summary
 */
function suggestAdjustments(records, summary) {
  /** @type {Array<{ priority: 'high'|'medium'|'low', area: string, suggestion: string, evidence: string }>} */
  const suggestions = []

  const kindStats = new Map()
  for (const k of summary.kindAccuracy) {
    kindStats.set(k.kind, k)
  }

  // Aggregate relabel pair counts by original kind
  /** @type {Map<string, Map<string, number>>} */
  const relabelFrom = new Map()
  for (const r of records) {
    if (r.verdict !== 'relabel' || !r.correctedKind) continue
    if (!relabelFrom.has(r.originalKind)) relabelFrom.set(r.originalKind, new Map())
    inc(relabelFrom.get(r.originalKind), r.correctedKind)
  }

  // --- Strike burst threshold (compiler hardcoded 1.2) ---
  const strikeRejects = records.filter(
    (r) => r.itemType === 'event' && r.verdict === 'reject' && STRIKE_KINDS.has(r.originalKind)
  )
  const strikeTotal = records.filter((r) => r.itemType === 'event' && STRIKE_KINDS.has(r.originalKind)).length
  const strikeRejectRate = pct(strikeRejects.length, strikeTotal)
  if (strikeTotal >= 3 && strikeRejectRate >= 25) {
    suggestions.push({
      priority: strikeRejectRate >= 40 ? 'high' : 'medium',
      area: 'Strike detection',
      suggestion:
        'Raise burst threshold in `src/lib/compiler/fightlang.compiler.ts` — `thresholdBwps` (currently 1.2). Try 1.35–1.5 to cut false-positive strikes.',
      evidence: `${strikeRejects.length}/${strikeTotal} strike events rejected (${strikeRejectRate}%)`,
    })
  }

  // --- Jab/cross confusion (stance / lead-hand) ---
  const jabCrossPairs = [
    ['jab', 'cross'], ['cross', 'jab'],
  ]
  for (const [from, to] of jabCrossPairs) {
    const count = relabelFrom.get(from)?.get(to) ?? 0
    if (count >= 1) {
      suggestions.push({
        priority: count >= 2 ? 'high' : 'medium',
        area: 'Jab vs cross',
        suggestion:
          'Review stance detection in `src/lib/compiler/detectors/stance.ts` and lead/rear resolution in `strikes.ts` `classifyHandStrike`. Consider tightening `DEFAULT_FIGHTLANG_THRESHOLDS.stance.minFootSpreadBw` / `maxFootSpreadBw` so orthodox/southpaw is stable before classifying straights.',
        evidence: `${count} relabel(s): ${from} → ${to}`,
      })
    }
  }

  // --- Hook vs straight ---
  const hookToStraight = ['jab', 'cross'].reduce((n, t) => {
    return n + (relabelFrom.get('lead_hook')?.get(t) ?? 0) + (relabelFrom.get('rear_hook')?.get(t) ?? 0)
  }, 0)
  const straightToHook = ['jab', 'cross'].reduce((n, t) => {
    return n + (relabelFrom.get(t)?.get('lead_hook') ?? 0) + (relabelFrom.get(t)?.get('rear_hook') ?? 0)
  }, 0)
  if (hookToStraight >= 1) {
    suggestions.push({
      priority: hookToStraight >= 2 ? 'high' : 'medium',
      area: 'Hook classifier',
      suggestion:
        'In `strikes.ts` `classifyHandStrike`, raise `lateralDev > 0.6` to ~0.7 so hooks need more lateral arc; or lower `elbowAngleProxy < 0.85` gate.',
      evidence: `${hookToStraight} hook(s) relabeled to jab/cross`,
    })
  }
  if (straightToHook >= 1) {
    suggestions.push({
      priority: 'medium',
      area: 'Hook classifier',
      suggestion:
        'In `strikes.ts`, lower `lateralDev` hook threshold (0.6 → 0.5) or relax `verticalRatio < 0.5` so arcing straights classify as hooks.',
      evidence: `${straightToHook} jab/cross relabeled to hook`,
    })
  }

  // --- Uppercut confusion ---
  const uppercutKinds = ['lead_uppercut', 'rear_uppercut']
  let upperToStraight = 0
  let straightToUpper = 0
  for (const uk of uppercutKinds) {
    upperToStraight += (relabelFrom.get(uk)?.get('jab') ?? 0) + (relabelFrom.get(uk)?.get('cross') ?? 0)
    for (const s of ['jab', 'cross', 'lead_hook', 'rear_hook']) {
      straightToUpper += relabelFrom.get(s)?.get(uk) ?? 0
    }
  }
  if (upperToStraight >= 1) {
    suggestions.push({
      priority: 'medium',
      area: 'Uppercut classifier',
      suggestion:
        'In `strikes.ts`, tighten uppercut branch: require `verticalRatio > 0.65` (was 0.6) and `elbowAngleProxy < 0.72` (was 0.78).',
      evidence: `${upperToStraight} uppercut(s) relabeled to straight`,
    })
  }
  if (straightToUpper >= 1) {
    suggestions.push({
      priority: 'medium',
      area: 'Uppercut classifier',
      suggestion:
        'In `strikes.ts`, relax uppercut detection: lower `verticalRatio` to 0.55 or allow slight upward `dy` with `elbowAngleProxy < 0.82`.',
      evidence: `${straightToUpper} strike(s) relabeled to uppercut`,
    })
  }

  // --- Teep vs kick ---
  const teepKick = (relabelFrom.get('teep')?.get('lead_kick') ?? 0) + (relabelFrom.get('teep')?.get('rear_kick') ?? 0)
  const kickTeep = (relabelFrom.get('lead_kick')?.get('teep') ?? 0) + (relabelFrom.get('rear_kick')?.get('teep') ?? 0)
  if (teepKick >= 1) {
    suggestions.push({
      priority: 'medium',
      area: 'Leg strikes',
      suggestion:
        'In `strikes.ts` `classifyLegStrike`, lower teep `lateralRatio < 0.45` to 0.35, or raise kick `dispBw > 0.7` to 0.85.',
      evidence: `${teepKick} teep(s) relabeled to kick`,
    })
  }
  if (kickTeep >= 1) {
    suggestions.push({
      priority: 'medium',
      area: 'Leg strikes',
      suggestion:
        'In `strikes.ts`, relax teep detection (`lateralRatio` 0.45 → 0.55) or lower minimum foot displacement `dispBw < 0.5` gate.',
      evidence: `${kickTeep} kick(s) relabeled to teep`,
    })
  }

  // --- Fault thresholds (fightlang.defaults.ts) ---
  for (const faultKind of FAULT_KINDS) {
    const stat = kindStats.get(faultKind)
    if (!stat || stat.total < 2) continue
    const rejectRate = pct(stat.reject, stat.total)
    if (rejectRate >= 40) {
      const keyMap = {
        guard_low: 'guard.exposureHighScore (currently 0.6) and faults.ts score gate > 0.55',
        chin_exposed: 'faults.chinExposedScore (currently 0.6)',
        overextension: 'faults.overextensionScoreBw (currently 0.45)',
        compromised_base: 'faults.compromisedBaseScoreBw (currently 0.35)',
      }
      suggestions.push({
        priority: rejectRate >= 60 ? 'high' : 'medium',
        area: `Fault: ${faultKind}`,
        suggestion: `Raise detection threshold — \`DEFAULT_FIGHTLANG_THRESHOLDS.${keyMap[faultKind]?.split(' ')[0] ?? faultKind}\` in \`fightlang.defaults.ts\`, and matching gate in \`detectors/faults.ts\`.`,
        evidence: `${stat.reject}/${stat.total} rejected (${rejectRate}%)`,
      })
    }
    const confirmRate = pct(stat.confirm, stat.total)
    if (confirmRate >= 80 && stat.total >= 3) {
      suggestions.push({
        priority: 'low',
        area: `Fault: ${faultKind}`,
        suggestion: `${faultKind} looks well-calibrated (${confirmRate}% confirm). No change needed unless you want higher recall.`,
        evidence: `${stat.confirm}/${stat.total} confirmed`,
      })
    }
  }

  // --- Guard fault false positives specifically ---
  const guardLowRejects = records.filter((r) => r.originalKind === 'guard_low' && r.verdict === 'reject')
  if (guardLowRejects.length >= 1) {
    suggestions.push({
      priority: guardLowRejects.length >= 2 ? 'high' : 'medium',
      area: 'Guard exposure',
      suggestion:
        'Raise `DEFAULT_FIGHTLANG_THRESHOLDS.guard.exposureHighScore` (0.6 → 0.68) and/or `guard.handsHighYMargin` in `fightlang.defaults.ts`; align `detectors/faults.ts` guard_low gate (score > 0.55).',
      evidence: `${guardLowRejects.length} guard_low false positive(s)`,
    })
  }

  // --- Pattern false positives ---
  const patternRejects = records.filter((r) => r.itemType === 'pattern' && r.verdict === 'reject')
  if (patternRejects.length >= 2) {
    suggestions.push({
      priority: 'medium',
      area: 'Movement patterns',
      suggestion:
        'Review `src/lib/compiler/detectors/patterns.ts` — raise `confidenceFromCount` baseline or minimum occurrence windows for patterns with high reject rates.',
      evidence: `${patternRejects.length} pattern detection(s) rejected`,
    })
  }

  // --- Low overall confirm rate ---
  const confirmRate = pct(summary.byVerdict.confirm ?? 0, summary.total)
  if (summary.total >= 5 && confirmRate < 35) {
    suggestions.push({
      priority: 'high',
      area: 'Overall',
      suggestion:
        'Detector precision is low across the board. Prioritize raising burst/fault thresholds before adding new detection rules. Re-export after ~20+ more reviews for stable stats.',
      evidence: `Only ${confirmRate}% confirm rate across ${summary.total} corrections`,
    })
  }

  if (suggestions.length === 0) {
    suggestions.push({
      priority: 'low',
      area: 'Sample size',
      suggestion:
        'Not enough correction signal yet. Keep reviewing at `/review`, export JSONL, and re-run this script after 15–20 verdicts per detector kind.',
      evidence: `${summary.total} total correction(s)`,
    })
  }

  // De-dupe by suggestion text, keep highest priority
  const prioRank = { high: 3, medium: 2, low: 1 }
  const seen = new Map()
  for (const s of suggestions.sort((a, b) => prioRank[b.priority] - prioRank[a.priority])) {
    const key = s.area + s.suggestion.slice(0, 60)
    if (!seen.has(key)) seen.set(key, s)
  }
  return [...seen.values()]
}

function formatReport(filePath, records, summary, suggestions) {
  const lines = []
  lines.push('═══════════════════════════════════════════════════════════════')
  lines.push('  Musashi correction dataset analysis')
  lines.push('═══════════════════════════════════════════════════════════════')
  lines.push(`  Source: ${filePath}`)
  lines.push(`  Records: ${summary.total}  |  Ledgers: ${summary.ledgerCount}  |  Videos: ${summary.videoCount}`)
  lines.push('')

  lines.push('── Verdict summary ──')
  for (const v of VERDICTS) {
    const n = summary.byVerdict[v] ?? 0
    lines.push(`  ${v.padEnd(8)} ${String(n).padStart(4)}  (${pct(n, summary.total)}%)`)
  }
  lines.push('')

  lines.push('── By item type ──')
  for (const [itemType, verdicts] of Object.entries(summary.byItemTypeVerdict)) {
    const parts = VERDICTS.map((v) => `${v}=${verdicts[v] ?? 0}`).join(', ')
    lines.push(`  ${itemType.padEnd(10)} ${parts}`)
  }
  lines.push('')

  lines.push('── Per-kind accuracy (originalKind) ──')
  for (const k of summary.kindAccuracy) {
    lines.push(
      `  ${k.kind.padEnd(24)} n=${String(k.total).padStart(3)}  confirm ${String(k.confirmRate).padStart(5)}%  reject ${String(k.rejectRate).padStart(5)}%  relabel ${String(k.relabelRate).padStart(5)}%`
    )
  }
  lines.push('')

  if (summary.topRelabelPairs.length > 0) {
    lines.push('── Top misclassification pairs (relabel) ──')
    for (const [pair, count] of summary.topRelabelPairs) {
      lines.push(`  ${String(count).padStart(3)}×  ${pair}`)
    }
    lines.push('')
  }

  lines.push('── Suggested threshold / detector adjustments ──')
  for (const s of suggestions) {
    lines.push(`  [${s.priority.toUpperCase()}] ${s.area}`)
    lines.push(`    ${s.suggestion}`)
    lines.push(`    Evidence: ${s.evidence}`)
    lines.push('')
  }

  lines.push('── Reference: tunable keys in fightlang.defaults.ts ──')
  lines.push('  stance.minFootSpreadBw / maxFootSpreadBw')
  lines.push('  range.closeBw / midBw')
  lines.push('  guard.handsHighYMargin / exposureHighScore')
  lines.push('  faults.compromisedBaseScoreBw / overextensionScoreBw / chinExposedScore')
  lines.push('  rhythm.windowMs / minBounces / flatCadenceCv')
  lines.push('  + strike burst thresholdBwps in fightlang.compiler.ts (currently 1.2)')
  lines.push('  + strike classifiers in compiler/detectors/strikes.ts (lateralDev, verticalRatio, …)')
  lines.push('')

  return lines.join('\n')
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const records = loadJsonl(args.file)
  const summary = summarize(records)
  const suggestions = suggestAdjustments(records, summary)

  const output = {
    generatedAt: new Date().toISOString(),
    sourceFile: args.file,
    summary,
    suggestions,
  }

  if (args.json) {
    console.log(JSON.stringify(output, null, 2))
  } else {
    console.log(formatReport(args.file, records, summary, suggestions))
  }
}

main()
