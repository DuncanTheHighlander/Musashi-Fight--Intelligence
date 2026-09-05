# Musashi Fight Intelligence — AI / Vision Pipeline Forensic Audit

**Date:** 2026-07-23
**Auditor:** Claude (forensic read-only audit — no production code changed)
**Repo:** `C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package`
**Branch:** `main` @ `7e9cbaf` ("fix(teach): wire one-shot Dictate on Teach panels"), **5 commits ahead of `origin/main`**, 19 modified + 10 untracked files in the working tree.

Evidence classes used throughout:
- **[RUNTIME]** — confirmed by reading the code that executes.
- **[DOC]** — a claim in docs/comments, not independently verified.
- **[DEAD]** — code that exists but is never invoked.
- **[FALLBACK]** — code that only runs on a failure path.
- **[UNVERIFIED]** — cannot be established from the repository alone.
- **[CONCLUSION]** — the auditor's technical judgment.

---

## 1. Executive summary

Musashi currently runs **two parallel AI analysis pipelines per uploaded clip** plus a **three-tier pose stack**, and the product's most visible failures all trace to four structural facts:

1. **Fighter selection has no person detector and no fighter/non-fighter concept.** The cloud pipeline (`cloud/pose_pipeline.py`) seeds "the two fighters" from full-frame single-person MediaPipe detection: whoever MediaPipe finds first (usually the *largest/nearest* human — a foreground spectator, referee, or cameraman) becomes a permanent tracking box (`prev_boxes` persistence, capped at 2). RTMPose then faithfully refines the *wrong* person. A ranking function that would fix this (`suggestFighters` in `src/lib/pose/fighterSelection.ts`) exists, is tested, and is **wired nowhere** [DEAD].

2. **The pose data that feeds coaching is not the pose data on screen.** The RTMPose cloud dense track drives the *playback overlay*, but the FightLang/Coach-Card buffer (`fightLangPoseFramesRef`) is only filled by `onPose` events — which the dense pass and pre-scan deliberately never emit (`FightAnalyzer.tsx:1462-1482`). At boot (playback still locked), Coach Cards for striking sports are generated from a handful of one-shot **MediaPipe** seek detections in a 30-second rolling buffer. This single fact explains "MediaPipe appears in the UI although RTMPose is primary," "not enough pose frames despite 384 processed frames," and "N frames but 0 events." The claim in `docs/POSE_ENGINE_PRIORITY.md` ("dense track feeds playback overlay AND the FightLang pose buffer") is **false at boot-time** [DOC vs RUNTIME].

3. **Gemini already sees the tape and is the strongest component — but it is subordinated to pose.** Every Coach-Card call attaches the normalized video (inline <20 MB or Files API), runs a Flash vision scan + a Flash verification pass, and then a Pro coaching call — yet for striking sports the prompt still declares the pose-derived FightLang ledger "the ONLY source of truth," and a pose shortfall (<4 frames) blocks the whole card path client-side before Gemini is even asked.

4. **Teach Musashi is admin-only and never verifies compliance.** Structuring and approval both require the `shogun` role; approval additionally requires the approver to *be the owner* — so no regular user's correction can ever become active. The "Corrections applied" toast fires because rows were *fetched*, not because the final output *obeys* them; no post-generation conflict check exists.

The system's real, defensible assets are: the normalize-on-Modal ingestion chain, the Gemini vision/verify/coach stack with sport-aware FPS + LOW media resolution, the sport brains, the vision-first path already proven for BJJ/wrestling/judo, and the honesty gates (no-fake-coaching, empty-evidence chat gate). The pose stack is the weakest link and currently has *veto power* over the strongest link.

---

## 2. Current architecture

### Pipeline diagram (uploaded clip, as actually executed)

```
Android WebView / browser (FightCoachExperience.tsx)
 │ 1. file pick → runBootPipeline()                 [RUNTIME] FCE:3016
 │ 2. sport + clip-type picker (localStorage musashiSelectedSport/ClipType)
 │ 3. focus fighter toggle (A/B/both/unsure; tap-override via pickByClick FCE:5233)
 ├─▶ R2 original upload  uploadMarketplaceFile(purpose:'analysis_clip')
 │      src/lib/storage/uploadClient.ts → /api/upload-ticket → direct R2 (or Worker proxy ≤90MB)
 ├─▶ POST /api/fight {action:'upload_video', assetId, sourceStartSec, requestedDurationSec}
 │      route.ts:3534   reserveVideoAnalysisCredit → readUploadedAssetStream(R2)
 │      └─▶ Modal normalizer (MUSASHI_VIDEO_NORMALIZER_URL, cloud/modal_app.py:296)
 │            ffmpeg: -ss start -t maxSec, scale='min(1280,iw)':-2, fps=30,
 │            libx264 veryfast CRF23, AAC 128k, +faststart          [RUNTIME]
 │      └─▶ storeNormalizedAnalysisAsset (R2, D1 asset row)
 │      └─▶ <20MB: inlineEligible=true (background Gemini Files upload, non-blocking)
 │          ≥20MB: handleVideoUpload → Gemini Files API → fileUri (ACTIVE poll)
 ├─▶ (parallel at boot) FightAnalyzer dense pass
 │      cloud RTMPose primary: fetchCloudDenseTrack → /api/fight/cloud-pose
 │        → Modal GPU/CPU (pose_pipeline.py: MediaPipe seed boxes + RTMPose refine)
 │        → identityReplayCore → A/B DenseTrack → quality gate (cloudTrackUsable)
 │      fallback: IndexedDB cache → full local MediaPipe dense pass   [FALLBACK]
 │      dense track drives PLAYBACK OVERLAY ONLY at this stage        [RUNTIME]
 ├─▶ (parallel at boot) TWO Gemini pipelines:
 │    A. runInitialClipAnalysis → POST /api/fight {action:'chat', analysisStyle:'comet'}
 │        Flash scan → Flash evidence ledger → Pro deep analysis (3 Gemini calls)
 │    B. analyzeFightLangWindow → POST /api/fight/analyze
 │        compileFightLang(poseFrames from 30s MediaPipe buffer)
 │        → buildVisionLedger (Flash + video) → verifyVisionLedger (Flash + video)
 │        → generateGroundedCoaching (Pro + video + coach brain + retrieval
 │           + approved Teach corrections) → validateCoachingPayloadAgainstLedger
 │        → saveAnalysisLedger (D1 analysis_ledgers) + pose snapshot
 └─▶ UI: Play + Coach Cards + ratings unlock together ("all-at-once" gate)
        chat context: fileUri / normalizedAssetId + ledger + kinematics
```

### Stage table (Task 1)

| # | Stage | File / route | Blocking? | Timeout | Retry | Persists | Failure surface |
|---|---|---|---|---|---|---|---|
| 1 | File pick + trim window | `FightCoachExperience.tsx` (`requestVideoPick`, `VideoTrimmer`) | yes | — | user | — | toast |
| 2 | Sport/ruleset pick | FCE `pickSport`/`pickClipType` → localStorage | yes (dialog) | — | — | localStorage | — |
| 3 | Focus fighter | FCE `focusTarget` state; tap map `pickByClick` FCE:5233 | no | — | — | component state | — |
| 4 | Upload ticket + R2 PUT | `/api/upload-ticket`, `src/lib/storage/uploadClient.ts` | yes | fetch default | no auto-retry | R2 `musashi-uploads`, D1 asset row | `ORIGINAL_UPLOAD_FAILED` |
| 5 | Credit reserve | `reserveVideoAnalysisCredit` (route.ts:3586) | yes | — | — | D1 | 402 `FREE_VIDEO_QUOTA`/`WEEKLY_VIDEO_QUOTA` |
| 6 | Modal normalize | `normalizeVideoOnServer` (`videoIngestion.ts:105`) | yes | 280 s client-side abort; ffmpeg 780 s | no | temp files on Modal | `SERVER_PROCESSING_*` (502) |
| 7 | Normalized store | `storeNormalizedAnalysisAsset` (`storage/assets.ts`) | yes | — | no | R2 + D1 | `NORMALIZED_STORAGE_*` |
| 8 | Gemini Files upload | `handleVideoUpload` (`services/videoUpload.ts`) | only ≥20 MB | ACTIVE poll | no | Gemini Files (48 h TTL) | `GEMINI_UPLOAD_FAILED` / `GEMINI_PROCESSING_TIMEOUT` |
| 9 | Cloud pose dense pass | `cloudPose.ts` → `/api/fight/cloud-pose/route.ts` → Modal | **no** (overlay quality only) | 300 s client / 290 s proxy | GPU→CPU fallback once | IndexedDB dense-track cache | console warn only; silent local fallback |
| 10 | Local MediaPipe passes | `FightAnalyzer.tsx` (sparse pre-scan 24 seeks; dense fallback ≤1800 samples) | pre-scan gates "Ready" | 90 s stall watchdog | no | IndexedDB | boot warnings |
| 11 | FightLang compile | `/api/fight/analyze` → `compiler/fightlang.compiler.ts` | yes for striking | 60 s route max | no | — | 400 "Provide poseFrames" |
| 12 | Vision scan+verify | `evidence/verifyEvidenceLedger.ts` | grappling: yes; striking: no [FALLBACK to ledger-only] | 35 s / 40 s | 1 emergency re-prompt | — | 502 (vision-first only) |
| 13 | Grounded coaching | `gemini-client.ts generateGroundedCoaching` | yes | fetch (no explicit) ×3 retries on 429/503 | Pro→Flash cascade | LRU cache | `llm_unavailable` issue, coaching=null |
| 14 | Card validation | `validators/llm-output.validator.ts` | soft (sanitizes) | — | — | — | `llmIssues[]` |
| 15 | Ledger persist | `saveAnalysisLedger` (`ledgerStore.ts`) | no (non-fatal) | — | — | D1 `analysis_ledgers` | console warn |
| 16 | Chat | `/api/fight {action:'chat'}` (route.ts:1166) | n/a | 30 s/20 s sub-calls | model fallback chain | — | error message in chat |
| 17 | Teach retrieval | `aiCorrections/store.ts fetchApprovedCorrectionsForClip` (analyze:528) | no (non-fatal) | — | — | D1 `ai_corrections` | console warn |
| 18 | Reanalysis | FCE "Reanalyze with corrections" → `analyzeFightLangWindow({mode:'full'})` | — | as #11-14 | — | — | same as analyze |

---

## 3. Actual runtime pose engine (Task 2)

### Engine table

| Engine | Purpose | Runtime | Primary/fallback | Gating power | Actual usage |
|---|---|---|---|---|---|
| **MediaPipe tasks-vision** (pose_landmarker heavy/full, WASM from jsdelivr CDN, models from GCS — `FightAnalyzer.tsx:129-133`) | Live skeleton, boot pre-scan, dense fallback, seek detections, **all boot-time FightLang frames** | Browser | Officially "fallback" — **in practice primary for coaching input** | Fills the only buffer the <4-frame Coach-Card gate reads | **Every clip** [RUNTIME] |
| **RTMPose cloud** (Halpe-26 ONNX on Modal GPU/CPU; `cloud/pose_pipeline.py`) | Dense replay track for the playback overlay | Modal via `/api/fight/cloud-pose` proxy | Primary (default ON: `NEXT_PUBLIC_POSE_PRIMARY_ENGINE` unset ⇒ `'rtmpose'`, `cloudPose.ts:55`) | None over Coach Cards at boot; quality gate can *reject itself* | Every clip **when proxy configured**; silent skip otherwise |
| **MediaPipe cloud** (`mode=mediapipe` on Modal) | Benchmarking | Modal | Opt-in (`?poseCloudMode=mediapipe`) | — | QA only |
| **RTMPose local** (onnxruntime-web, `public/models/rtmpose-halpe26.onnx`, `pose/rtmposeBackend.ts`) | On-device refine inside dense pass | Browser (WebGPU) | Opt-in flag `?poseBackend=rtmpose` | — | QA only [FALLBACK] |
| RTMO / YOLO / ByteTrack / DeepSORT / SAM | — | — | — | — | **Absent from the codebase entirely** [RUNTIME] |

### Definitive answers

1. **Browser runs:** MediaPipe (always), optional local RTMPose refine (flag).
2. **Cloud runs:** MediaPipe-seeded box finding + RTMPose refinement per frame on Modal; plus the FFmpeg normalizer on the same Modal app.
3. **Visible skeleton:** during playback, `replayDenseFrame` (FightAnalyzer:1552) replays the cached dense track (cloud RTMPose when accepted) → `FightOverlay`. Gaps in the track and pre-play scrubs fall through to live MediaPipe.
4. **Data used by FightLang:** `fightLangPoseFramesRef` (FCE:578) — 10 Hz-bucketed, 30-second rolling buffer fed **only** by `onPose`. Dense-pass frames (`FightAnalyzer:1462-1468`) and pre-scan frames (`:1479-1482`) return **before** `onPose` fires. So at boot-time Coach-Card generation the buffer holds only single-shot **MediaPipe** detections from `handleSeeked` (FightAnalyzer:2191). During playback, dense-track (RTMPose) frames do flow in — but the first analyze call has already happened.
5. **When RTMPose succeeds:** overlay uses it; coaching input still does not (at boot).
6. **When RTMPose fails / quality-gated:** IndexedDB cache → full local MediaPipe dense pass (minutes) [FALLBACK].
7. **When endpoint missing:** `cloudPoseConfigured()` GET preflight caches `false` for the session; local pass runs; **only a console.log tells anyone** (`FightAnalyzer:1902`).
8. **Both engines per clip:** yes, routinely (MediaPipe live/pre-scan + RTMPose dense).
9. **Can MediaPipe overwrite RTMPose results?** Yes — three ways: quality-gate rejection (`cloudTrackUsable`, coverage <0.5), dense-track gaps during playback (live fallback per frame, `replayDenseFrame:1599`), and the boot-time buffer issue above.
10. **Can spectator poses enter FightLang?** Yes — nothing anywhere excludes non-fighters (see §5).
11. **Can pose failure block Coach Cards?** Striking: yes, twice — client gate `slice.length < 4` (FCE:1869) and boot gate (FCE:3359 → "Pose mapping did not produce enough frames…"); server 400 `'Provide poseFrames or poseTimeline.'` (analyze:262). Vision-first sports: no.
12. **Is the deployed build configured for RTMPose?** The *default* is RTMPose (env var unset ⇒ 'rtmpose'). But the proxy needs `MUSASHI_POSE_CLOUD_{GPU_URL,CPU_URL,TOKEN}` which are **not in `wrangler.bundle.toml` [vars]** — they must exist as Worker secrets (`DEPLOYMENT.md:59-61` documents `wrangler secret put`; `docs/STATUS.md:45` *claims* they are set [DOC]). Additionally, `readSecretEnv` reads **`process.env` only** (`env.ts:50`), not the Secrets Store bindings, and the Worker's `compatibility_date = "2024-09-23"` predates automatic `process.env` population — whether OpenNext bridges these on the deployed Worker is **[UNVERIFIED]**. Check live with `GET https://<app>/api/fight/cloud-pose` (returns `configured:{gpu,cpu,token}`). **[CONCLUSION]** If any flag is false in production, every production clip silently uses local MediaPipe — matching the reported symptom exactly.

Also note: `localStorage.musashiPoseBackend` sticks across sessions (`cloudPose.ts:51`) — one QA session that set `local`/`rtmpose` permanently disables the cloud engine on that device with no UI indication.

---

## 4. Actual Gemini usage (Task 4)

All calls are raw REST `v1beta …:generateContent` with the API key in the query string. No SDK, no Interactions API, no system-level streaming SDK. Key resolution: Secrets Store `SECRET_AI` → `GEMINI_API_KEY` (`cloudflare/secrets.ts`).

| Call | File | Model (default) | Video? | Params | Notes |
|---|---|---|---|---|---|
| Grounded coaching (Coach Cards) | `gemini-client.ts:480-559` | `gemini-3.1-pro-preview` → cascade `gemini-2.5-flash` on 429/503 | inline <20 MB or fileUri; `videoMetadata` fps 10/5 + start/endOffset; `mediaResolution: MEDIA_RESOLUTION_LOW` (global) | temp 0.25, topP 0.9, topK 40, max 8192, `thinkingLevel:'LOW'` (3.x) / `thinkingBudget:0` (2.5) | prompt = contract + sport brain + retrieval + corrections + ledger JSON, all as ONE user part (no systemInstruction) |
| Vision flash scan | `verifyEvidenceLedger.ts:53-121` | `gemini-2.5-flash` | yes | temp 0.1, JSON, grappling responseSchema | 35 s timeout; emergency re-prompt |
| Vision verification | same, `verifyVisionLedger` | `gemini-2.5-flash` | yes (re-watches) | temp 0.1 | 40 s timeout; failure returns unverified candidate [FALLBACK] |
| Chat flash scan | `fight/route.ts:1512-1570` | `gemini-2.5-flash` | yes | temp 0.3 | skipped for grappling |
| Chat evidence ledger | `route.ts:1592-1678` | flash | yes | temp 0.15, grappling schema | + emergency pass |
| Chat deep analysis | `route.ts:1741-1791` | `GEMINI_MODEL` \|\| `gemini-3.1-pro-preview`; fallbacks `gemini-2.5-flash`, `gemini-2.0-flash` | yes | temp 0.55, max 4096, systemInstruction (with no-system fallback) | + `rewriteCoachingToMatchLedger` repair call (route.ts:738) |
| Teach structuring | `aiCorrections/structure.ts` | flash | no | temp 0.1 via `generateJson` (defaults 0.3/0.95/40) | |
| Embeddings | `ai/gemini-embed.ts`, retrieval | `gemini-embedding-2-preview` | segments | — | segment ingestion fire-and-forget |
| Reflex/track/burst/strategy | `route.ts:1102,2122,…`, `analyze-burst`, `analyze-strategy` | via `resolvedModels` | frames/video | various | secondary features |

### Answers

1. **Does Gemini receive the video?** Yes on every Coach-Card and first-chat pass — normalized H.264 (≤1280-wide, 30 fps), inline (<20 MB) or Files URI. Pose-only analyze calls (`llm:{enabled:false}` compile) do not.
2. **Audio?** Yes — the normalizer keeps AAC audio (`modal_app.py:320-323`) and nothing strips it; per current docs audio costs ~32 tokens/s.
3. **Default 1 FPS?** No — `videoMetadata.fps` is set: 10 striking / 5 grappling (`videoFilePart.ts:53-55`) [RUNTIME].
4. **Sport brain before answer?** Yes — `buildCoachBrainBlock` is inside the coaching prompt (gemini-client.ts:311) and the chat system prompt (route.ts:1317).
5. **Focus fighter?** Yes — `buildCoachingFocusBlock` (A/B/both/unsure) + `applyCoachingFocus` post-filter; chat gets corner_coach/scout/strategist modes.
6. **Teach corrections?** Coach-Card path: yes (`approvedCorrectionsBlock`, analyze:576). **Chat path: no** — `fetchApprovedCorrectionsForClip` is never called from `fight/route.ts` [RUNTIME].
7. **Pose data to Gemini?** Ledger JSON (events/faults/patterns/timeline) yes; raw landmarks no (except summarized `poseEvidence` in chat ledger merge).
8. **Observe + coach in one call?** No — observation is split into Flash scan + Flash verify, then a separate Pro coaching call. But the Pro call *also* has the video, so it can re-observe.
9. **Can Gemini succeed when pose fails?** Server-side yes (vision-first path); **striking clips never reach the server with <4 frames** — the client returns `false` first (FCE:1869) [RUNTIME].
10. **Is successful Gemini vision discarded by pose gating?** Effectively yes for striking: (a) the <4-frame client gate blocks the entire call; (b) `isPoseQualitySpendBlocked` (FCE:741) blocks analyze when the dense-track grade is `request_better_clip` (override button exists); (c) in striking merge, vision may only *remove/annotate* FightLang events, never add (sessionEvidence.ts:156-186) — and the striking flash scan is skipped entirely when FightLang has events (`buildVisionLedger:180`), so Gemini's independent read is never even produced.

### Model / parameter verification against current Google docs

- `gemini-3.1-pro-preview` is a **current, real model** (video input, 1M context) — verified via [Google AI docs](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-pro-preview).
- `temperature`, `top_p`, `top_k` are **not deprecated**, but for Gemini 3 models Google **"strongly recommend[s] keeping the temperature parameter at its default value of 1.0"**; lowering it "may lead to unexpected behavior, such as looping or degraded performance" ([Gemini 3 guide](https://ai.google.dev/gemini-api/docs/gemini-3)). The coaching call pins **0.25/0.9/40** on a Gemini 3 model — an active anti-pattern per official guidance [CONCLUSION].
- `mediaResolution: MEDIA_RESOLUTION_LOW` = 66 tokens/frame (vs 258 default) — a deliberate, valid cost optimization; the comment about per-Part `media_resolution` 400-ing on v1beta is accurate ([video docs](https://ai.google.dev/gemini-api/docs/video-understanding)).
- `thinkingLevel: 'LOW'` is a valid Gemini 3 value ("minimal" is *not* supported on 3.1 Pro — the code correctly avoids it).

---

## 5. Fighter identity system — why spectators get skeletons (Task 3)

**What the system actually uses:** MediaPipe full-frame single-person detection as the candidate generator, pose-derived bounding boxes, torso-color profiles, scale, velocity/Kalman prediction, a crossing/pair-lock state machine, and **positional seeding** of A/B. It does **not** use: a real multi-person detector, cage/ring boundary detection, referee/spectator exclusion, clothing-prior confirmation, or user confirmation of who the fighters are at detection time.

### The exact failure chain [RUNTIME]

1. `pose_pipeline.py:186` — `self.full.process(rgb)`: MediaPipe `Pose` returns **one** pose per frame — biased toward the largest, most-camera-facing person. In the 22458-style scene (vertical phone video, cage in background, big foreground spectator/cameraman), that is the spectator.
2. `:190` — the detected person is masked and detection retried once (`_mask_person` → `self.retry`, confidence 0.12) — the second "fighter" can be the referee or another bystander.
3. `:194-199` — `boxes = list(prev_boxes)` then new seeds only append if <55% overlap, capped at `boxes[:2]`. **Once a spectator owns a box, it owns it for the rest of the clip** — real fighters can never displace it.
4. `:214-222` — RTMPose refines *inside those boxes*, producing high-quality skeletons of the wrong people.
5. `identityReplayCore.ts` — `assignFighterTracks(..., {allowSpatialSeed: !identitySeeded})` maps whatever two candidates arrive onto A and B by position; profiles then *learn the spectator's colors*, making the lock stickier.
6. `FightCoachExperience.tsx:487` — `CORNER_FOR_FIGHTER = { A: 'blue', B: 'red' }`: the spectator is now "Blue".
7. Quality gating cannot catch it: `assessDenseTrackQuality` measures coverage and joint visibility, **not identity** — a perfectly tracked spectator grades "high".
8. `compileFightLang` then emits stance/guard/faults for the spectator; for striking, these enter the "single source of truth" ledger.

The same class of failure exists in the local MediaPipe path (same crop-seeded design, `FightAnalyzer` pre-scan labels "fighters positionally", comment at :1985).

**Earliest stage where this should be prevented:** candidate generation on Modal (step 1-3) — a person detector + fighter ranking (size/centrality/motion, i.e. exactly `suggestFighters`' scoring) or Gemini-driven identification, *before* boxes persist. Everything downstream is identity-agnostic and would inherit the fix.

**Unwired mitigation [DEAD]:** `suggestFighters` (`fighterSelection.ts:65`) implements the ranking and is imported nowhere; only `pickByClick` is used (FCE:5233) and only to map a user tap to a *focus* choice among already-tracked candidates.

**Blue/Red vs A/B inconsistency:** A=blue/B=red is hard-coded client-side (FCE:487); the chat prompt says "Fighter A / blue corner" (route.ts:1263); vision-first mode instead defines "A = LEFT of screen, B = RIGHT" (gemini-client.ts:61); Teach structuring accepts `A|B|Blue|Red` as distinct values (structure.ts:79-85). Nothing reconciles "left/right" with "blue/red" with tracker A/B — three naming systems coexist [CONCLUSION].

---

## 6. Sport-brain integration (Task 5)

- **Source:** `coach-brain/*.md` + `coach-brain/sports/{boxing,kickboxing_muay_thai,karate,taekwondo,wrestling,judo,bjj_grappling,fencing,mma}.md` (9 sports; ruleset variants do not exist beyond clip-type guidance).
- **Generation:** `pnpm gen:coach-brain` → `src/lib/coachBrain/brains.generated.ts` (checked in).
- **Loading/routing:** `resolveSportKey` alias map (`coachBrain.ts:33`) — `bjj→bjj_grappling`, `tkd→taekwondo`, etc. Unknown sports fall back to global rules with an explicit note.
- **Placement:** appended **prompt text**, not `systemInstruction`, in both the Coach-Card prompt (before the ledger JSON) and the chat system prompt. It is instructed to sit "on top of the evidence contract, never against it".
- **Delivery:** reaches `generateGroundedCoaching` and `handleChat`; the flash scan/verify passes do *not* get the brain (they use sport only for FPS).
- **Cross-sport leakage:** the selected sport persists in `localStorage.musashiSelectedSport` across sessions/clips (FCE:747) — a user who analyzed BJJ yesterday and uploads boxing today gets the BJJ brain, the grappling evidence override, 5 fps sampling, and the vision-first boot path unless they re-pick. The prompt's "if the video clearly shows a different sport, warn" line is the only guard [RUNTIME].
- **Value assessment [CONCLUSION]:** the brains are model-agnostic coaching knowledge with no pose dependency — fully reusable in a vision-first system. `isVisionFirstSport` (BJJ/wrestling/judo) is already the seam a vision-first migration would widen.

---

## 7. FightLang role (Task 6)

- **Input:** client-posted `poseFrames` (the 30 s MediaPipe buffer, §3.4), optional client `kinematics`, optional `pose3DFrames`.
- **Events:** strikes are detected **only inside exchange windows** and only from kinematics bursts (`handBurstBwps ≥ 1.2 bw/s`, compiler:185-219). Kinematics are only *sent* when the client collected ≥4 snapshots (FCE:1968) — and kinematics are produced by `onKinematics`, which fires during **playback**. At boot-time analysis there are usually no kinematics ⇒ no exchange windows ⇒ **zero events and structural faults suppressed** (`suppressionStats`).
- **"Many frames, zero events" [RUNTIME]:** frames counted in `pipelineStats.poseFrames` are geometry samples; events require kinematics + exchange windows the boot flow structurally cannot supply.
- **"Callouts with zero events":** overlay callouts merge compiler annotations **plus Gemini's `overlayAnnotations`** (analyze:648) — the LLM can (and is prompted to, gemini-client.ts:368) emit 2-4 annotations even when the ledger is empty.
- **Fighter grounding:** none beyond tracker A/B — contaminated spectator tracks flow straight into stance/guard/fault claims (§5).
- **Should it remain authoritative? [CONCLUSION]** No. For striking it is declared "the ONLY source of truth" while being the least reliable input in the chain (wrong-identity risk, boot-time starvation, kinematics dependency). Grappling mode already demotes it (striking artifacts stripped, sessionEvidence.ts:74). Useful survivors: the exchange-window concept, kinematics summaries as *qualitative* grounding, the evidence-ID discipline, and the suppression/honesty statistics.

---

## 8. Teach Musashi role (Task 8)

**Flow [RUNTIME]:** Teach button (card or chat; stable chat message IDs via `newChatMessageId`) → `POST /api/fight/teach-correction/structure` (Flash structuring, clarification loop, draft insert + fingerprint) → preview → `POST …/approve` → `status='approved'` → at analyze time `fetchApprovedCorrectionsForClip` (owner + sport + clipId OR fingerprint + window overlap) → `formatApprovedCorrectionsBlock` appended beside retrieval in the coaching prompt.

Answers:
1. **Reaches Gemini before answering?** Coach-Card/reanalyze path: yes. **Chat path: never** [RUNTIME].
2. **Matched by owner?** Yes (`owner_user_id = ?`).
3. **By sport?** Yes — exact string equality on the resolved sport key; both save and fetch run `resolveSportKey` first, so aliases are safe.
4. **By time window?** Yes — overlap test, whole-clip and no-timestamp rows always match (store.ts:258-264).
5. **Survives ledger-save failure?** Yes — corrections are independent of `analysis_ledgers`.
6. **Reupload matching?** Partial. `clip_id` changes on re-upload; fallback is the fingerprint `sha256(size|durationMs|first1MB|last1MB)`. But Teach fingerprints the asset passed as `clipId` (often the **original** asset) while analyze fingerprints `normalizedAssetId` **preferentially** (analyze:510) — original vs normalized bytes differ, so cross-object fingerprints will not match; re-normalization of the same source is also not guaranteed byte-identical [CONCLUSION: fragile].
7. **Leak between users?** No — strictly owner-scoped.
8. **Does reanalysis restore expired Gemini files from R2?** No dedicated recovery. <20 MB clips are re-read from R2 as inline bytes each call (immune to Files-API expiry). ≥20 MB clips with an expired `fileUri` fail the coaching call; the only "recovery" is the user re-running upload.
9. **Final output checked for conflicts?** **No.** `validateCoachingPayloadAgainstLedger` checks evidence IDs and fake precision, nothing about corrections.
10. **Can the app claim "correction applied" while outputting the rejected label?** **Yes — by construction.** `correctionsAppliedSummary` is set the moment rows are fetched (analyze:540), before Gemini responds; the toast "Corrections applied" (FCE:2049) therefore proves retrieval, not compliance.

**Critical gate [RUNTIME]:** both `structure` and `approve` routes `requireUser(request, {role:'shogun'})`, and approve additionally requires `before.ownerUserId === user.id`. The panel itself is labeled "Shogun-only Teach panel" (TeachCorrectionPanel.tsx:137). **Teach Musashi is currently an admin-personal feature; no regular user's corrections can ever exist or be applied.**

---

## 9. Coach Card gating — the decision tree (Task 7)

```
Coach Cards render ⇔ setCoachReady(true) ∧ hasUsableCoachCards(json.coaching)

analyzeFightLangWindow returns false (no cards) when:
├─ poseQuality == 'request_better_clip' ∧ not vision-first ∧ no override   (FCE:1810)
├─ striking ∧ filtered slice < 4 pose frames                               (FCE:1869)
├─ vision-first ∧ tape upload failed / still uploading                     (FCE:1859,1871)
├─ aiGuard: 401 auth / 402 quota / 429 rate / 403 CONSENT_REQUIRED
│           / 403 EMAIL_NOT_VERIFIED / 503 AI_KILL_SWITCH                  (FCE:2013-2026)
├─ server 400 'Provide poseFrames or poseTimeline.'                        (analyze:262)
├─ server 502 'Vision analysis failed' / 'no usable ledger' (vision-first) (analyze:379,392)
├─ generateGroundedCoaching threw → coaching=null → hasUsableCoachCards
│  fails → throw 'Coach Cards response was incomplete'                     (FCE:2043)
└─ network failure → fetch throws → toast 'Analysis failed: Failed to fetch'

Boot pipeline additionally soft-fails (Play unlocked, no cards) on:
├─ 90 s vision watchdog (vision-first)                                     (FCE:3081)
├─ tape upload failure / quota                                             (FCE:3091,3340)
├─ fightLangPoseFrames < 4 after 30 s wait →
│  'Pose mapping did not produce enough frames for Coach Cards'            (FCE:3359)
└─ !coachCardsReady from the parallel await                                (FCE:3146,3372)
```

**Wrong-stage error reporting [RUNTIME]:**
- Any **network** failure of `/api/fight/analyze` surfaces as `coach_cards_incomplete` / "Analysis failed" — indistinguishable from a pose or model failure.
- "Mapping fighters (MediaPipe pose)…" (FCE:3253) is displayed even when the dense pass that is actually running is cloud RTMPose.
- The FCE:3359 message blames "pose mapping" when the true cause is architectural: dense/pre-scan frames are never routed to the FightLang buffer (§3.4), so the count it checks measures the wrong thing.
- Three status channels run concurrently (`bootPipelineMessage`, `initialAnalysisStatus`, `ingestionStage` → `ingestionStatusText`, plus `streamAnalysisPhase`) and are rendered in different corners (e.g. FCE:5568) — "conflicting status messages" is the direct product.
- "Preparing forever": the vision-first watchdog covers upload+AI (90 s), but the striking path's `Promise.all` (FCE:3367) has **no timeout** — a hung Gemini call holds "Preparing your coach…" until the fetch dies.

---

## 10. Video quality and FPS (Task 9)

| Property | Value | Source |
|---|---|---|
| Normalized output | width `min(1280, iw)` (height auto/-2), 30 fps, H.264 veryfast CRF 23, AAC 128k, +faststart | `modal_app.py:296-327` |
| 4K landscape | → 1280×720 | ffmpeg scale |
| Vertical 1080×1920 | **stays 1080×1920** (width already ≤1280) — vertical phone video is *not* downscaled | scale expression [RUNTIME] |
| Max duration | server tier (`resolveVideoTierLimits`; athlete's shorter trim honored, never lengthened) | route.ts:3577-3585 |
| Original | kept in R2 (`analysis_clip` asset), 500 MB cap | `videoFilePart.ts:29` |
| Gemini receives | the normalized file (never the 4K original), at `MEDIA_RESOLUTION_LOW` (66 tok/frame) | analyze / chat parts |
| Gemini sampling | **10 fps striking / 5 fps grappling** via `videoMetadata.fps`; explicit override param exists | `videoFilePart.ts:195-199` |
| Audio | kept and sent (~32 tok/s) | modal_app + docs |

**Cost math** (per current Google docs): at LOW resolution ≈ `fps × 66 + 32` tokens/s → striking ≈ ~690 tok/s (~20.7k tokens for 30 s); grappling ≈ ~360 tok/s (~11k for 30 s). Each boot currently runs **up to 6 video-bearing Gemini calls** (chat: scan+ledger+deep; analyze: scan+verify+coach) → roughly 60–120k video tokens per clip before the user asks a single question [CONCLUSION].

**Can fast striking be missed?** At 10 fps a 6-frame jab (~100 ms at 60 fps reality, ~3 frames at the normalized 30 fps) appears in ~1 sampled frame at LOW detail — genuinely marginal. Different sports plausibly need different fps (the mechanism already exists); raising striking fps trades linearly into tokens/latency. The right knob order is: fps ↑ for striking bursts, resolution stays LOW; grappling at 5 fps is defensible.

---

## 11. Known regression clip 22458.mp4 (Task 10)

`22458.mp4` is **not present** in the repository (`public/test-videos/` holds clip2-overlap.mp4, slowmo-slip.mp4, test-video-for-app.mp4 + manifest). Per instruction, no results are fabricated. From code paths alone, the expected behavior of such a clip (vertical, cage, foreground spectator, referee, cameraman, occlusion):

- Modal seeding picks the foreground spectator first (§5 chain), likely the cameraman/referee second; `prev_boxes` locks them; skeletons render on non-fighters with *high* quality grades.
- FightLang emits stance/guard data for those people; striking mode treats it as truth.
- Raw Gemini (the chat deep pass and the flash scan) sees the actual fighters because it watches pixels, not tracks — which is exactly why "Gemini appears to understand the clip better than the pose-heavy pipeline."
- Coach Cards may still fail on the <4-frame gate if the boot buffer starves (§3.4), independent of the 384-frame dense track.

To run the comparison when the file is available: load it in Fight Lab with `?poseBackend=cloud` vs `?poseBackend=local`, capture `window.__denseTrack`, and POST it directly to `/api/fight/cloud-pose` with `mode=rtmpose|mediapipe` (cloud/README.md flow).

---

## 12–14. Component verdicts

**Valuable components to preserve (§12)**
- Ingestion chain: ticket → direct R2 → Modal FFmpeg normalize → normalized asset + inline-bytes fast path (<20 MB) — deterministic, well-error-coded (`IngestionFailureCode` taxonomy), quota-safe (reserve/commit/release).
- Gemini stack: `videoFilePart.ts` (fps/window/mediaResolution discipline), model cascade + retry, coaching LRU cache, DRY_RUN/OFFLINE modes, honesty gates (no fake coaching, empty-evidence chat gate at route.ts:1452-1470).
- Coach brains + clip-type guidance + recurring-faults memory.
- Vision-first path (BJJ/wrestling/judo) — the working prototype of the target architecture.
- Grappling vision ledger with strict response schema + verification pass.
- Teach data model (owner/sport/window/fingerprint schema, audit records) — the *matching and prompt-injection* layer is sound even though activation is gated wrong.
- `identityReplayCore` as a deterministic, testable replayer (whatever produces candidates).
- Quality assessment vocabulary (`safe_to_analyze` / `analyze_with_caution` / `request_better_clip`) threaded into prompt caution.

**Components whose authority or placement should change (§13)**
- FightLang: from "ONLY source of truth" (striking) to corroborating signal everywhere — grappling mode already shows the pattern.
- Pose gates over Coach Cards: `<4 frames` client gate, server 400, `isPoseQualitySpendBlocked` — Gemini-with-tape should always be sufficient to coach.
- Fighter identity: selection must move to the earliest cloud stage (detector + `suggestFighters`-style ranking, or Gemini-assigned identities), with user confirmation of "which one is you" as first-class input.
- Boot-time data flow: either feed the accepted dense track into the FightLang buffer (`denseTrackToPoseFrames` already exists and is used for the 3D path only) or stop gating cards on that buffer.
- Status reporting: one pipeline-stage state machine (ingest / pose / vision / coach) instead of four overlapping message channels; distinguish network vs pose vs model failures.
- Teach: approval flow for non-admin owners (or auto-approve own corrections with admin review of `gold`), correction injection into **chat**, and a post-generation compliance check before claiming "applied".
- Gemini params: drop pinned temperature/topK on Gemini 3 calls per official guidance.

**Components that appear unnecessary (§14)**
- Duplicate boot pipelines: `runInitialClipAnalysis` (comet chat, 3 Gemini calls) *and* `analyzeFightLangWindow` (3 more) both watch the same tape at boot — one grounded pipeline should feed both card and chat surfaces.
- `rtmpose-local` browser ONNX path and `mediapipe-cloud` mode — QA-only flags shipping in the product bundle.
- Striking flash-scan skip logic (`fightLangCandidate` shortcut) — once vision leads, the "convert FightLang to a pretend vision ledger" step disappears.
- `pose3d` lift path (query-flag gated, sparsely used) — defer.
- The 24-seek sparse pre-scan — its outputs (positional labels, profile poisoning risk noted in code comments) are reset before the dense pass anyway; its only real job now is progress UX.

---

## 15. Security / privacy risks

- **API key in URL query string** on every Gemini call (`?key=…`) — keys can land in proxy/edge logs; header `x-goog-api-key` is the safer documented form [CONCLUSION].
- `isValidFileUri` (route.ts:1483) accepts **any** `https://` URI — a crafted chat `context.videoFileUri` makes the server instruct Gemini to fetch arbitrary URLs; combine with `urlAllowlist.ts` conventions instead.
- Uploaded fight video (biometric-adjacent) flows to Modal (normalizer + pose) and Google (Files API, 48 h retention) — consent gate exists (`CONSENT_REQUIRED`), but the privacy docs should name both processors.
- Teach `structure` accepts arbitrary `clipId` for fingerprinting; it does check ownership via `getReadableAsset(userId, isAdmin:true)` — admin-only today, revisit before opening to users.
- `MediaPipe WASM + models from third-party CDNs` (jsdelivr / GCS) — availability and supply-chain exposure in the browser at runtime.

## 16. Cost / latency risks

- Up to ~6 video-bearing Gemini calls per clip boot (§10) — the single biggest cost lever.
- Fire-and-forget segment embedding per analyze (`embedAndStoreSegments`) adds embedding cost on every fileUri pass.
- Cloud pose upload re-sends the whole clip bytes to the proxy (multipart) even though the normalized asset already sits in R2 — double transfer; Modal could pull from R2 instead.
- Local MediaPipe dense fallback costs minutes of client CPU on phones — worst on exactly the devices the cloud path was built for; when the proxy is unconfigured this is the *silent default*.
- `maxDuration = 60` on `/api/fight/analyze` vs three sequential Gemini calls with 35 s + 40 s sub-timeouts — the route can exceed its own platform budget on slow days.

---

## 17. Recommended vision-first architecture

```
upload → normalize (unchanged) → ONE evidence pass:
  Gemini (video, sport brain, focus, corrections) produces
    - fighter identification (visual descriptions + screen positions,
      confirmed/adjusted by user tap once, reused for the clip)
    - timeline ledger (positions/techniques/exchanges) via responseSchema
    - verification pass (existing verify step, kept)
  Pose (cloud RTMPose) becomes an OPTIONAL enrichment:
    - overlay skeletons (only after identity is anchored to the
      Gemini/user-confirmed fighters)
    - quantitative kinematics attached to ledger events when quality ≥ medium
  Coach call (existing prompt machinery) reads: vision ledger (primary),
    pose kinematics (corroboration), retrieval, corrections
  Cards + chat share the same evidence object (kill the duplicate comet pass)
Pose failure ⇒ cards still ship, badge says "skeleton unavailable".
```

This is the existing vision-first (BJJ) path promoted to all sports, with pose demoted from gatekeeper to garnish — most of the code already exists.

## 18. Lowest-risk migration plan

1. **Flag:** `NEXT_PUBLIC_VISION_FIRST_ALL=1` — extend `isVisionFirstSport` to return true for all sports under the flag (touches one function; every gate already branches on it).
2. Remove the boot `<4 frames` hard-fail under the flag (soft badge instead).
3. Feed `denseTrackToPoseFrames(acceptedTrack)` into `fightLangPoseFramesRef` on `onDenseTrackReady` (bridges the buffer gap for striking regardless of flag).
4. Wire `suggestFighters` scoring into `pose_pipeline.py` seeding (port the 20-line scorer to Python) + keep `prev_boxes` but allow displacement when a higher-ranked candidate persists for N frames.
5. Consolidate boot to one Gemini pipeline; chat reuses the analyze evidence.
6. Teach: allow owner approval (non-shogun) behind a flag; add corrections to chat context; add a post-generation regex/label check against `incorrect_labels` before emitting `correctionsAppliedSummary`.
7. Status: single `pipelineStage` enum surfaced everywhere; map network errors to their own stage.
8. Only then: parameter cleanup (temperature default) and duplicate-path deletion.

## 19. Tests required before implementation

- Offline replay regression (existing `identityReplay.offline.test.ts` 3-clip envelope) must stay green after any seeding change; add a 4th fixture with a dominant foreground non-fighter (a 22458 stand-in).
- Unit: dense-track → FightLang buffer bridge (frame counts, bucket dedupe, 30 s window behavior).
- Unit: `suggestFighters` seeding in Python (port tests from `fighterSelection.test.ts`).
- Contract test: analyze route with 0 pose frames + tape attached returns cards for every sport under the flag.
- Teach: correction round-trip test asserting the final payload does not contain any `incorrect_labels` value; owner-approval permission matrix.
- Prompt snapshot tests for coach prompt assembly (brain/corrections/ledger ordering).
- Live smoke: `GET /api/fight/cloud-pose` configured-flags check in the deploy checklist (turns the silent MediaPipe fallback into a visible red light).

## 20. Files most likely to change in Phase 2

- `src/lib/coachBrain/coachBrain.ts` (vision-first flag), `src/lib/evidence/sessionEvidence.ts` (merge authority)
- `src/components/fight/FightCoachExperience.tsx` (boot gates, buffer bridge, status machine, duplicate pipeline removal)
- `src/components/video/FightAnalyzer.tsx` (onDenseTrackReady bridge)
- `cloud/pose_pipeline.py` (fighter seeding), `src/lib/pose/fighterSelection.ts` (wire-up)
- `src/app/api/fight/analyze/route.ts` (pose gate, corrections compliance), `src/app/api/fight/route.ts` (chat corrections, comet consolidation)
- `src/lib/gemini/gemini-client.ts` (params, prompt authority), `src/lib/aiCorrections/*` (approval policy, compliance check)
- `src/app/api/fight/teach-correction/{structure,approve}/route.ts` (roles)

---

## KEEP

- R2 → Modal normalize → normalized-asset → inline/Files ingestion chain, with its failure-code taxonomy and quota reserve/commit/release.
- Gemini video part discipline (`videoFilePart.ts`): sport-aware fps, start/end offsets, global `MEDIA_RESOLUTION_LOW`.
- Model cascade + 429/503 retry + coaching cache + DRY_RUN/OFFLINE modes.
- Coach brains (all 9 sports), clip-type guidance, recurring-faults memory.
- Vision-first path (grappling schema, verification pass, screen-identity mapping) — the template for everything else.
- Honesty gates: no-fake-coaching on LLM failure, empty-evidence chat gate, fake-precision softener, no-filler overlay policy.
- Teach data model (owner/sport/fingerprint/window matching, audit trail) and the prompt block format.
- `identityReplayCore` + offline eval harness as the regression safety net.
- Cloud RTMPose infrastructure (proxy, Modal apps, quality grading) — as overlay/kinematics enrichment.

## CHANGE

- Evidence authority: FightLang from "only source of truth" (striking) to corroboration; Gemini vision ledger primary for all sports.
- Coach-Card gating: remove pose-frame and pose-quality vetoes when tape is attached (keep them as badges).
- Fighter identity: detection-stage fighter ranking (wire `suggestFighters` / port to Modal) + one-tap user confirmation; unify A/B ↔ Blue/Red ↔ left/right into one mapping owned by one module.
- Boot data flow: dense track must feed (or replace) the FightLang buffer; never gate on a buffer the pipeline doesn't fill.
- Teach Musashi: owner (non-admin) approval path, chat-path injection, compliance verification before claiming "applied"; fingerprint on a consistent asset (normalized) at save and fetch.
- Status/error UX: single stage machine; network ≠ pose ≠ model failures.
- Gemini 3 call params: temperature to default 1.0, drop topK, per official guidance; move API key to header.
- `isValidFileUri` tightening to Gemini/YouTube origins.

## REMOVE OR DEFER

- The duplicate boot pipeline (comet-style `runInitialClipAnalysis` chat pass) — merge into the analyze evidence pass.
- `rtmpose-local` browser ONNX path and `mediapipe-cloud` benchmarking mode from the product build (keep behind dev flags only).
- `pose3d` lifting path (flag-gated, unconsumed downstream except optional compiler input) — defer.
- The 24-seek sparse pre-scan as an analysis input (keep only if needed for progress UX).
- FightLang striking strike-classification as a coaching source until identity + kinematics are trustworthy (exchange windows and suppression stats can stay as internal QA signals).
- `GEMINI_DEMO_FALLBACK` canned-payload path (already opt-in; delete before launch).

---

### Remaining uncertainties

1. Whether `MUSASHI_POSE_CLOUD_{GPU_URL,CPU_URL,TOKEN}` are actually set on the **deployed** Worker, and whether `readSecretEnv`'s `process.env` reads resolve there given `compatibility_date 2024-09-23` — verify live via `GET /api/fight/cloud-pose`.
2. Whether the deployed Worker build matches local HEAD (local is 5 commits ahead of origin/main with 29 dirty paths; deploy history is not derivable from the repo).
3. Exact production behavior of the boot `≥4 frames` gate on real devices (how many seek-triggered MediaPipe detections typically accumulate) — instrument before relying on §3.4's starvation analysis for sizing the fix.
4. `22458.mp4` comparisons (file absent).
5. Whether re-normalizing an identical source yields byte-identical output (affects fingerprint re-upload matching).
