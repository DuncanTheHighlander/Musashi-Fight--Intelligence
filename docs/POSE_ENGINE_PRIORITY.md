# Pose Engine Priority

**Decision (2026-07-01): RTMPose on Modal is the PRIMARY pose engine for
uploaded clip analysis. MediaPipe stays as live preview, free/local mode, and
automatic fallback.** AI vision (Gemini watching the clip) remains the context
and audit layer; FightLang remains the evidence compiler; the final coach reads
all of it. This layered pipeline — measured pose evidence, symbolic events,
vision audit, grounded coaching — is what makes Musashi more than a generic AI
wrapper around a chat model.

## Why RTMPose won primary (measured, not assumed)

Both engines ran through the identical Modal pipeline + on-device identity
tracker on the 3-clip envelope (`public/test-videos/clips.manifest.json`),
scored with `scripts/jointEval.mjs` and `scripts/trackEval.mjs`:

| metric | clip1 | clip2 (overlap) | clip3 (360p slow-mo, hardest) |
|---|---|---|---|
| exploded frames (RTM vs MP) | 0 vs 1 | 0 vs 2 | **0 vs 18** |
| teleports | 2 vs 0 | 2 vs 11 | **6 vs 74** |
| collapse % | 27 vs 51 | 19 vs 22 | 44 vs 49 |
| jitter p95 (head) | 0.098 vs 0.191 | 0.245 vs 0.416 | **0.178 vs 1.543** |

Cloud MediaPipe **fails** the committed regression gates on clip3; cloud
RTMPose **passes** them. Known trade-off: RTMPose's arm-bone p95 is slightly
above the MediaPipe-tuned gates on clips 1–2 (0.946/1.077 vs 0.9/0.95) —
MediaPipe's "tighter" arms come with double the collapse rate, so this is an
engine characteristic, not a regression.

## Engine roles

| engine | role |
|---|---|
| `rtmpose-cloud` | **Primary** for uploaded/premium analysis. Modal GPU (L4/T4, `cloud/modal_app.py`) with CPU fallback, via the `/api/fight/cloud-pose` proxy. |
| `mediapipe-local` | Live skeleton preview during playback, free/quick mode, and **automatic fallback** when the cloud pass fails, times out, is unconfigured, or returns a track that fails the quality gate. |
| `mediapipe-cloud` | Benchmarking/comparison mode (`?poseCloudMode=mediapipe`). |
| `rtmpose-local` | On-device ONNX refine (`?poseBackend=rtmpose`), QA flag. |

## How the priority is enforced

1. `getCloudPoseOptions()` (`src/lib/cloudPose.ts`) now defaults **ON**
   (`NEXT_PUBLIC_POSE_PRIMARY_ENGINE`, default `rtmpose`). Opt out per session
   with `?poseBackend=local` (or any non-cloud backend value).
2. `cloudPoseConfigured()` preflights the proxy once per session so dev boxes
   without Modal URLs skip the doomed upload and go straight to local.
3. `FightAnalyzer` dense pass order: **cloud RTMPose → local cached track →
   full local MediaPipe pass**. The cloud track must pass the quality gate
   (`cloudTrackUsable` in `src/lib/pose/poseQuality.ts`) or it is rejected in
   favor of the local floor.
4. The accepted track's engine + `PoseQualitySummary` (coverage, both-fighter
   rate, foot/wrist confidence, `safe_to_analyze` /`analyze_with_caution` /
   `request_better_clip`) flow through `onDenseTrackReady` →
   `FightCoachExperience` → the `pose` field of `/api/fight/analyze` → the
   coach-brain prompt block (`src/lib/coachBrain/coachBrain.ts`), which turns
   weak pose data into cautious wording instead of fake certainty.

## Data flow (uploaded clip)

```
upload → boot pre-scan (local MediaPipe, instant preview)
      → cloud RTMPose dense pass (Modal GPU, primary)   ──fail/low quality──▶ local MediaPipe dense pass (fallback)
      → identity replay (identityReplayCore, same for both engines)
      → dense track feeds playback overlay AND the FightLang pose buffer
      → FightLang ledger (events, faults, patterns)
      → Gemini coach: ledger + video (AI vision) + retrieval + coach brain
        + pose engine/quality caution rules
```

Both engines normalize to the same 33-landmark layout inside
`cloud/pose_pipeline.py` / the local pipeline, so everything downstream of the
dense track is engine-agnostic.

## Re-running the comparison

```
node scripts/check-cloud-pose-ready.mjs --online   # endpoint healthy?
# POST each clip with mode=rtmpose / mode=mediapipe (see cloud/README.md),
# replay candidates: REPLAY_CANDS=... REPLAY_OUT=... npx vitest run src/lib/identityReplay.offline.test.ts
node scripts/jointEval.mjs <replay.json ...>
node scripts/trackEval.mjs --compare tracking-eval-2026-06-11/baselines.json clip1=<...> clip2=<...> clip3=<...>
```
