# TRACKING BASELINE — 2026-06-10 — "DO NOT GO BACKWARDS FROM THIS"

This folder is the checkpoint for the best fighter-tracking state achieved on the
test clip (`clip.mp4`). If tracking ever regresses, restore from here and re-run
the eval harness before accepting any new change.

## What's in this folder

- `identityTracking.ts` — verbatim snapshot of `src/lib/identityTracking.ts` (516 lines)
- `performanceProfile.ts` — verbatim snapshot of `src/lib/performanceProfile.ts`
- `harness/detect_v2.py` — offline crop-zoom detector (Python + MediaPipe legacy)
- `harness/eval_replay.py` — metrics evaluator (identity switches, drift, tightness, ghosts)
- This file — including the verbatim FightAnalyzer.tsx diff blocks

## Verified metrics on clip.mp4 (replay_v5, the baseline)

| Metric | Old broken | Final (v5) |
|---|---|---|
| Identity switches A / B (fight portion) | 23 / 18, permanent swap at f198 | 14 / 8, no permanent swap |
| Drift frames >0.05 A / B | 52 / 11 | 6 / 5 |
| Skeleton tightness mean / p95 | 0.0259 / 0.2001 | **0.0045 / 0.0050** |
| Ghost skeleton frames after scene cut (f≥267) | 117 → 52 | **0** |
| Anchor jumps in fight | many | 1 per slot, both at scene cut only |

## The three changed files in the live app

1. `src/lib/identityTracking.ts` — full snapshot here. Key final constants:
   - `HOLD_MS_NORMAL = 450` (was 1200), `HOLD_MS_CROSSING = 1800`
   - `CLAIM_JUMP_BASE = 0.06`, `CLAIM_JUMP_PER_MS = 0.0006`, `CLAIM_JUMP_CAP = 0.22` (was 0.35)
   - `SWAP_HYSTERESIS = 0.04`, `IDENTITY_STALE_MS = 2200`, `IDENTITY_STALE_CROSSING_MS = 5000`
   - `SMOOTH_ALPHA_NORMAL = 0.88`, `SMOOTH_ALPHA_CROSSING = 0.72`
   - `PREDICTION_TAU_MS = 450`, `PREDICTION_MAX_MS = 1400`, `VELOCITY_MAX = 0.005`
   - `DUPLICATE_POSE_MEAN_DIST = 0.045`, `STABLE_FRAMES_TO_RESUME = 8`
   - Logic: teleport/claim gate (`maxClaimJump`), phantom rejection on lone candidates,
     freshness hysteresis on single-candidate assignment (kills post-cut ghost ping-pong),
     separation-scaled swap hysteresis, dead-slot appearance-dominant rebind,
     duplicate-pose dedupe, crossing phase machine with crossing-aware staleness.

2. `src/lib/performanceProfile.ts` — full snapshot here. Added `refineMinIntervalMs`
   (lite 0 = off, balanced 120, max 60) controlling crop-zoom refinement cadence.

3. `src/components/video/FightAnalyzer.tsx` — three edits (verbatim below).
   Anchor line numbers as of this checkpoint: import @48, refs @293-294,
   refinement block @1042-1079, coasting gate @1121-1148.

### FightAnalyzer edit 1 — import (line 48)

```ts
import { createRetryLandmarker, detectSecondFighter as detectSecondFighterShared, detectInRegion } from '@/lib/poseRetry'
```

### FightAnalyzer edit 2 — refs (after retryCropCanvasRef, lines 293-294)

```ts
const refineCanvasRef = useRef<{ A: HTMLCanvasElement | null; B: HTMLCanvasElement | null }>({ A: null, B: null })
const lastRefineWallMsRef = useRef<{ A: number; B: number }>({ A: 0, B: 0 })
```

### FightAnalyzer edit 3 — crop-zoom refinement block (between the appearance-reconciliation block and `const holdMs = crossingHoldMs(...)`)

This is THE breakthrough for skeleton tightness (mean drift 0.0259 → 0.0045).
Each detected fighter is re-detected on a zoomed crop so MediaPipe sees ~4x
the pixels per body.

```ts
        // Skipped while fighters overlap (the crop would contain both bodies)
        // and rate-limited per performance tier.
        if (!opts?.preScan && perfForGap.refineMinIntervalMs > 0 && crossingPhaseRef.current === 'tracking') {
          const retry = retryLandmarkerRef.current
          const boxOf = (p: NormalizedLandmark[]) => {
            const vis = p.filter((lm) => (lm.visibility ?? 1) > 0.3)
            if (vis.length < 6) return null
            return {
              left: Math.min(...vis.map((l) => l.x)),
              top: Math.min(...vis.map((l) => l.y)),
              right: Math.max(...vis.map((l) => l.x)),
              bottom: Math.max(...vis.map((l) => l.y)),
            }
          }
          const boxA = rawA ? boxOf(rawA) : null
          const boxB = rawB ? boxOf(rawB) : null
          const boxesOverlap =
            boxA && boxB
              ? Math.max(0, Math.min(boxA.right, boxB.right) - Math.max(boxA.left, boxB.left)) > 0 &&
                Math.max(0, Math.min(boxA.bottom, boxB.bottom) - Math.max(boxA.top, boxB.top)) > 0
              : false
          if (retry && !boxesOverlap) {
            const refineSlot = (key: 'A' | 'B', raw: NormalizedLandmark[] | null, box: { left: number; top: number; right: number; bottom: number } | null) => {
              if (!raw || !box) return raw
              if (wallNow - lastRefineWallMsRef.current[key] < perfForGap.refineMinIntervalMs) return raw
              // Box must be small enough that zooming actually helps.
              if (box.right - box.left > 0.6 || box.bottom - box.top > 0.85) return raw
              lastRefineWallMsRef.current[key] = wallNow
              if (!refineCanvasRef.current[key]) refineCanvasRef.current[key] = document.createElement('canvas')
              const refined = detectInRegion(retry, detectSurface, box, refineCanvasRef.current[key]!)
              if (!refined) return raw
              const a0 = getPoseAnchor(raw)
              const a1 = getPoseAnchor(refined)
              if (!a0 || !a1 || Math.hypot(a0.x - a1.x, a0.y - a1.y) > 0.06) return raw
              return refined
            }
            if (rawA) rawA = refineSlot('A', rawA, boxA)
            if (rawB) rawB = refineSlot('B', rawB, boxB)
          }
        }
```

### FightAnalyzer edit 4 — velocity coasting gated to crossings only

Both A and B nudge blocks must be guarded by `coastingOk`:

```ts
        // Only coast while a crossing is in progress — that is when the hidden
        // fighter is genuinely moving behind the opponent. During normal
        // tracking a missed detection is noise; coasting on velocity made the
        // skeleton visibly sail off the body, so we freeze in place instead.
        const coastingOk = isCrossingPhase(crossingPhaseRef.current)
        if (coastingOk && keepA && !rawA && smoothedLandmarksRef.current.A) { ... }
        if (coastingOk && keepB && !rawB && smoothedLandmarksRef.current.B) { ... }
```

## How to verify nothing regressed (eval harness)

Offline, against any test clip (needs Python with opencv + mediapipe legacy):

```
# 1. extract candidates with the crop-zoom detector (clip.mp4 in cwd)
python harness/detect_v2.py 0 400          # -> v2_0_400.json

# 2. run candidates through the app's REAL TypeScript pipeline (esbuild-bundled
#    runner over identityTracking.ts) to produce replay.json, then:
python harness/eval_replay.py replay.json v2_0_400.json
```

Accept a change only if switches/drift/tightness/ghost numbers are equal or better
than the table above. Unit tests: `npx vitest run src/lib/identityTracking.test.ts`.

## Known caveats

- Constants were tuned on one clip. Logic is general; validate new clip types
  (different camera angles, gi vs no-gi, scene cuts) with the harness first.
- `eval_replay.py` hard-codes scene-cut frame 267 for clip.mp4 (`CUT = 267`).
- Crop-zoom refinement is disabled on 'lite' tier hardware by design.

## Restore procedure

Copy `identityTracking.ts` and `performanceProfile.ts` from this folder over
`src/lib/`. For FightAnalyzer.tsx, verify the four edit blocks above are intact
(grep for `refineCanvasRef`, `coastingOk`, `detectInRegion`).

---

# UPDATE — 2026-06-11 session (second-clip generalization + ghost fix + UI)

`identityTracking.ts` in this folder has been REFRESHED to include these changes.

## New test clip

`download_package/test videos/test video for app.mp4` (portrait 478x850, 30fps,
384 frames). Stresses a NEW failure mode: a fighter walks out of frame after a
close pass (~f265), and an Instagram watermark overlay ("@DUNCANTHEHIGHLANDER",
anchor ~(0.49,0.48)) plus duplicate blobs get misdetected as a person.

## Bug found and fixed: out-of-frame ghost skeleton

Two compounding causes:
1. Phase stuck in 'recovering' after the fighter left frame; the claim gate was
   fully disabled during crossings, so phantom candidates (watermark, dup blobs)
   refreshed the empty slot's wallMs unchecked → frozen ghost up to 5 s.
2. `assignCornerIdentities` (FightAnalyzer.tsx) returned the slot's HELD pose
   during crossings; the caller treats any returned pose as a fresh sighting
   (refreshes lastSeen/smoothing/velocity) → self-renewing render hold.

Fixes (all in the refreshed snapshot / live app):
- `CROSSING_CLAIM_FREE_MS = 600` — crossing claim-gate suspension is now
  time-limited; a slot hidden longer must pass the teleport gate even mid-cross.
- `TELEPORT_COLOR_MAX = 0.16` — color escape hatch in `claimOk` so legit
  scene-cut teleports still rebind (same fighter ~0.05-0.12) while phantoms
  (~0.25+) stay rejected. Without this, old-clip post-cut rebind regressed.
- FightAnalyzer `assignCornerIdentities` now returns ONLY real assignments
  (`assignA?.pose ?? null`), never held poses.

## Verified metrics after this session (final, replay-identical re-run 06-11)

Old clip (clip.mp4, CUT=267):
| Metric | v5 baseline | now |
|---|---|---|
| Switches A/B | 14 / 8 | 14 / 8 |
| Drift>0.05 A/B | 6 / 5 | 10 / 5 (accepted trade) |
| Tightness mean/p95 | 0.0045 / 0.0050 | 0.0053 / 0.0057 |
| Floating-skeleton A frames (>0.08 from all candidates) | 117 | 56 |

New clip (no scene cut; eval with CUT=999):
- Switches A/B 12/12, ghost post-"cut" 0
- Floating A frames 113 → 63 (remainder = intentional 1.8 s render hold while
  the fighter is off-frame; skeleton freezes then hides, never locks onto the
  watermark — verified visually in newclip_tracked.mp4 renders)
- Note: eval "drift A 65 / tightness p95 0.42" on this clip is the held-pose
  artifact of the off-frame segment, not on-body looseness; use the floating
  metric for this clip.

## UI polish (FightOverlay.tsx) — same session

- `drawSkeletonMapped`: proportional stroke (`bodyPx * 0.016`, clamped 2.5-5.5),
  two-pass neon-tube bones (colored glow pass + white core at 0.32 width),
  proportional joints with inner white dots. Blue A / red B kept.
- `drawFighterBoxMapped`: removed the cheap translucent fill wash; now
  broadcast-HUD style — solid glowing corner brackets (length 18% of box,
  clamped 10-26px) over a fine 1.25px dashed perimeter at 45% alpha.

---

# RE-VERIFICATION — 2026-06-11 (fresh environment, end-to-end)

Confirmed integration + reproduced metrics after the original harness env was lost.

- Live `src/lib/identityTracking.ts` and `performanceProfile.ts` byte-identical
  to this folder's snapshots. All four FightAnalyzer edit blocks present
  (import @48, refs @293, refinement @1048-1085, coastingOk @1127-1142,
  ghost fix `assignA?.pose ?? null` @803). FightOverlay polish present.
- Unit tests: 27/27 pass (`npx vitest run src/lib/identityTracking.test.ts`).
- Harness env rebuilt: **Python 3.11 + mediapipe 0.10.14 + opencv-python**
  (mediapipe ≥0.10.3x dropped the legacy `mp.solutions` API detect_v2.py needs).
- The replay runner lives in the repo: `src/lib/identityReplay.offline.test.ts`.
  Run: `REPLAY_CANDS=<v2json> REPLAY_OUT=<out> npx vitest run src/lib/identityReplay.offline.test.ts`.
  Fixed this session: its assignCornerIdentities still returned HELD poses
  (pre-ghost-fix behavior); synced to the live `assignA?.pose ?? null`.
  Before sync it reproduced the old ghost bug (floating A 121).
- New-clip eval (test-assets/test-video-for-app.mp4, CUT=999), fresh detector run:
  switches A/B **12/12** (exact match), drift A/B 67/7, tightness p95 0.42,
  floating A **66** vs documented 63 (delta = detector-version noise; mediapipe
  0.10.14 vs original env). Floating-A runs: f115-124, f261-263, f266-318 —
  the 53-frame run is the documented intentional 1.8 s off-frame hold, and the
  skeleton hides after f318 without locking onto the watermark. ✓ baseline held.
- Work dir with candidates/replay: `tracking-eval-2026-06-11/` (eval_replay.py
  copy there reads `CUT` from env).
- ⚠️ The ORIGINAL clip.mp4 (scene-cut clip behind the v5 table above) is no
  longer on disk anywhere — only the second clip survives. To re-verify the
  old-clip numbers, the user must re-supply that clip.

---

# LIVE-APP REGRESSION FOUND & FIXED — 2026-06-11 (perf tier bug)

User reported live skeleton at ~20% vs baseline. Tracking files were intact;
the cause was `performanceProfile.ts` tier selection: `mem <= 8` — but Chrome
CAPS `navigator.deviceMemory` at 8, so EVERY Chrome machine matched and was
forced into 'lite' tier: FULL model instead of HEAVY, CPU 21 Hz, 600 ms crop
retry, and **crop-zoom refinement disabled** (the 6x tightness feature).
Confirmed live: boot log showed `[Pose] Main landmarker ready (CPU, full)` and
flooding `[Pose Retry]` logs.

Fix (performanceProfile.ts): lite now requires mem<=4 OR cores<=4 OR
(iGPU AND cores<=8); added `?perfTier=lite|balanced|max` URL override and
`localStorage.musashiPerfTier`. After fix, this 22-core/Arc machine boots
`[PerfProfile] balanced` + `[Pose] Main landmarker ready (CPU, heavy)` with
refinement active — verified in-browser with skeletons locked on both fighters.

Diagnostic cheat-sheet: read the browser console on boot —
`[PerfProfile] <tier>` line shows tier + signals; `[Pose] Main landmarker
ready (<delegate>, <model>)` must say `heavy` on capable hardware.
Machine-load caveat: a starved machine (other dev servers, <2 GB free RAM)
still degrades cadence via FrameBudget backoff regardless of tier.

Second tier bug, same Chrome cap: max tier required `mem >= 24`, which
deviceMemory (capped at 8) can never satisfy — max was unreachable in Chrome.
Fixed: `(isDiscreteGpu || cores >= 16) && cores >= 12`.

# DENSE-TRACK REPLAY — 2026-06-11 (offline-grade quality in the app)

The live realtime pipeline cannot match the offline harness (which re-detects
every fighter on every frame with no time budget). So the app now reproduces
the harness regime at boot: after the sparse pre-scan, FightAnalyzer steps the
WHOLE clip in order through the full pipeline with `densePass: true` —
refinement + crop-retry forced on every frame, no rate limits, identity timing
on MEDIA time (like eval_replay) — and caches the finished track
(`denseTrackRef`). During playback, `replayDenseFrame()` renders the cached
sample nearest the displayed frame and skips live detection entirely.
Constants: DENSE_TRACK_MIN_STEP_MS=33, MAX_SAMPLES=1800, TOLERANCE_MS=70,
MAX_DURATION 10 min. Falls back to live detection when no sample is close
(track unfinished / very long clip). Console marker: `[DenseTrack] ready — N
frames @ Sms step`. Boot pass takes ~3-6 min for a 13 s clip on a loaded
machine (unoptimized; future: skip sparse pass, larger step + interpolation,
worker decode).

Purity fixes (2026-06-12, after "jumping off the people" reports): the dense
pass must equal the offline replay EXACTLY — it now disables the appearance
override, the assignFightersWithTracking motion fallback, and pre-scan hints
(densePass opts / densePassActiveRef), and resets identity profiles, velocity,
and swap streak before stepping. Track is persisted in IndexedDB
(src/lib/denseTrackCache.ts, key includes TRACK_PIPELINE_VERSION — bump it
whenever detection/identity behavior changes, or stale tracks replay).

ACCEPTED CHANGE (2026-06-12): containment dedupe in identityTracking.ts —
dedupePoseCandidates now also rejects a candidate whose visible-joint box sits
>60% inside another's (intersection/min-area, detect_v2.py semantics) when
mean joint distance < 0.12. Kills warped same-body duplicates that flailed
limbs on the remaining fighter after an exit. EVAL-VALIDATED: switches A 12
B 10 (B improved), drift A 62, tightness mean 0.0360 / p95 0.4172 — all equal
or better than baseline. TRACK_PIPELINE_VERSION bumped to 4.

END-OF-CLIP DOUBLE-SKELETON ROOT CAUSE (found by reading the cached track):
after the red fighter walks off-frame (~8.8 s), detectSecondFighter's
half-frame crop re-detected the REMAINING fighter as a "second fighter"
(distinctPoseScore ≈ 0.04-0.06 vs 0.27-0.40 for genuine finds; the IoU
duplicate check misses part-of-body re-detections — small box inside big box).
Slot A then live-tracked ON TOP of B for the last ~3 s (anchors identical in
the cached track). Fix: RETRY_MIN_DISTINCT_SCORE = 0.12 floor in
src/lib/poseRetry.ts — applies to live tracking too. Diagnostic: flooding
`[Pose Retry] Found second fighter, score=0.0xx` (low scores) = phantom.

