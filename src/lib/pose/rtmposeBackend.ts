/**
 * RTMPose backend — state-of-the-art top-down pose, drop-in for the per-fighter
 * crop step.  ⚠️ SCAFFOLD: not runnable in this repo as shipped.
 *
 * It REQUIRES two things this environment can't provide (npm + model download
 * are blocked here — see RTMPOSE_SETUP.md to finish it on a networked machine):
 *   1.  `pnpm add onnxruntime-web`
 *   2.  one ONNX model with FEET keypoints in `public/models/`:
 *         public/models/rtmpose-halpe26.onnx   (RTMPose-m, Halpe-26 — has toes/heels)
 *
 * Why this shape: the app already locates each fighter's box (MediaPipe + the
 * identity tracker).  The ONLY weak link is the pose drawn inside that box on
 * small / cluttered / occluded crops.  So this exposes ONE function that mirrors
 * `detectInRegion()` from poseRetry.ts — same signature, same normalized-frame
 * output — swappable behind a flag WITHOUT touching identity logic.  Flag off ⇒
 * MediaPipe exactly as today (cannot regress the working clips); flag on ⇒
 * RTMPose fills the same slot.
 *
 * onnxruntime-web is imported DYNAMICALLY via a non-literal specifier so the
 * project still type-checks / builds / runs on MediaPipe when the library and
 * model are absent (`isRtmposeReady()` stays false and callers fall back).
 *
 * Pipeline per box: crop+pad → letterbox to 192×256 → RTMPose → SimCC decode
 *   (argmax over x/y 1-D heatmaps ÷ split-ratio) → 26 Halpe pts → map to the
 *   33-point BlazePose layout the rest of the app consumes.
 *
 * VERIFY ON A NETWORKED MACHINE (cannot be tested here):
 *   - model input/output tensor NAMES are export-specific — resolved at runtime
 *     from session.inputNames/outputNames, but confirm the x/y heuristic.
 *   - SIMCC_SPLIT_RATIO + MEAN/STD + RGB order must match the .onnx export.
 *   - Halpe-26 index order (below) matches the standard mmpose export.
 */

import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { BoundingBox } from '@/lib/poseRetry'

// ---------------------------------------------------------------------------
// Feature flag
// ---------------------------------------------------------------------------

/** Opt-in. URL `?poseBackend=rtmpose` or localStorage `musashiPoseBackend`. */
export function rtmposeRequested(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const url = new URLSearchParams(window.location.search).get('poseBackend')
    if (url) return url === 'rtmpose'
    return window.localStorage.getItem('musashiPoseBackend') === 'rtmpose'
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Model + runtime config
// ---------------------------------------------------------------------------

const POSE_MODEL_URL = '/models/rtmpose-halpe26.onnx'
const INPUT_W = 192
const INPUT_H = 256
const SIMCC_SPLIT_RATIO = 2.0
// RTMPose (mmdeploy ONNX export) normalises with ImageNet mean/std on the 0-255
// RGB domain. Confirm against your export.
const MEAN = [123.675, 116.28, 103.53]
const STD = [58.395, 57.12, 57.375]

// `onnxruntime-web` is not installed in this repo; keep types loose so the
// project builds. Real types come for free once the package is added.
type Ort = any // eslint-disable-line @typescript-eslint/no-explicit-any
type OrtSession = any // eslint-disable-line @typescript-eslint/no-explicit-any
type OrtTensor = any // eslint-disable-line @typescript-eslint/no-explicit-any

let ort: Ort = null
let session: OrtSession = null
let initState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
let ioNames: { input: string; simccX: string; simccY: string } | null = null

export function isRtmposeReady(): boolean {
  return initState === 'ready' && session != null
}

/**
 * Initialise once. Safe to call repeatedly. Returns true when ready.
 * Never throws — on any failure it logs and leaves the app on MediaPipe.
 */
export async function initRtmpose(): Promise<boolean> {
  if (initState === 'ready') return true
  if (initState === 'loading' || initState === 'failed') return false
  initState = 'loading'
  try {
    // Literal dynamic import: webpack code-splits onnxruntime-web into its own
    // lazy chunk loaded ONLY here (i.e. only when the flag is on) — flag-off
    // never pays the bundle/memory cost. Now that the package is installed this
    // resolves; before it was a non-literal specifier to keep the build green.
    ort = await import('onnxruntime-web')
    // ORT fetches its WASM/JSEP binaries at runtime — point them at the CDN that
    // matches the installed version so Next doesn't have to serve them locally.
    try {
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/'
    } catch {
      /* env not present — defaults will be used */
    }

    const providers: string[] = []
    try {
      if (typeof navigator !== 'undefined' && (navigator as unknown as { gpu?: unknown }).gpu) {
        providers.push('webgpu')
      }
    } catch {
      /* no webgpu */
    }
    providers.push('wasm')

    session = await ort.InferenceSession.create(POSE_MODEL_URL, {
      executionProviders: providers,
      graphOptimizationLevel: 'all',
    })

    const inName: string = session.inputNames?.[0] ?? 'input'
    const outs: string[] = session.outputNames ?? []
    const simccX = outs.find((n) => /x/i.test(n)) ?? outs[0] ?? 'simcc_x'
    const simccY = outs.find((n) => /y/i.test(n)) ?? outs[1] ?? 'simcc_y'
    ioNames = { input: inName, simccX, simccY }

    initState = 'ready'
    console.log('[RTMPose] ready —', providers.join('>'), '| io', ioNames)
    return true
  } catch (err) {
    initState = 'failed'
    console.warn('[RTMPose] init failed, staying on MediaPipe:', err)
    return false
  }
}

// ---------------------------------------------------------------------------
// Halpe-26 → BlazePose-33 index map (covers every joint the app analyses, feet
// included). Face/hand-detail points the app doesn't compute on are
// approximated from the nearest real joint and flagged low-visibility.
//
// Halpe-26: 0 nose,1 Leye,2 Reye,3 Lear,4 Rear,5 Lsho,6 Rsho,7 Lelb,8 Relb,
// 9 Lwri,10 Rwri,11 Lhip,12 Rhip,13 Lkne,14 Rkne,15 Lank,16 Rank,17 head,
// 18 neck,19 hip,20 LbigToe,21 RbigToe,22 LsmallToe,23 RsmallToe,24 Lheel,25 Rheel
// ---------------------------------------------------------------------------

const H = {
  nose: 0, Leye: 1, Reye: 2, Lear: 3, Rear: 4, Lsho: 5, Rsho: 6, Lelb: 7, Relb: 8,
  Lwri: 9, Rwri: 10, Lhip: 11, Rhip: 12, Lkne: 13, Rkne: 14, Lank: 15, Rank: 16,
  LbigToe: 20, RbigToe: 21, Lheel: 24, Rheel: 25,
} as const

// For each BlazePose-33 index: which Halpe point feeds it.
const BP_FROM_HALPE: number[] = [
  H.nose,                               // 0 nose
  H.Leye, H.Leye, H.Leye,               // 1-3 left eye inner/eye/outer
  H.Reye, H.Reye, H.Reye,               // 4-6 right eye
  H.Lear,                               // 7 left ear
  H.Rear,                               // 8 right ear
  H.nose, H.nose,                       // 9-10 mouth (approx)
  H.Lsho, H.Rsho,                       // 11-12 shoulders
  H.Lelb, H.Relb,                       // 13-14 elbows
  H.Lwri, H.Rwri,                       // 15-16 wrists
  H.Lwri, H.Rwri, H.Lwri, H.Rwri, H.Lwri, H.Rwri, // 17-22 hands (approx → wrist)
  H.Lhip, H.Rhip,                       // 23-24 hips
  H.Lkne, H.Rkne,                       // 25-26 knees
  H.Lank, H.Rank,                       // 27-28 ankles
  H.Lheel, H.Rheel,                     // 29-30 heels
  H.LbigToe, H.RbigToe,                 // 31-32 foot index (big toe)
]
const APPROX_BP = new Set([9, 10, 17, 18, 19, 20, 21, 22])

type Geom = { left: number; top: number; right: number; bottom: number; padX: number; padY: number; rw: number; rh: number }

// ---------------------------------------------------------------------------
// Inference — async mirror of detectInRegion(): pose inside one box, output in
// full-frame normalized coords. (ORT web run() is async, so callers must await;
// the dense-pass detection loop is already async — see RTMPOSE_SETUP.md.)
// ---------------------------------------------------------------------------

export async function rtmposeInRegionAsync(
  source: HTMLVideoElement | HTMLCanvasElement,
  bbox: BoundingBox,
  cropCanvas: HTMLCanvasElement
): Promise<NormalizedLandmark[] | null> {
  if (!isRtmposeReady() || !ort || !session || !ioNames) return null
  const prep = preprocess(source, bbox, cropCanvas)
  if (!prep) return null
  try {
    const input: OrtTensor = new ort.Tensor('float32', prep.chw, [1, 3, INPUT_H, INPUT_W])
    const out = await session.run({ [ioNames.input]: input })
    return decodeSimcc(out[ioNames.simccX], out[ioNames.simccY], prep.geom)
  } catch (err) {
    console.warn('[RTMPose] inference error:', err)
    return null
  }
}

function preprocess(
  source: HTMLVideoElement | HTMLCanvasElement,
  bbox: BoundingBox,
  cropCanvas: HTMLCanvasElement
): { chw: Float32Array; geom: Geom } | null {
  const vw = source instanceof HTMLVideoElement ? source.videoWidth : source.width
  const vh = source instanceof HTMLVideoElement ? source.videoHeight : source.height
  if (!vw || !vh) return null
  const pad = 0.05
  const left = Math.max(0, bbox.left - pad)
  const top = Math.max(0, bbox.top - pad)
  const right = Math.min(1, bbox.right + pad)
  const bottom = Math.min(1, bbox.bottom + pad)
  const sx = Math.round(left * vw)
  const sy = Math.round(top * vh)
  const sw = Math.max(1, Math.round((right - left) * vw))
  const sh = Math.max(1, Math.round((bottom - top) * vh))
  // Letterbox preserving aspect ratio.
  const scale = Math.min(INPUT_W / sw, INPUT_H / sh)
  const rw = Math.round(sw * scale)
  const rh = Math.round(sh * scale)
  const padX = Math.floor((INPUT_W - rw) / 2)
  const padY = Math.floor((INPUT_H - rh) / 2)
  cropCanvas.width = INPUT_W
  cropCanvas.height = INPUT_H
  const ctx = cropCanvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.fillStyle = 'black'
  ctx.fillRect(0, 0, INPUT_W, INPUT_H)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, sx, sy, sw, sh, padX, padY, rw, rh)
  const data = ctx.getImageData(0, 0, INPUT_W, INPUT_H).data
  const chw = new Float32Array(3 * INPUT_W * INPUT_H)
  const plane = INPUT_W * INPUT_H
  for (let p = 0, i = 0; p < plane; p++, i += 4) {
    chw[p] = (data[i] - MEAN[0]) / STD[0]
    chw[plane + p] = (data[i + 1] - MEAN[1]) / STD[1]
    chw[2 * plane + p] = (data[i + 2] - MEAN[2]) / STD[2]
  }
  return { chw, geom: { left, top, right, bottom, padX, padY, rw, rh } }
}

/** SimCC argmax decode → BlazePose-33 in full-frame normalized coords. */
function decodeSimcc(simccX: OrtTensor, simccY: OrtTensor, g: Geom): NormalizedLandmark[] {
  const xs = simccX.data as Float32Array // [1, K, Wx]
  const ys = simccY.data as Float32Array // [1, K, Wy]
  const K = simccX.dims[1] as number
  const Wx = simccX.dims[2] as number
  const Wy = simccY.dims[2] as number

  const halpe: { x: number; y: number; v: number }[] = []
  for (let k = 0; k < K; k++) {
    let bx = 0, bxv = -Infinity
    for (let i = 0; i < Wx; i++) {
      const v = xs[k * Wx + i]
      if (v > bxv) { bxv = v; bx = i }
    }
    let by = 0, byv = -Infinity
    for (let i = 0; i < Wy; i++) {
      const v = ys[k * Wy + i]
      if (v > byv) { byv = v; by = i }
    }
    const mx = bx / SIMCC_SPLIT_RATIO
    const my = by / SIMCC_SPLIT_RATIO
    const cropX = (mx - g.padX) / Math.max(1, g.rw)
    const cropY = (my - g.padY) / Math.max(1, g.rh)
    const x = g.left + cropX * (g.right - g.left)
    const y = g.top + cropY * (g.bottom - g.top)
    const v = Math.max(0, Math.min(1, (bxv + byv) / 2))
    halpe.push({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)), v })
  }

  return BP_FROM_HALPE.map((src, bp) => {
    const h = halpe[src]
    const vis = h ? (APPROX_BP.has(bp) ? h.v * 0.5 : h.v) : 0
    return { x: h?.x ?? 0.5, y: h?.y ?? 0.5, z: 0, visibility: vis } as NormalizedLandmark
  })
}
