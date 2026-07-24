#!/usr/bin/env node
/**
 * Vision-first evaluation harness — benchmarks the Pass-1 evidence call and
 * the Pass-2 (no-video) coaching call against real clips with real Gemini.
 *
 * Conditions covered per clip:
 *   B  vision evidence only            (fps from --fps list)
 *   C  vision evidence + sport brain coaching (no video re-send)
 *   E  fps sweep (default 12 vs 24)
 * Condition A (legacy pipeline) and D (pose sidecar) are in-app comparisons —
 * run them through Fight Lab with the flag off/on.
 *
 * Usage:
 *   node scripts/visionEval.mjs [--clips a.mp4,b.mp4] [--fps 12,24]
 *     [--sport mma] [--coaching] [--model gemini-3.6-flash]
 *
 * Reads GEMINI_API_KEY from .env.local / environment. Costs real tokens.
 * Results: eval-results/vision-eval-<timestamp>.json + console table.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'

// ---- tiny .env.local loader (no deps) --------------------------------------
function loadEnvLocal() {
  const p = path.resolve('.env.local')
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnvLocal()

const API_KEY = process.env.GEMINI_API_KEY
if (!API_KEY || /your-/.test(API_KEY)) {
  console.error('GEMINI_API_KEY not configured (.env.local) — aborting.')
  process.exit(1)
}

// ---- args -------------------------------------------------------------------
const args = process.argv.slice(2)
const argVal = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt
}
const MODEL = argVal('model', process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || 'gemini-3.6-flash')
const FPS_LIST = argVal('fps', '12,24').split(',').map(Number).filter((n) => n > 0 && n <= 24)
const SPORT = argVal('sport', 'mma')
const RUN_COACHING = args.includes('--coaching')
const DEFAULT_CLIPS = [
  'public/test-videos/22458.mp4',
  'public/test-videos/test-video-for-app.mp4',
  'public/test-videos/clip2-overlap.mp4',
]
const CLIPS = (argVal('clips', '') ? argVal('clips', '').split(',') : DEFAULT_CLIPS).filter((c) => {
  if (!existsSync(c)) {
    console.warn(`skip (missing): ${c}`)
    return false
  }
  const mb = statSync(c).size / (1024 * 1024)
  if (mb >= 19.5) {
    console.warn(`skip (>=20MB, needs Files API — use in-app run): ${c}`)
    return false
  }
  return true
})
if (CLIPS.length === 0) {
  console.error('No usable clips (<20MB) found. Drop 22458.mp4 into public/test-videos/ or pass --clips.')
  process.exit(1)
}

// ---- evidence pass (mirrors src/lib/evidence/visionEvidence.ts semantics) ---
// NOTE: the schema/prompt here intentionally mirror the app module. This is a
// standalone benchmark tool; keep in sync when the evidence contract changes.
const RESPONSE_SCHEMA = JSON.parse(
  readFileSync('scripts/visionEvidenceSchema.json', 'utf8'),
)

function evidencePrompt(sport, durSec) {
  return `You are the evidence extraction stage of Musashi Fight Intelligence. Watch the ENTIRE video, including the audio track, and return one strict JSON evidence ledger. You are NOT coaching yet.

CONTEXT: Selected sport: ${sport}. The clip is about ${Math.round(durSec || 30)} seconds long.

PEOPLE AND ROLES: Enumerate EVERY distinct person: fighters, referee, coaches, spectators, cameraman. A person is a FIGHTER only if actively competing inside the fight area. A large person in the foreground near the camera is almost always a spectator or cameraman, NOT a fighter. focusCandidate=true ONLY for competing fighters. Assign fighterA/fighterB to the two fighters with a stated basis; cornerColors blue/red ONLY when visually confirmed, else "unknown".

EVIDENCE CLASSES — strictly separate: "seen" = visual facts with timestamps. "heard" = audio ONLY (a voice shouting "throw a knee" is a HEARD coach_instruction and NEVER evidence a knee was thrown). "inferred" = reasoning citing its basis. "uncertain" = what cannot be known (hidden grips, occluded limbs) — NEVER invent them.

Also return: scene, fight phases, and 1-4 coachingWindows. Timestamps as seconds. Output exactly the JSON schema, schemaVersion "vision-evidence/1". No markdown.`
}

async function geminiCall(model, parts, generationConfig) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`
  const t0 = Date.now()
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
  })
  const latencyMs = Date.now() - t0
  const data = await resp.json().catch(() => null)
  if (!resp.ok) throw new Error(data?.error?.message || `HTTP ${resp.status}`)
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || ''
  return {
    latencyMs,
    text,
    usage: {
      prompt: data?.usageMetadata?.promptTokenCount ?? null,
      output: data?.usageMetadata?.candidatesTokenCount ?? null,
      total: data?.usageMetadata?.totalTokenCount ?? null,
    },
  }
}

async function runEvidence(clipPath, fps) {
  const b64 = readFileSync(clipPath).toString('base64')
  const { latencyMs, text, usage } = await geminiCall(MODEL, [
    { inlineData: { mimeType: 'video/mp4', data: b64 }, videoMetadata: { fps } },
    { text: evidencePrompt(SPORT) },
  ], {
    responseMimeType: 'application/json',
    responseSchema: RESPONSE_SCHEMA,
    mediaResolution: 'MEDIA_RESOLUTION_LOW',
    maxOutputTokens: 16384,
    thinkingConfig: { thinkingLevel: 'LOW' },
  })
  let evidence = null
  try {
    evidence = JSON.parse(text)
  } catch {
    /* keep null */
  }
  const roles = {}
  for (const p of evidence?.people ?? []) roles[p.role] = (roles[p.role] ?? 0) + 1
  const badFocus = (evidence?.people ?? []).filter((p) => p.role !== 'fighter' && p.focusCandidate).length
  return {
    fps,
    latencyMs,
    usage,
    parsed: Boolean(evidence),
    people: evidence?.people?.length ?? 0,
    roles,
    nonFighterFocusCandidates: badFocus,
    seen: evidence?.seen?.length ?? 0,
    heard: evidence?.heard?.length ?? 0,
    inferred: evidence?.inferred?.length ?? 0,
    uncertain: evidence?.uncertain?.length ?? 0,
    seenTimestamps: (evidence?.seen ?? []).slice(0, 6).map((s) => `${s.startSec}-${s.endSec}s ${s.observation?.slice(0, 60)}`),
    fighterAssignment: evidence?.fighterAssignment ?? null,
    evidence,
  }
}

async function runCoaching(evidence) {
  let brain = ''
  try {
    brain = readFileSync(`coach-brain/sports/${SPORT === 'mma' ? 'mma' : SPORT}.md`, 'utf8').slice(0, 8000)
  } catch { /* optional */ }
  const prompt = `You are Musashi Fight Intelligence. Coach from this VISION EVIDENCE LEDGER (primary truth; "heard" is audio only and never proves an action; respect "uncertain"; coach only people with role "fighter").

SPORT BRAIN:\n${brain}\n\nEVIDENCE:\n${JSON.stringify(evidence).slice(0, 60000)}\n\nReturn JSON: {"mainDiagnosis": string (max 2 sentences), "quickCues": [{"actorId":"A|B","quickCue":string}], "suggestedCorrections":[{"actorId":"A|B","title":string,"why":string,"doInstead":string}]}`
  const { latencyMs, text, usage } = await geminiCall(MODEL, [{ text: prompt }], {
    responseMimeType: 'application/json',
    maxOutputTokens: 4096,
    thinkingConfig: { thinkingLevel: 'LOW' },
  })
  let coaching = null
  try { coaching = JSON.parse(text) } catch { /* keep null */ }
  return { latencyMs, usage, parsed: Boolean(coaching), coaching }
}

// ---- main -------------------------------------------------------------------
const results = []
for (const clip of CLIPS) {
  for (const fps of FPS_LIST) {
    process.stdout.write(`\n▶ ${path.basename(clip)} @ ${fps}fps (${MODEL}) … `)
    try {
      const ev = await runEvidence(clip, fps)
      let coaching = null
      if (RUN_COACHING && ev.evidence) coaching = await runCoaching(ev.evidence)
      results.push({ clip: path.basename(clip), ...ev, evidence: undefined, coachingPass: coaching })
      console.log(
        `ok — ${ev.latencyMs}ms, tokens=${ev.usage.total}, people=${ev.people} ${JSON.stringify(ev.roles)}, seen=${ev.seen}, heard=${ev.heard}, uncertain=${ev.uncertain}, badFocus=${ev.nonFighterFocusCandidates}` +
          (coaching ? ` | coaching ${coaching.latencyMs}ms tokens=${coaching.usage.total}` : ''),
      )
    } catch (e) {
      console.log(`FAILED: ${e.message}`)
      results.push({ clip: path.basename(clip), fps, error: e.message })
    }
  }
}

mkdirSync('eval-results', { recursive: true })
const out = `eval-results/vision-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(out, JSON.stringify({ model: MODEL, sport: SPORT, results }, null, 2))
console.log(`\nSaved: ${out}`)

// Compact comparison table
console.log('\nclip                          fps  latency  tokens  people  seen  heard  unc  badFocus')
for (const r of results) {
  if (r.error) { console.log(`${r.clip.padEnd(28)} ${String(r.fps).padStart(3)}  ERROR: ${r.error.slice(0, 60)}`); continue }
  console.log(
    `${r.clip.padEnd(28)} ${String(r.fps).padStart(3)}  ${String(r.latencyMs).padStart(6)}ms ${String(r.usage.total).padStart(6)}  ${String(r.people).padStart(5)}  ${String(r.seen).padStart(4)}  ${String(r.heard).padStart(5)}  ${String(r.uncertain).padStart(3)}  ${String(r.nonFighterFocusCandidates).padStart(7)}`,
  )
}
