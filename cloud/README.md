# Musashi Cloud Pose API

This folder is the offload path Claude was pointing at: keep live MediaPipe on
the phone for instant preview, then run the expensive dense RTMPose pass on a
Modal GPU endpoint after the user uploads a clip.

## Files

- `pose_pipeline.py` is plain Python CV logic. It emits the same per-frame
  candidate shape the app already knows how to consume.
- `modal_app.py` wraps that pipeline as the production GPU endpoint. It asks
  Modal for L4 first, then T4 as a fallback.
- `modal_cpu_app.py` wraps the same contract as a CPU-only benchmark/fallback.

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

This machine has the Modal CLI installed in `.tools/modal-venv`, and the bearer
token used for deploys is stored locally in `.tools/pose_api_token.txt`.
`MUSASHI_POSE_CLOUD_GPU_URL`, `MUSASHI_POSE_CLOUD_CPU_URL`, and
`MUSASHI_POSE_CLOUD_TOKEN` are set in `.env.local`.

Smoke status from `public/test-videos/slowmo-slip.mp4`:

- GPU RTMPose: HTTP 200, 424 frames, 400 candidate frames.
- CPU MediaPipe fallback: HTTP 200, 424 frames, 402 candidate frames.

The Modal images pin `mediapipe==0.10.21` because newer 0.10.x builds no longer
expose the `mp.solutions` API used by `cloud/pose_pipeline.py`.
