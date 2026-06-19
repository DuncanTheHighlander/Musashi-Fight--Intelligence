# RTMPose backend — finishing & turning it on

State-of-the-art top-down pose to replace MediaPipe **inside each fighter's crop**.
The module is written: [`src/lib/pose/rtmposeBackend.ts`](src/lib/pose/rtmposeBackend.ts).
It is **flag-gated and inert** until you do the 3 steps below, so the app keeps
running on MediaPipe exactly as today until you opt in.

> Why it isn't already wired in: it needs `npm` + a model download, both of
> which were **blocked in the sandbox where it was built**, so it could not be
> tested. Wiring an untested async model call into the working detection loop
> would risk the clips that already track well — so that one edit is left for
> here, where you can run it and measure.

---

## Step 1 — install the runtime

```bash
pnpm add onnxruntime-web
```

(Optional, faster: also copy the ORT WASM/JSEP assets to `public/` and set
`ort.env.wasm.wasmPaths` — see onnxruntime-web docs. WebGPU is auto-preferred.)

## Step 2 — get a pose model **with feet** and place it

The app needs toes/heels, so use a **Halpe-26** (or COCO-WholeBody) RTMPose model,
**not** plain COCO-17 (no feet). Easiest path:

- mmpose/mmdeploy RTMPose-m Halpe-26 → export to ONNX (`tools/deploy.py` with a
  `pose-detection_simcc_onnxruntime` config), **or** grab a community ONNX export.
- Put it at: `public/models/rtmpose-halpe26.onnx`

Then open the model once in **Netron** and confirm:
- input name + shape `[1,3,256,192]` (NCHW). Update `INPUT_W/INPUT_H` if different.
- two outputs `simcc_x [1,26,Wx]`, `simcc_y [1,26,Wy]`. The code auto-picks them
  by name (`/x/`, `/y/`) but verify.
- preprocessing: RGB, ImageNet `MEAN`/`STD`, `SIMCC_SPLIT_RATIO=2.0`. Adjust the
  constants at the top of `rtmposeBackend.ts` to match the export if needed.

## Step 3 — wire it into the per-fighter crop (one spot)

In [`src/components/video/FightAnalyzer.tsx`](src/components/video/FightAnalyzer.tsx)
the dense pass detects each fighter inside his box (~line 982-998) via
`detectInRegion(...)`. Make that call prefer RTMPose when ready. The detection
loop is already `async`, so you can `await`:

```ts
// near the other imports
import { initRtmpose, isRtmposeReady, rtmposeInRegionAsync, rtmposeRequested } from '@/lib/pose/rtmposeBackend'

// once, where the landmarkers are created (boot):
if (rtmposeRequested()) void initRtmpose()

// inside the dense-pass per-fighter loop, replace:
//   const det = detectInRegion(retryLandmarkerRef.current, detectSurface, padded, refineCanvasRef.current[key]!)
// with:
const det = (rtmposeRequested() && isRtmposeReady())
  ? await rtmposeInRegionAsync(detectSurface, padded, refineCanvasRef.current[key]!)
  : detectInRegion(retryLandmarkerRef.current, detectSurface, padded, refineCanvasRef.current[key]!)
```

Do the same at the live crop-zoom refinement site (~line 1163) if you want it live.
**Bump `TRACK_PIPELINE_VERSION`** in `denseTrackCache.ts` so cached tracks regenerate.

## Step 4 — turn it on & A/B test

- Enable per session: add `?poseBackend=rtmpose` to the URL, or
  `localStorage.musashiPoseBackend = 'rtmpose'`. Remove it to fall back to MediaPipe.

## Step 5 — the validation loop (do NOT ship without this)

Run **all three** test clips through a fresh deep pass, MediaPipe vs RTMPose, and
compare with the same probes used during development (paste in the browser console
after `window.__denseTrack` is ready):

```js
// collapse rate (overlap distortion) + identity teleports
(() => { const dt=window.__denseTrack,D=(a,b)=>a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;
let c=0,n=0;for(const s of dt)for(const k of['A','B']){const lm=s[k];if(!lm)continue;n++;
const sw=D(lm[11],lm[12]),hw=D(lm[23],lm[24]),sc={x:(lm[11].x+lm[12].x)/2,y:(lm[11].y+lm[12].y)/2},
hc={x:(lm[23].x+lm[24].x)/2,y:(lm[23].y+lm[24].y)/2},th=Math.hypot(sc.x-hc.x,sc.y-hc.y)||0.001;
if(Math.min(sw,hw)/th<0.15)c++;}return{collapse:Math.round(100*c/n)+'%'};})()
```

Baselines to beat (MediaPipe, v10/v11): clip1 good w/ spacing; clip2 ~85% both,
6 teleports; clip3 ~61-63% collapse, ~35-41 teleports. **Accept RTMPose only if
every clip is equal-or-better** — same rule that protected the project all along.

## What's verified vs not

- ✅ module structure, flag, graceful-degrade, letterbox, SimCC decode algorithm,
  Halpe-26→BlazePose-33 map (all joints incl. feet).
- ⚠️ tensor names / `SIMCC_SPLIT_RATIO` / mean-std / RGB order are **export-specific**
  — confirm in Step 2. These are the only things likely to need a tweak.
