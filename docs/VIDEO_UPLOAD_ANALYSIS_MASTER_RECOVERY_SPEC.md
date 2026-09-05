# Video Upload, Trim, Analysis, Panels, and Chat — Master Recovery Specification

**Status:** Implementation-ready recovery specification  
**Priority:** P0 production regression  
**Date:** 2026-07-16  
**Owner:** Musashi Fight Lab

This document supersedes the upload and trimming portions of
`technical-spec-video-analysis-reliability.md`. The earlier playback, credit,
and tracking decisions remain valid unless this document explicitly changes
them.

## 1. Outcome

From the normal production root URL on a phone or desktop, an athlete must be
able to:

1. choose or record a video;
2. choose the tier-allowed analysis window (Free: 10 seconds, Pro: 30 seconds);
3. upload a small, validated analysis artifact whenever the browser can make
   one safely;
4. fall back to a direct-to-R2 original upload and server trim when it cannot;
5. receive a Gemini tape URI;
6. receive truthful processing/tracking progress;
7. receive populated Coach Cards and an initial coaching message; and
8. ask follow-up questions that are grounded in that same tape.

`/` is the canonical Fight Lab URL. `/fight` may redirect to `/`; it must not
contain a separate implementation or state model.

## 2. Current regression and why the UI is stuck at 1%

The current worktree changed the previously working behavior in a material way:

- The older flow used `VideoTrimmer` and handed a physically trimmed file to
  Fight Lab.
- The current flow uses `ClipTimeWindowSlider`, stores timestamps only, and
  uploads the entire original file. See
  `src/components/fight/FightCoachExperience.tsx` around lines 1450-1469 and
  2595-2605.
- The home uploader accepts originals up to 500 MiB. See
  `src/lib/gemini/videoFilePart.ts` and `src/app/(app)/page.tsx`.
- Production currently has a same-origin Worker/R2 fallback when S3 signing
  credentials are unavailable. Large originals therefore pass through the
  Worker instead of going directly to R2.
- Cloudflare documents a 100 MB request-body ceiling for Free and Pro account
  plans. A UI that accepts 500 MiB but proxies through that route is not a valid
  production contract. Large requests can be rejected before the application
  completes the R2 write. See
  <https://developers.cloudflare.com/workers/platform/limits/>.
- The displayed value is not raw upload progress. The current callback maps
  raw XHR progress into 1-35 using
  `round(rawPercent * 0.35)` and floors it at 1. Displayed `1%` therefore covers
  roughly the first 1-4% of the real byte upload. For a 500 MiB file, the UI can
  remain at 1% while roughly the first 20-25 MiB are being sent.
- `putWithProgress` has no timeout, abort signal, offline handler, or stalled-byte
  watchdog. A request that stops after its first progress event can remain at
  1% indefinitely.
- The chosen timestamps are not authoritative across subsystems. Striking pose
  tracking still scans the visible full original, and the server receives the
  requested start but normalizes to the account's tier maximum rather than the
  athlete's requested duration. A five-second choice can become ten or thirty
  seconds; a long striking source can still trigger full-source frame work.
- Client and server tier identity can disagree. In particular, a development
  user can be client-capped like Pro while the server treats the same identity
  as Shogun and permits a much longer derivative.
- The previously observed R2 Worker fallback also passed `contentLength` as R2
  HTTP metadata. R2 HTTP metadata does not contain that field. The current local
  route removes it and wraps streams with `FixedLengthStream`, but that repair
  must be deployed and proven against the real bucket. Cloudflare's current
  Worker API documents only standard fields such as `contentType`,
  `contentLanguage`, `contentDisposition`, `contentEncoding`, `cacheControl`,
  and `cacheExpiry`: <https://developers.cloudflare.com/r2/api/workers/workers-api-reference/>.

The failure chain is:

```text
select timestamps
  -> upload full original
  -> progress is compressed to 1-35
  -> Worker PUT stalls/fails or exceeds ingress limit
  -> /complete is never called
  -> asset remains pending_upload
  -> upload_video never returns an active Gemini URI
  -> BJJ Coach Cards have no tape
  -> panels stay empty and clip-grounded chat has no video
```

The missing frame total is a downstream symptom, not an upload requirement.
Frame processing has not begun while bytes are stuck. In addition, BJJ uses
native full-tape vision and intentionally disables pose tracking, so it must not
promise a pose-frame counter. Striking can show a real deep-track counter only
after decoding starts and a real total is known.

## 3. Product decisions

1. **Restore a real trim artifact as the primary path.** Choosing 10 seconds
   must normally result in uploading approximately 10 seconds, not the entire
   phone recording.
2. **Keep server trimming as a fallback.** Browser MediaRecorder/canvas output
   is not reliable on every phone or codec. A validated fallback is required.
3. **Never proxy a large original through the app Worker.** Large or fallback
   originals go directly to R2 by presigned single PUT or multipart upload.
4. **Progress domains stay separate.** Trim percentage, byte-upload percentage,
   AI processing stage, and pose-frame progress must never be combined into one
   misleading percentage.
5. **No false success.** `Analysis complete`, `Coach Cards prepared`, and
   `Ready` have explicit data invariants defined below.
6. **No silent ungrounded chat.** A question presented as clip-aware must not be
   sent without the active tape URI.
7. **A failed upload or provider call consumes no analysis credit.** Retries are
   idempotent and reuse durable artifacts.
8. **The full original is optional for the analysis fast path.** If long-term
   archival is desired, it may upload in the background after analysis is
   usable; it must not block Coach Cards.
9. **One authoritative normalized clip feeds everything.** Playback, pose
   tracking, Gemini, Coach Cards, and chat must never analyze different time
   ranges for the same session.
10. **Real uploads do not autoplay.** QA fixtures may opt in explicitly, but an
    athlete sees the completed preparation state and chooses when to press Play.

## 4. Canonical user flow

### 4.1 Primary path: validated local analysis artifact

1. Probe source metadata and a decodable first frame.
2. If source duration exceeds the tier limit, open one visible window picker.
   The Free UI must say **Choose the 10 seconds to analyze**.
3. Re-encode only the selected interval at playback rate `1.0` using the visible
   player.
4. Validate the output before leaving the dialog:
   - non-zero bytes;
   - decodable metadata and first frame;
   - non-zero width and height;
   - duration no greater than the tier cap plus encoder tolerance;
   - duration close to the selected interval (maximum of 0.75 seconds or 10%
     drift);
   - playback clock advances normally at `playbackRate === 1`;
   - MIME/container is accepted by the server.
5. Reset the server analysis window to `0..trimmedDuration`; do not send the
   original source offset for a physically trimmed file.
6. Upload this small artifact, verify it in R2, then begin server normalization
   only if its codec/container still requires it.
7. Attach only the verified analysis artifact/derivative to the player and pose
   engine. The full source must no longer remain the active tracking input.

This restores the fast behavior that existed before the timestamp-only/full-file
regression while adding validation for the earlier “trimmed video plays too
fast” failure.

### 4.2 Fallback path: direct original plus server slice

Use this path only when local trim capability is missing or the output fails
validation.

1. Preserve the chosen `startSec` and `endSec`.
2. Explain: **This phone cannot make a safe local clip. Uploading the original
   directly so the server can prepare your 10-second selection.**
3. Upload directly to R2:
   - presigned single PUT for small/medium files;
   - presigned multipart for large files or when resumability is required.
4. Do not route an original over the Worker proxy when it is above a conservative
   proxy ceiling (90 MiB unless production plan discovery sets a lower value).
5. Run FFmpeg server-side using the selected start and the server-resolved tier
   maximum. The requested duration remains authoritative below that maximum.
   Persist a validated H.264/AAC derivative.
6. Retry normalization or Gemini from the durable R2 original; never require
   the athlete to upload the bytes again unless the R2 object itself is invalid.

The server computes the effective interval; the client cannot raise the cap and
the server cannot silently lengthen the athlete's shorter choice:

```text
effectiveDuration = min(
  requestedDuration,
  serverTierMaximum,
  sourceDuration - sourceStart
)
```

Cloudflare recommends direct presigned uploads for browser/mobile clients and
multipart uploads for large or resumable objects:
<https://developers.cloudflare.com/r2/objects/upload-objects/>.

## 5. One pipeline state machine

Replace independent booleans and optimistic status strings with one typed state.

```ts
type FightVideoStage =
  | 'idle'
  | 'probing'
  | 'selecting_window'
  | 'trimming_local'
  | 'validating_artifact'
  | 'ticketing'
  | 'uploading_bytes'
  | 'verifying_r2'
  | 'normalizing'
  | 'gemini_uploading'
  | 'gemini_processing'
  | 'tape_ready'
  | 'evidence_scan'
  | 'building_cards'
  | 'deep_tracking'
  | 'complete'
  | 'failed'

type FightVideoPipeline = {
  stage: FightVideoStage
  requestId: string
  sessionId: string
  assetId?: string
  normalizedAssetId?: string
  geminiFileUri?: string
  bytesSent?: number
  bytesTotal?: number
  framesDone?: number
  framesTotal?: number
  failure?: {
    stage: FightVideoStage
    code: string
    retryable: boolean
    message: string
  }
}
```

Required invariants:

- `verifying_r2` succeeds only when R2 `HEAD` exists and size equals the ticket.
- `tape_ready` requires an active Gemini file URI.
- `building_cards` succeeds only when structured coaching output validates and
  is non-empty.
- `complete` requires `tape_ready` and either populated Coach Cards or an
  explicit, visible terminal outcome explaining why cards are unavailable.
- A caught error can transition only to `failed`; it cannot set any Ready flag.
- A retry begins at the last valid durable stage.
- A stage must have a deadline or heartbeat. No network stage can wait forever.

Persist the server-owned portion by `videoAnalysisSessionId` so a page refresh,
phone background/foreground cycle, or duplicate tap can resume safely.

## 6. Upload contract

### 6.1 Ticket

`POST /api/uploads` accepts:

```json
{
  "purpose": "analysis_clip",
  "originalName": "clip.mp4",
  "contentType": "video/mp4",
  "sizeBytes": 8388608,
  "videoAnalysisSessionId": "uuid",
  "artifactKind": "local_trim" 
}
```

The response must declare one upload strategy:

- `presigned_put`;
- `presigned_multipart`; or
- `worker_put` for a small artifact only.

It also returns `assetId`, expiry, exact expected size, and a correlation
`requestId`. The server, not the client, decides whether `worker_put` is safe.
Worker fallback URLs should be relative to the current app origin so a proxy or
custom host cannot make the client misclassify the authenticated PUT as
cross-origin and omit its cookie.

Production requirements:

- provision scoped R2 S3 signing credentials;
- configure exact-origin R2 CORS for the normal production URL;
- allow `PUT`/`HEAD` and the signed headers;
- verify signing and CORS during deployment;
- keep the bound-bucket Worker path as a small-file fallback, not the default
  large-video transport.

### 6.2 Byte transfer

The client reports raw byte progress:

```text
Uploading 3.2 MB of 8.1 MB (40%)
```

It must not multiply the value by a stage weight. If the product wants overall
progress, show `Step 3 of 7` separately.

Every transfer supports:

- `AbortController`/XHR abort;
- explicit network timeout;
- stalled-byte watchdog based on the last increase in `loaded`;
- offline/online handling;
- Cancel and Retry controls;
- one bounded automatic retry for a transient failure;
- no automatic retry for authentication, authorization, unsupported media, or
  size-policy errors, including HTTP 413;
- parsing and displaying the safe structured server failure code rather than
  reducing every response to `Upload failed (status)`.

When no byte has advanced for 20 seconds, show **Upload paused — checking your
connection**. At the configured hard deadline, abort and transition to
`UPLOAD_STALLED`; do not leave `uploadingVideo` true.

If the byte PUT succeeded but the completion response was lost, query the asset
and R2 status before creating a new ticket. A retry must reconcile the durable
object first and must not blindly resend all bytes.

### 6.3 Completion

`POST /api/uploads/:id/complete` is idempotent. It must:

1. confirm ownership;
2. `HEAD` the R2 key;
3. compare exact stored size with the ticket;
4. reject an absent, zero-byte, or mismatched object;
5. set `uploaded` only after those checks; and
6. return the durable asset record and correlation ID.

This applies to both presigned and Worker-fallback uploads. A Worker PUT may
write only an owned asset in `pending_upload`; completed objects are immutable
through this endpoint.

Stale `pending_upload` records must be marked `failed`/expired by a scheduled
cleanup. They must not accumulate indefinitely or be mistaken for usable tape.

## 7. Server normalization and Gemini ingestion

The current `upload_video` request performs normalization, normalized R2
storage, Gemini upload, and Gemini polling inside one long HTTP request while
the client sits at 40%. Replace that opaque wait with an ingestion job or a
status stream.

Minimum contract:

```text
POST /api/fight/ingestions
  -> 202 { jobId, requestId, stage }

GET /api/fight/ingestions/:jobId
  -> { stage, heartbeatAt, normalizedAssetId?, geminiFileUri?, failure? }
```

SSE is acceptable instead of polling. A heartbeat must be visible at least
every 10 seconds while work is alive.

Do not keep one Worker request open while issuing dozens of Gemini polling
subrequests. The job boundary must keep polling bounded and compatible with the
deployed Worker plan's subrequest limits.

The job must be idempotent on `(userId, videoAnalysisSessionId)` and record:

- source asset;
- selected interval;
- normalized asset and verified duration;
- Gemini file identifier and state;
- stage timestamps and sanitized failure code;
- credit reservation/commit/release state.

The ingestion request carries `sourceStartSec` and `requestedDurationSec`.
Client and server resolve the same authenticated tier; a development QA persona
must explicitly select Free, Pro, or Shogun rather than inheriting an admin role
accidentally.

FFmpeg output must reset video/audio timestamps to approximately zero, keep
monotonic timestamps, produce H.264/AAC with fast-start metadata, and prove that
output duration matches `effectiveDuration` within tolerance. Positive duration
alone is not sufficient validation.

Credits commit only after the provider returns a usable tape URI or the
analysis has successfully started. All earlier terminal failures release the
reservation.

## 8. Analysis, Coach Cards, and chat contract

The initial tape analysis currently has fragmented paths: initial chat,
streaming analysis, and FightLang Coach Cards can succeed or fail independently.
One orchestrator must own the terminal result.

Required output:

```ts
type InitialCoachingResult = {
  tapeUri: string
  assistantMessage: string
  coachCards: StructuredCoaching
  evidenceLedger?: FightEvidenceLedger
  tracking?: {
    mode: 'native_tape' | 'local_pose' | 'cloud_pose'
    frames?: number
    quality?: string
  }
}
```

Rules:

- BJJ/wrestling/judo may use `native_tape` and show no pose-frame counter.
- A native-tape UI says **Reviewing the selected tape** and shows ingestion/AI
  stages, not `Pre-scan waiting`.
- Striking/MMA distinguishes the small keyframe bootstrap from the real deep
  pass. It shows `Deep tracking done/total frames` only when `total` is real.
- Cloud pose must show a job heartbeat and final frame count; it must not imply
  per-frame progress if the provider exposes none.
- The player, local pose engine, cloud pose engine, Gemini request, Coach Cards,
  and chat all receive the same normalized asset and effective interval.
- `fightLangCoaching`/Coach Cards must be non-null before the UI claims cards
  were prepared.
- Initial-analysis errors remain visible and retryable; they cannot be converted
  into `initialAnalysisReady = true`.
- Streaming errors render in the chat thread instead of leaving a blank panel.

Chat behavior:

- General no-clip chat can remain available and is labeled as general.
- A clip-grounded question is queued or disabled until `tape_ready`.
- It is never silently sent without `videoFileUri` because upload is in progress.
- Every follow-up for that clip sends the same active tape URI and session ID.
- On upload/analysis failure, the chat surface shows Retry/Cancel and the
  request ID; it does not fabricate clip feedback.

## 9. User-facing progress

Use stage-specific copy:

| State | Display |
| --- | --- |
| selecting/trimming | `Choose the 10 seconds to analyze` / `Preparing your 10-second clip 62%` |
| uploading | `Uploading 3.2 MB of 8.1 MB (40%)` |
| verifying | `Upload received — verifying` |
| normalizing | `Preparing a phone-safe video for AI` |
| Gemini | `Sending tape to the AI coach` / `AI coach is indexing the tape` |
| BJJ analysis | `Reviewing the selected tape` |
| striking deep track | `Deep tracking 128/302 frames` |
| cards | `Building Coach Cards` |
| complete | `Coach Cards ready — ask a follow-up` |

The UI must always offer a next action in a terminal failure: Retry from the
last durable stage, choose another video, or cancel.

Phone interaction rules:

- use one modal state machine for window selection -> sport/context -> review;
  do not close one dialog and open another in the same event;
- metadata probing has a bounded timeout and offers `Use the first 10 seconds`
  when the phone cannot decode source metadata;
- reuse one visible decoder where practical to avoid mobile decoder contention;
- background/foreground preserves the session, selected interval, and last
  durable server stage;
- real uploads require an explicit Play tap after preparation.

## 10. Observability

Use one correlation chain across browser and server:

```text
requestId -> videoAnalysisSessionId -> assetId -> normalizedAssetId -> Gemini file id
```

Record structured stage events with elapsed time, bytes, status, and safe error
code. Do not log video bytes, full private filenames, credentials, presigned
URLs, or provider response bodies.

Required operational views/alerts:

- count and age of `pending_upload` analysis clips;
- PUT status distribution and stalled-transfer count;
- R2 completion size mismatches;
- normalization and Gemini latency/failure by stage;
- percentage reaching `tape_ready`, `cards_ready`, and `complete`;
- client browser/OS family for trim fallback rates;
- deployment health for the R2 binding, selected upload mode, signing
  configuration, CORS smoke result, normalizer, and Gemini (without exposing
  secret values);
- alert on any `pending_upload` older than five minutes;
- alert when production smoke upload or Coach Card canary fails.

## 11. Test plan

### 11.1 Unit tests

- Raw upload progress is displayed without the current 0.35 compression.
- Stalled XHR transitions to `UPLOAD_STALLED`, clears busy state, and can retry.
- Timeout, abort, offline, and duplicate-click behavior.
- Same-origin credentials and cross-origin signed URL credential isolation.
- R2 Worker PUT uses `FixedLengthStream` and never puts `contentLength` in
  `httpMetadata`.
- Completion rejects missing, zero-byte, and size-mismatched R2 objects.
- Local trim forces playback rate 1.0 and rejects duration/speed drift.
- A physical trim resets server offsets to `0..trimmedDuration`.
- A selected five-second interval produces approximately five seconds, not the
  tier maximum.
- Client and server agree on Free, Pro, and Shogun limits.
- A failed analysis cannot transition to Ready/Complete.
- Coach Card success requires validated non-empty structured output.

### 11.2 Integration tests

- Ticket -> PUT -> R2 HEAD -> complete -> `uploaded` using the production-shaped
  Worker binding.
- A file above the Worker proxy ceiling selects direct R2, never Worker PUT.
- Direct R2 CORS preflight and PUT from the exact production origin.
- Multipart retry resumes failed parts.
- Normalize -> persist derivative -> Gemini ACTIVE -> coaching result.
- Fail each stage independently and confirm retry starts at the last durable
  artifact without another credit or byte upload.

### 11.3 Mobile/browser matrix

Required fixtures:

- iPhone MOV/HEVC longer than 10 seconds;
- iPhone MP4/H.264;
- Android Chrome MP4, including variable-frame-rate video;
- desktop MP4 and WebM;
- a source below the tier limit;
- a 4K source above 100 MB;
- corrupt, audio-only, and zero-frame files.

Required disruptions:

- background and foreground the app during trim and upload;
- drop and restore network after first progress;
- expire a ticket;
- reject cloud pose quality;
- time out normalization and Gemini processing.

Replace the stale trim browser script with assertions for the current labels and
state machine. Browser E2E must be part of the pre-deploy gate; a historical
script that expects removed button text is not coverage.

### 11.4 End-to-end acceptance

1. **Free BJJ:** choose a long phone video, select 10 seconds, upload artifact,
   reach R2 `uploaded`, receive a normalized duration at or below 10.75 seconds,
   receive an active Gemini URI, non-empty Coach Cards, an assistant message,
   and a grounded follow-up response using the same URI.
2. **Stall:** freeze PUT after its first progress event. The UI leaves 1%, shows
   an actionable stalled state within the configured window, and Retry works.
3. **BJJ copy:** no pose-frame or `Pre-scan waiting` promise appears. Native tape
   stages are truthful.
4. **Striking:** real deep progress advances from `0/N` to `N/N`; final engine,
   frame count, and quality remain visible. A long source with a ten-second
   selection analyzes only that normalized ten-second asset.
5. **Failure truthfulness:** failure at R2, normalization, Gemini, chat, stream,
   or Coach Cards never shows `Analysis complete` or `Coach Cards prepared`.
6. **Credit safety:** every pre-analysis failure uses zero credits; retrying the
   same completed session uses no additional credit.
7. **URL unification:** the same flow works at `/`; `/fight` redirects without a
   second uploader or state reset.

## 12. Rollout plan

### P0 — restore usable uploads

1. Freeze a reviewed checkpoint of the current broad uncommitted work. Build
   from a clean, versioned tree and expose the tested build SHA in production.
2. Re-enable physical tier-window trimming as the preferred analysis artifact.
3. Add playback-rate/duration validation and the server-trim fallback button.
4. Show raw byte progress and add abort/stall/timeout handling.
5. Make requested duration authoritative and attach the same normalized clip to
   playback, pose tracking, Gemini, cards, and chat.
6. Disable autoplay for real athlete uploads and make the modal handoff serial.
7. Deploy the R2 metadata/`FixedLengthStream` repair.
8. Provision scoped R2 signing credentials and exact-origin CORS.
9. Prevent Worker proxy selection above the safe ceiling.
10. Run a real phone BJJ smoke test and verify D1 `pending_upload -> uploaded`.

### P1 — make processing recoverable and truthful

1. Add the persisted ingestion state/job and heartbeat endpoint.
2. Make normalization, Gemini, and Coach Card retries resume from R2.
3. Enforce the Ready/Complete invariants and correct BJJ versus striking copy.
4. Queue/disable clip-grounded chat until tape readiness.
5. Add structured stage telemetry and pending-upload cleanup.

### P2 — harden and optimize

1. Add multipart resume for large fallback originals.
2. Run the full mobile matrix in CI/device testing.
3. Add canary upload + Coach Card monitoring and rollback thresholds.
4. Consider optional background archival of the full original after the fast
   analysis artifact succeeds.

## 13. Release gate and rollback

Do not call the recovery complete until all P0 end-to-end criteria pass on the
live root URL from at least one current iPhone and one current Android device.

Release gate:

- no invalid R2 HTTP metadata;
- no full original over the Worker proxy ceiling;
- no transfer can remain busy indefinitely;
- a real asset reaches `uploaded`;
- a real BJJ tape reaches Gemini ACTIVE;
- Coach Cards are non-empty;
- a follow-up is grounded in the active tape;
- failure paths do not consume credit or claim success.

Rollback immediately if the canary cannot complete the R2 ticket/PUT/complete
flow, if pending uploads rise without uploaded assets, or if Coach Cards become
empty after a successful tape upload. Roll back the application version while
preserving durable R2 originals and analysis-session records for retry.
