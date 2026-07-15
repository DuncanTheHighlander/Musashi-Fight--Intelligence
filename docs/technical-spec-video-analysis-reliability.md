# Video Analysis Reliability and Free-Credit Enforcement

## Status

Proposed implementation specification. This document is based on the production
failure reproduced on 2026-07-10: a 32.9-second MP4 was trimmed to 10.02 seconds,
then the player was unavailable for roughly 4.5 minutes while local pose tracking
processed 303 frames.

## Product decisions

1. A Free account receives **three successful AI video-analysis credits** over its
   lifetime. A credit means a user starts an AI analysis session for a distinct
   clip; it does not mean that they selected, trimmed, previewed, or locally pose
   tracked a file.
2. A failed trim, failed R2 upload, failed Gemini upload, or failed AI-analysis
   start must not consume a credit.
3. A clip can play as soon as metadata and a decodable first frame are ready.
   Pose mapping is an enhancement, not a playback prerequisite.
4. Raw clip persistence must work independently of AI analysis. Failure to save
   a clip must be visible to the user but must not block preview or playback.

If the intended policy is three *raw storage uploads* rather than three AI
analysis credits, use a separate upload quota. Do not overload the AI-credit
counter for that purpose.

## Problem statement

### Playback gate

`FightCoachExperience` holds a fully opaque, click-swallowing overlay until the
entire `FightAnalyzer` pre-scan completes. The dense local pass seeks and runs
MediaPipe on every sample, so a short clip can take minutes. The player is valid,
but the user cannot reach its Play button.

`FightAnalyzer` already listens for `play` and cancels the pre-scan. The UI makes
that escape path unreachable by withholding Play until completion.

### Credit accounting

Current behavior is inconsistent and invisible:

- Local trim, preview, and MediaPipe tracking do not call the server quota logic.
- `upload_video` is deliberately absent from `fightActionConsumesVideoQuota`.
- Some later clip-aware actions do consume a credit, but the UI does not show a
  credit balance or explain which action starts analysis.
- The present constant is two lifetime videos, while product messaging has been
  understood as three free uploads/questions. The three-question allowance is a
  separate per-clip follow-up-chat limit.

### Storage persistence

Production forces `MUSASHI_STORAGE_MODE=r2`, but the presigned-R2 upload path
requires all four `STORAGE_*` secrets. When they are absent, the app receives
`501 Storage not configured`; the background clip auto-save logs the failure and
the clip cannot be retained for later review.

### Trim and tracking fallback

The browser's MP4 MediaRecorder output failed picture validation for the
reproduced clip. The fallback WebM did validate and play. The cloud dense track
also failed its quality gate, so the app fell back to the slow local MediaPipe
pass. These failures must be observable and non-blocking.

## Scope

In scope:

- Playback readiness and background pose processing.
- Free-video analysis credit model and UI.
- Reliable clip persistence to R2.
- Trim format fallback, telemetry, and browser capability handling.
- Cloud-pose fallback behavior and user-visible status.

Out of scope:

- Changing the coaching model's tactical output.
- Charging for raw uploads beyond the optional separate upload quota described
  above.
- Browser extensions, user browser settings, or asking users to change browser.

## Design

### 1. Decouple playback from dense tracking

#### State model

Replace the single all-or-nothing boot gate with independent state:

```ts
type PlaybackReadiness = 'loading_media' | 'ready_to_play' | 'media_error'
type TrackingStatus = 'not_started' | 'sampling' | 'enhancing' | 'ready' | 'failed' | 'cancelled'
```

`ready_to_play` requires:

- `loadedmetadata` with finite, positive duration;
- non-zero `videoWidth` and `videoHeight`;
- `readyState >= HAVE_CURRENT_DATA`;
- one successful first-frame pose sample, if the pose engine is available. A pose
  sample timeout must not stop playback.

It must **not** require a full sparse or dense pass.

#### UI behavior

1. Show the current buffering/progress overlay only until `ready_to_play`.
2. Replace it with the existing explicit Play button immediately afterward.
3. Under the button show `Enhancing skeleton tracking in the background` with a
   non-blocking frame counter and a Cancel button.
4. On Play, call the existing cancellation path in `FightAnalyzer`, preserve the
   samples already collected, and switch to live tracking.
5. Offer an optional `Wait for enhanced tracking` control for users who want the
   complete cached dense track before replay/analysis.
6. Never use an opaque `pointer-events: auto` overlay to swallow Play while the
   player is otherwise playable.

#### Implementation changes

- In `runBootPipeline`, stop awaiting `prescanDone` before
  `setBootPipelineReady(true)`.
- Wait only for media readiness and the bounded first-frame sample.
- Start/retain the pre-scan as a background task and update `TrackingStatus` via
  `onPreScanFrame`, `onDenseTrackReady`, and an explicit error callback.
- Retain the existing 90-second stalled-pass detection, but transition the
  tracker to `failed`/`cancelled`; do not make it a playback error.
- Use a new `onPreScanError` callback so `initPoseLandmarker` failures are
  visible rather than indistinguishable from a slow scan.

### 2. Implement explicit analysis-credit sessions

#### API contract

Create a server endpoint or action with this lifecycle:

```text
POST /api/video-analysis-sessions
  input: { source: 'local' | 'asset', clipFingerprint, durationSec }
  output: { sessionId, status: 'reserved' | 'already_consumed', credits: { limit, used, remaining } }

POST /api/video-analysis-sessions/:id/commit
  input: { geminiFileUri or assetId }
  output: { status: 'consumed', credits }

POST /api/video-analysis-sessions/:id/release
  input: { reason: 'storage_failed' | 'gemini_failed' | 'user_cancelled' | 'timeout' }
  output: { status: 'released', credits }
```

The API must be authenticated, rate-limited, and idempotent. The stable idempotency
key is `(user_id, clip_fingerprint)`. Prefer an R2 `assetId` fingerprint after
storage succeeds; for a local-only clip, use a client-generated UUID held for the
current analysis session. Do not hash the entire video on the main UI thread.

#### Database

Add `musashi_video_analysis_sessions`:

| Column | Purpose |
| --- | --- |
| `id` | Server-generated analysis-session id |
| `user_id` | Credit owner |
| `clip_fingerprint` | Idempotency key per user |
| `duration_sec` | Auditable tier check |
| `state` | `reserved`, `consumed`, `released`, `failed` |
| `failure_reason` | Sanitized operational reason |
| `created_at`, `updated_at`, `expires_at` | Audit and reservation expiry |

Keep `musashi_video_clips_consumed` only as a migrated compatibility view/table,
or replace it after a one-time migration. Enforce uniqueness on
`(user_id, clip_fingerprint)` for active/consumed rows.

Set `FREE_LIFETIME_VIDEOS = 3` in the shared tier modules. Keep
`FREE_QUESTIONS_PER_CLIP = 3` as a separate, clearly named limit.

#### Charging semantics

1. On `Analyze with AI` or the first clip-grounded chat request, reserve one
   credit atomically after duration validation.
2. Upload the video to Gemini/R2.
3. Commit the credit only after the provider returns a usable file URI or the AI
   analysis session has successfully started.
4. Release the reservation on provider error, user cancellation, or expiry.
5. A repeat analysis of the same completed clip must return
   `already_consumed`, not consume another credit.

The existing `upload_video` route must no longer be a silent non-crediting side
path. It should accept an analysis session id and either commit the reservation
after a successful Gemini upload or release it on failure.

#### UI

- Show `3 AI analyses included` on the Free plan, not `3 uploads`.
- Display `N of 3 analyses remaining` before the user chooses `Analyze with AI`.
- At selection/trim time, say `Preview and trimming are free; AI analysis uses a
  credit only when you start it.`
- After a provider failure, show `No analysis credit was used` only after the
  release response succeeds.
- At zero credits, disable the explicit AI-start action with an upgrade path;
  do not block local preview, trim, or playback.

### 3. Repair R2 persistence

#### Deployment work

Set these Worker secrets for the live `app` Worker:

```text
STORAGE_SERVICE_URL=https://<Cloudflare-account-id>.r2.cloudflarestorage.com
STORAGE_ACCESS_KEY=<scoped R2 S3 API access key>
STORAGE_SECRET_KEY=<scoped R2 S3 API secret>
STORAGE_BUCKET_NAME=musashi-uploads
```

Configure R2 bucket CORS for the production app origin. Permit `PUT`, `GET`, and
`HEAD`, and permit the signed request headers used by the client, including
`Content-Type` and any `x-amz-*` headers. Restrict origins to the production
domain(s); do not use `*` with credentials.

#### Application work

- Add a deployment health endpoint that checks storage configuration without
  exposing secret values.
- Run this check during deploy and fail production deployment if R2 mode is
  configured but required storage secrets are absent.
- Replace the background-only console warning with clip state:
  `saving`, `saved`, `save_failed`. Playback remains available in all cases.
- Retry a transient ticket/PUT/complete failure once with exponential backoff.
  Do not retry 401/403/501 automatically.
- Prefer a Worker-bound R2 upload proxy in a later hardening phase if direct
  S3-compatible browser uploads prove difficult to operate. Keep the browser
  direct-upload option only when CORS and presigning checks pass.

### 4. Harden trim and pose fallback

#### Trimming

- Keep validation of size, metadata, dimensions, and duration after each
  MediaRecorder output.
- Feature-detect `captureStream` and each MIME candidate before showing trim.
- Record telemetry: source MIME, chosen output MIME, output size, validation
  reason, and elapsed time. Never record video bytes or private filenames.
- For production-quality H.264 output, add a server-side FFmpeg/MediaConvert
  trim job or an equivalent worker service. Browser trimming remains the fast
  preview fallback, not the sole reliable encoder.
- If all browser formats fail, preserve the original local file and offer
  `Upload original for server trim`; do not leave the user with a fake-ready
  player.

#### Pose engines

- Capture cloud quality-gate failures as structured telemetry, including the
  quality recommendation, latency, and fallback engine.
- Treat a rejected cloud track as `trackingStatus: enhancing`, not a failed
  video or blocked player.
- Do not attempt local RTMPose when `/models/rtmpose-halpe26.onnx` is absent;
  feature-detect/health-check it at startup and go directly to MediaPipe.
- Bound local dense work by device class and sample rate. Use a reduced sample
  rate for background enhancement on constrained devices.

## Browser responsibilities

No browser setting or extension needs to be changed by a user. The browser is
not the defect.

Browser-specific engineering work is limited to:

- Media capability detection for `MediaRecorder`, `captureStream`, WebM/MP4
  support, and video decode readiness.
- Browser/device performance profiling for background MediaPipe work.
- R2 CORS validation for direct browser uploads.
- Matrix testing on current Chrome, Safari/iOS, Firefox, and Android Chrome.

The app must gracefully degrade when a capability is missing; it must never lock
playback while waiting for a feature that a browser cannot provide.

## Acceptance criteria

### Playback

- A valid 10-second trimmed clip exposes Play within 3 seconds on the reference
  desktop device and within 8 seconds on a supported mobile device.
- Play advances the media clock within 2 seconds of the user click.
- Dense tracking may continue, cancel, or fall back without blocking playback.
- A corrupt/pictureless trimmed file produces a clear error and never a frozen
  player.

### Credits

- A new Free account has exactly 3 analysis credits.
- Selecting, trimming, previewing, local tracking, or a failed provider upload
  leaves the credit balance unchanged.
- A successful AI analysis uses exactly one credit.
- Retrying the same completed clip uses zero additional credits.
- A successful API response exposes the updated balance and the UI matches it.

### Storage

- A signed R2 upload ticket, browser PUT, and completion request all succeed for
  an `analysis_clip` on production.
- Failure states are shown to the user and captured in telemetry; they do not
  block local playback.

### Regression tests

- Unit tests for credit reservation, commit, release, expiry, and idempotency.
- Route tests proving `upload_video` cannot bypass the analysis-session credit
  lifecycle.
- Browser E2E test: trim a 30+ second fixture to 10 seconds, see Play before
  dense completion, and verify the video time advances.
- Browser E2E test: force cloud-track rejection and verify uninterrupted
  playback plus background fallback state.
- Production smoke test: signed R2 ticket/PUT/complete against a disposable
  test asset, then delete it.

## Rollout

1. Deploy the R2 secrets and CORS configuration; verify a production smoke
   upload.
2. Ship the non-blocking playback gate behind `VIDEO_BACKGROUND_TRACKING_V1`.
3. Add the credit-session tables/API behind `VIDEO_CREDITS_V2`; migrate existing
   consumption rows without granting duplicate credits.
4. Expose the credit balance UI and change all Free-plan copy to the approved
   product wording.
5. Enable the new credit enforcement after telemetry shows no stuck reservations
   and no playback regression.
6. Add server-side trim only after browser fallback telemetry identifies material
   failure rates by browser.
