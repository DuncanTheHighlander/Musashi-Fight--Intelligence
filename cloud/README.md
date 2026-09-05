# Musashi Cloud Pose API

This folder is the offload path Claude was pointing at: keep live MediaPipe on
the phone for instant preview, then run the expensive dense RTMPose pass on a
Modal GPU endpoint after the user uploads a clip.

## Files

- `pose_pipeline.py` is plain Python CV logic. It emits the same per-frame
  candidate shape the app already knows how to consume.
- `rtmpose_decoder.py` is RTMPose keypoint decoding on its own, so both the
  MediaPipe-box and SAM-mask paths share one decoder.
- `detector.py` finds every person in a frame (torchvision Faster R-CNN).
- `sam_pipeline.py` is the SAM 2.1 tracker path — see below.
- `modal_app.py` wraps those pipelines as the production GPU endpoints. It asks
  Modal for L4 first, then T4 as a fallback.
- `modal_cpu_app.py` wraps the same contract as a CPU-only benchmark/fallback.

## SAM 2.1 fighter tracking (`mode=sam2`)

`pose_pipeline.py` derives identity from pose detections, which is backwards:
MediaPipe returns one pose per frame (the largest body), its box is latched into
`prev_boxes`, and a foreground spectator who wins frame 0 keeps a tracker slot
for the whole clip — see `docs/AI_VISION_PIPELINE_AUDIT.md` §5.

`sam_pipeline.py` inverts that. A real detector returns *every* person, a scoring
function picks the two most fighter-like, and SAM 2.1's object memory carries
those identities through occlusion and crossings. RTMPose then decodes keypoints
inside boxes that are already identity-locked:

```
detector -> score_fighters -> SAM 2.1 (stable obj ids) -> mask -> bbox -> RTMPose
```

Each emitted candidate carries `trackId`. When every candidate has one,
`src/lib/identityReplayCore.ts` uses a deterministic `trackId -> A/B` mapping and
skips heuristic identity assignment entirely.

SAM **2.1** specifically: it is Apache 2.0 and ungated. SAM 3's checkpoints are
gated and licensed for non-commercial research only, and fal's hosted SAM 3 video
endpoints return a rendered video rather than machine-readable per-frame masks.
`SamPipeline.track_objects` is the one seam to change if that ever shifts.

`score_fighters` is a port of `scoreFighters` in
`src/lib/pose/fighterSelection.ts` and must stay in sync with it (verified equal
to 5e-10 across 40 random cases).

Notes:

- GPU-only. The proxy never falls back to a CPU backend for `mode=sam2`, because
  a silent fall-through to MediaPipe would reintroduce the bug this path fixes.
- Its Modal image carries torch/torchvision and deliberately does **not** carry
  MediaPipe, so the image stays separate from the RTMPose one.
- SAM 2.1 and the detector weights are baked in at build time by
  `_prefetch_sam_weights`, so a cold start does not download them.

## Deploy

Prerequisites:

- `public/models/rtmpose-halpe26.onnx` exists locally.
- You have a Modal account and have run `modal token new`.

This workspace also has a gitignored local Modal CLI at:

```powershell
.tools\modal-venv\Scripts\modal.exe
```

Use that path in place of `modal` if Modal is not on your system PATH.

Check local readiness without printing secrets:

```bash
npm run check:cloud-pose
```

Or directly:

```bash
node scripts/check-cloud-pose-ready.mjs
```

Develop with a temporary URL:

```bash
modal serve cloud/modal_app.py
```

Deploy a persistent endpoint:

```bash
modal deploy cloud/modal_app.py
```

Deploy the CPU-only benchmark endpoint:

```bash
modal deploy cloud/modal_cpu_app.py
```

After deploy, copy the exact endpoint URLs printed by Modal into:

```bash
MUSASHI_POSE_CLOUD_GPU_URL=<gpu Modal endpoint URL>
MUSASHI_POSE_CLOUD_CPU_URL=<cpu Modal endpoint URL, optional>
MUSASHI_POSE_CLOUD_TOKEN=<same value as POSE_API_TOKEN>
```

Smoke test:

```bash
curl -X POST -H "Authorization: Bearer $POSE_API_TOKEN" -F "video=@public/test-videos/slowmo-slip.mp4" https://<modal-endpoint-url>
```

To force the MediaPipe-only path through the same endpoint:

```bash
curl -X POST -H "Authorization: Bearer $POSE_API_TOKEN" -F "video=@public/test-videos/slowmo-slip.mp4" -F "mode=mediapipe" https://<modal-endpoint-url>
```

Smoke test through the app proxy after env vars are set:

```bash
curl -X POST -F "video=@public/test-videos/slowmo-slip.mp4" -F "target=auto" -F "mode=rtmpose" http://localhost:3000/api/fight/cloud-pose
```

Opt into the cloud dense pass in the browser:

```text
?poseBackend=cloud
?poseBackend=cloud&poseCloudTarget=gpu&poseCloudMode=rtmpose
?poseBackend=cloud&poseCloudTarget=cpu&poseCloudMode=mediapipe
```

You can also persist the same dev switches in localStorage:

```js
localStorage.setItem('musashiPoseBackend', 'cloud')
localStorage.setItem('musashiPoseCloudTarget', 'auto') // auto | gpu | cpu
localStorage.setItem('musashiPoseCloudMode', 'rtmpose') // rtmpose | mediapipe
```

## Contract

Request: `POST multipart/form-data`

- `video`: required uploaded video file.
- `mode`: optional, `rtmpose` or `mediapipe`, defaults to `rtmpose`.
- `use_rtmpose`: optional legacy alias when `mode` is omitted.
- `fps`: optional fallback FPS, defaults to `30`.

Response:

```json
{
  "version": "musashi-pose-api-v1",
  "backend": "rtmpose",
  "meta": {
    "frames": 423,
    "candidateFrames": 423,
    "twoFighterFrames": 381,
    "elapsedMs": 120000
  },
  "frames": [
    {
      "f": 0,
      "tMs": 0,
      "candidates": [
        {
          "pose": [],
          "anchor": { "x": 0.5, "y": 0.5 },
          "scale": 0.2,
          "color": { "torso": { "r": 0.4, "g": 0.3, "b": 0.2 } }
        }
      ]
    }
  ]
}
```

## Security

Do not call the Modal URL directly from the shipped mobile app. Put your
Cloudflare/Next API in front of it, enforce user auth and upload limits there,
then forward the clip to Modal. For a simple bearer-token guard during private
testing, set `POSE_API_TOKEN` in your shell before `modal serve` or
`modal deploy`; the app passes it with `modal.Secret.from_local_environ`.
Requests must then include:

```http
Authorization: Bearer <token>
```

Modal also supports proxy auth tokens if you want platform-level protection.

The existing Next proxy at `/api/fight/cloud-pose` expects these env vars:

- `MUSASHI_POSE_CLOUD_GPU_URL`: exact deployed GPU Modal endpoint URL.
- `MUSASHI_POSE_CLOUD_CPU_URL`: optional exact deployed CPU Modal endpoint URL.
- `MUSASHI_POSE_CLOUD_TOKEN`: same value as `POSE_API_TOKEN`.
- `MUSASHI_POSE_PROXY_MAX_BYTES`: optional upload cap, default 256 MB.
- `MUSASHI_POSE_PROXY_TIMEOUT_MS`: optional upstream timeout, default 290 sec.

Proxy targets:

- `target=auto` (default): try GPU first, then CPU on network/5xx/408/429 failures.
- `target=gpu`: call only the GPU endpoint.
- `target=cpu`: call only the CPU endpoint.

## Current status

The repo wiring is in place:

- Modal GPU worker: `cloud/modal_app.py`
- Modal CPU fallback/benchmark worker: `cloud/modal_cpu_app.py`
- App proxy: `/api/fight/cloud-pose`
- Default proxy target: `auto` (GPU first, CPU fallback)
- Modal GPU endpoint: `https://duncanazsmith--musashi-pose-api-analyze-pose.modal.run`
- Modal CPU endpoint: `https://duncanazsmith--musashi-pose-api-cpu-analyze-pose.modal.run`
- Modal SAM endpoint: `https://duncanazsmith--musashi-pose-api-analyze-pose-sam.modal.run`
  (**not deployed yet** — redeploy `cloud/modal_app.py` and set
  `MUSASHI_POSE_CLOUD_SAM_URL` to enable `?poseCloudMode=sam2`)

This machine has the Modal CLI installed in `.tools/modal-venv`, and the bearer
token used for deploys is stored locally in `.tools/pose_api_token.txt`.
`MUSASHI_POSE_CLOUD_GPU_URL`, `MUSASHI_POSE_CLOUD_CPU_URL`, and
`MUSASHI_POSE_CLOUD_TOKEN` are set in `.env.local`.

Smoke status from `public/test-videos/slowmo-slip.mp4`:

- GPU RTMPose: HTTP 200, 424 frames, 400 candidate frames.
- CPU MediaPipe fallback: HTTP 200, 424 frames, 402 candidate frames.

The Modal images pin `mediapipe==0.10.21` because newer 0.10.x builds no longer
expose the `mp.solutions` API used by `cloud/pose_pipeline.py`.
