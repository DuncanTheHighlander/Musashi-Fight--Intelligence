# Vision-First Rebuild — Rollout & Benchmark Notes

**Branch:** `feature/vision-first-rebuild` (backup: `backup/pre-vision-first-7e9cbaf`)
**Flag:** `MUSASHI_VISION_FIRST_ENABLED=1` + `NEXT_PUBLIC_MUSASHI_VISION_FIRST_ENABLED=1`
(set BOTH; unset = full rollback to the pre-rebuild pipeline).
**Status:** implemented and locally tested. **NOT deployed to production.**

## Authority order (implemented)

1. Normalized video + audio (Modal FFmpeg, ≤1280-wide H.264/AAC 30fps, original kept in R2)
2. Gemini evidence extraction — ONE full-video call (`lib/evidence/visionEvidence.ts`,
   SEEN / HEARD / INFERRED / UNCERTAIN, people roles, fighter assignment, phases, coaching windows)
3. Confirmed focus fighter (`lib/fight/fighterNaming.ts` — Blue/Red only when visually
   confirmed; tap-confirmation flag below 0.6 assignment confidence)
4. Musashi sport brain (unchanged content, still ahead of generation)
5. Approved Teach corrections (scan → retry once → targeted override; "applied" only when proven —
   `lib/aiCorrections/compliance.ts`)
6. Optional reliable RTMPose/FightLang sidecar (quality ≥ medium, coverage ≥ 0.5, both-fighters ≥ 0.5;
   dropped otherwise, re-dropped server-side)
7. Validator (`llm-output.validator` + compliance audit persisted with the ledger)
8. Coach Cards + grounded chat (chat grounds on the evidence JSON — zero video re-sends)

**Cost rule enforced:** the tape goes to Gemini exactly once per analysis. The old boot ran up to
6 video-bearing calls (comet flash scan + flash ledger + deep read, plus analyze scan + verify +
coach); the new boot runs 1 evidence call + 1 text-only coaching call.

## Model / API facts (verified against official docs 2026-07-23)

- `gemini-3.6-flash` — **stable GA (2026-07-21)**; production default everywhere
  (env-overridable; never a `-preview` or `-latest` in production).
- `videoMetadata.fps` range is `0 < fps <= 24` → default `MUSASHI_GEMINI_VIDEO_FPS=24`.
- Media resolution LOW = 66 tokens/frame; audio 32 tokens/s.
- Gemini 3.x: temperature/topP/topK left at server defaults per official guidance
  (legacy 2.x calls keep their tuning).
- API key now travels in `x-goog-api-key` header (evidence/coaching/generateJson paths).

## 12 vs 24 FPS benchmark (gemini-3.6-flash, LOW media res, real clips, 2026-07-23)

`node scripts/visionEval.mjs --model gemini-3.6-flash --fps 12,24 --sport mma --coaching`

| clip | fps | evidence latency | total tokens (evidence) | coaching latency/tokens | fighters | non-fighter focus errors |
|---|---|---|---|---|---|---|
| test-video-for-app.mp4 | 12 | 17.3 s | 11,872 | 9.3 s / 3,059 | 2 | 0 |
| test-video-for-app.mp4 | 24 | 16.9 s | 21,597 | 8.3 s / 2,665 | 2 | 0 |
| clip2-overlap.mp4 | 12 | 16.1 s | 19,946 | 5.8 s / 3,214 | 2 | 0 |
| clip2-overlap.mp4 | 24 | 14.3 s | 37,778 | 11.8 s / 3,225 | 2 (+1 spectator correctly classified) | 0 |

Readings:
- **24 fps ≈ 1.8–1.9× input tokens vs 12 fps; latency is a wash (14–18 s both).**
- Fighter identification was perfect at both rates on these clips (badFocus=0 in every run);
  24 fps enumerated more background people and classified them correctly (spectators, never fighters).
- Cost at 3.6-flash pricing (~$1.50/M in, $7.50/M out): ≈ $0.04–0.06 per 24 fps analysis vs
  ≈ $0.02–0.04 at 12 fps — both trivially cheap; **24 fps stays the default** (non-negotiable +
  fast-strike headroom), `MUSASHI_GEMINI_VIDEO_FPS=12` is the cost-saver knob.
- Pose-disabled result: every benchmark run coached with ZERO pose input and produced
  sport-true MMA cues (level-change masking, hand recovery after straights, caught-kick risk on
  naked high kicks) — Coach Cards do not need pose, by construction and by measurement.
- One transient `high demand` 503 on 24 fps (retried clean) — the in-app path already retries
  429/503 with backoff and cascades models.

## 22458.mp4 regression

The clip is **not on this machine** (`/mnt/data/22458.mp4` and repo searched). The live regression
test is committed and skip-safe: drop the file at `public/test-videos/22458.mp4`, then

```
MUSASHI_RUN_LIVE_EVAL=1 pnpm exec vitest run src/lib/evidence/visionEvidence.regression.test.ts
```

It asserts: two fighters vs referee/spectators/cameraman, no non-fighter focus candidate, cage
scene recognized, audio ("throw a knee") stays in HEARD, no invented hidden grips, coaching
windows present, Blue/Red naming only when confirmed, and the whole path never touches pose.

## A/B conditions map

- **A (current pipeline):** flag off — byte-compatible legacy behavior.
- **B (vision only)** and **E (12 vs 24 fps):** `scripts/visionEval.mjs` (results above).
- **C (vision + sport brain):** harness `--coaching` (results above).
- **D (vision + brain + reliable pose):** in-app with flag on and a clip whose dense track passes
  the sidecar gate (`quality != low`, coverage ≥ 0.5, bothFighters ≥ 0.5).

## Deviations from the letter of the spec (documented)

1. **Teach approval stays Shogun-only.** The spec said "preserve the correction system but complete
   it"; opening approval to non-admin owners is a product/permissions decision, deferred.
2. **"Watching the fight" → "Building coaching"** stage transition is timer-approximated client-side
   (both passes run inside one analyze request); exact server-driven stage events would need
   streaming and are deferred.
3. **Sport-aware FPS (10/5) removed** in favor of one configurable evidence FPS — the coaching pass
   no longer re-sends video, so the old per-sport cost split has no purpose and undersampled fast
   striking.
4. **Legacy chat's first-message deep pipeline** still exists for flag-off mode only; under the flag
   it is bypassed entirely (chat is seeded from the analyze payload and grounded on evidence JSON).

## Rollout checklist

1. Internal: flag on locally (`.env.local` already set), Shogun accounts exercise Fight Lab across
   sports; watch `[VisionFirst]` / `[TeachCompliance]` logs.
2. Drop 22458.mp4 fixture and run the live regression.
3. Production: set both flag vars + `MUSASHI_GEMINI_VIDEO_FPS` on the Worker, `GEMINI_MODEL=gemini-3.6-flash`,
   deploy ONLY after approval.
4. Rollback: unset the two flag vars (no schema/data migrations were made).
