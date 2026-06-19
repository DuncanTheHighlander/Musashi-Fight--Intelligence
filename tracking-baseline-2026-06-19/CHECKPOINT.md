# TRACKING CHECKPOINT — 2026-06-19 — "DO NOT GO BACKWARDS FROM THIS"

Known-good fighter-tracking state after reverting the crop-first dense-pass
regression. The user confirmed in-app: "this is much much better" across the
portrait demo clip AND busy gym / street-fight clips (bystanders in frame).
This folder is the restore point. If tracking regresses, copy these files back
over `src/` and re-verify before accepting any new change.

`TRACK_PIPELINE_VERSION = 17` (denseTrackCache.ts). Bump on ANY detection/
identity change so stale cached tracks can't replay.

## The regime that works (and the trap that doesn't)

Quality comes from the **2-fighter A/B corner system** + a **dense boot pass**
that mirrors the eval-validated offline replay EXACTLY:

  full-frame `landmarker.detectForVideo` → crop-retry on a missed 2nd fighter
  → `dedupePoseCandidates` → `assignCornerIdentities` → **crop-zoom refinement
  on EVERY dense frame** → cache to IndexedDB → playback replays the cache.

⚠️ **DO NOT reintroduce "crop-first" / per-fighter follow-box detection on the
dense pass.** That was the 2026-06-19 regression (pipeline v12–v15): each
fighter was re-detected inside his own box carried from the previous frame
(padded 35% + leg-extension), full-frame only as a <2 fallback. It is a
feedback loop — one bad frame makes the crop chase a bystander forward
("B switches to unknown"), and padded crops swallow a neighbor so MediaPipe
fits ONE skeleton across TWO bodies = exploding spider-web limbs. It also
breaks the invariant that the dense pass must equal the offline replay.
If a clip needs better detection (e.g. the 360p slow-mo case), the lever is a
better DETECTOR (RTMPose — see RTMPOSE_SETUP.md / [[rtmpose-and-selection-wip]]),
NOT crop hacks on the shared dense pass.

## Files snapshotted (verbatim copies of the live good state)

| File | Role |
|---|---|
| `src/components/video/FightAnalyzer.tsx` | THE pipeline — detection acquisition, dense pass, refinement, occlusion bridge, coasting, replay |
| `src/lib/identityTracking.ts` | identity math (claim gate, crossing machine, containment dedupe) |
| `src/lib/performanceProfile.ts` | tier selection (Chrome deviceMemory-cap fix, perfTier override) |
| `src/lib/poseRetry.ts` | crop-retry 2nd-fighter (`RETRY_MIN_DISTINCT_SCORE=0.12`), `detectInRegion` |
| `src/lib/denseTrackCache.ts` | IndexedDB cache, `TRACK_PIPELINE_VERSION`, `pruneGhostRuns` |
| `src/lib/kinematics.ts` | landmark smoothing, torso-relative foot guard |
| `src/components/overlay/FightOverlay.tsx` | skeleton/HUD rendering + dense-frame replay tick |

## Verified metrics (this session, fresh v-pipeline dense run)

clip1 `public/test-videos/test-video-for-app.mp4` (478×850, 387-frame dense):
- Joint span / torso-height: median ~2.3, p95 ~2.6–2.9  (healthy full body; a
  cross-two-bodies "web" reads 5–8+)
- Exploded frames (span > 4.5): A 8/387 (2%), B 0
- Presence: B 100%, A 82.9% (the ~66 absent A = intentional off-frame hold when
  that fighter walks out ~f265 — matches the documented baseline)
- Torso-relative jitter p95: wrist 0.061, ankle 0.084 (A) / 0.104 (B) — within
  the historical run-variance band
- Playback replays the dense track (replayCalls/emits > 0); canvas at t=6s =
  ~13k blue(A) + ~19k red(B) px, ~10% frame opacity (two clean skeletons)

Busy clips (clip2-overlap + a ~22s/696-frame street-fight upload): user-confirmed
visually — both skeletons attach to the two real fighters through bystanders;
residual roughness only on a grappling takedown collapse + deep clinch occlusion
(the genuinely hard frames), not the old pervasive webs.

## How to verify a future change didn't regress

1. `npx tsc --noEmit`  → 0 errors
2. `npx vitest run src/lib/identityTracking.test.ts`  → 27/27
3. Preview: load `?fixtureVideo=/test-videos/test-video-for-app.mp4`, wait for
   the 387-frame dense pass, then read `window.__denseTrack` and recompute the
   span/exploded/presence/jitter table above. Accept only if equal-or-better.
   (Method + the 3-clip envelope: see the 2026-06-19 memory + tracking-baseline-2026-06-10.)
   Note: preview_screenshot hangs on the live-canvas route — sample the overlay
   canvas pixels via preview_eval instead.

## Restore procedure

Copy the four `src/...` paths in this folder back over the repo's `src/`, then
bump `TRACK_PIPELINE_VERSION` (so any cache written by the bad build is dropped)
and run the verification above.
