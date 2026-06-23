/**
 * Offline identity-tracking replay harness.
 *
 * Replays pre-extracted per-frame pose candidates (JSON, produced by an
 * offline detector run over a test clip) through the EXACT identity pipeline
 * used by FightAnalyzer.assignCornerIdentities + processPoseFrame:
 *   dedupe → bipartite assignment → crossing lock → phase machine →
 *   hold/keep → velocity nudge → adaptive smoothing.
 *
 * The pipeline itself now lives in src/lib/identityReplayCore.ts (shared with
 * the cloud GPU dense pass). This file is the thin replay driver + eval-output
 * writer; it asserts nothing on its own but regenerates the eval JSONs.
 *
 * Run:
 *   REPLAY_CANDS=/path/a.json,/path/b.json REPLAY_OUT=/path/out.json \
 *     npx vitest run src/lib/identityReplay.offline.test.ts
 */
import { describe, it } from 'vitest'
import { readFileSync, writeFileSync } from 'fs'
import { IdentityReplayer, type ReplayInFrame } from '@/lib/identityReplayCore'

describe('identity replay', () => {
  it('replays candidate JSON through the live identity pipeline', () => {
    const candFiles = (process.env.REPLAY_CANDS ?? '').split(',').filter(Boolean)
    const outFile = process.env.REPLAY_OUT
    if (candFiles.length === 0 || !outFile) {
      console.log('REPLAY_CANDS / REPLAY_OUT not set — skipping replay')
      return
    }

    const frames: ReplayInFrame[] = candFiles.flatMap((f) => JSON.parse(readFileSync(f, 'utf8')))
    frames.sort((a, b) => a.f - b.f)

    const replayer = new IdentityReplayer()
    const out: unknown[] = []
    for (const frame of frames) {
      const r = replayer.push(frame)
      out.push({
        f: frame.f,
        tMs: frame.tMs,
        phase: r.phase,
        lock: r.lock,
        nCands: r.nCands,
        rawA: r.rawA,
        rawB: r.rawB,
        A: r.A?.map((l) => [+l.x.toFixed(4), +l.y.toFixed(4), +(l.visibility ?? 0).toFixed(2)]) ?? null,
        B: r.B?.map((l) => [+l.x.toFixed(4), +l.y.toFixed(4), +(l.visibility ?? 0).toFixed(2)]) ?? null,
      })
    }

    writeFileSync(outFile, JSON.stringify(out))
    console.log(`replayed ${frames.length} frames -> ${outFile}`)
  })
})
