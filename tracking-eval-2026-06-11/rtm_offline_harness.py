"""Offline RTMPose harness — grade RTMPose vs MediaPipe on all 3 clips, no browser.

Runs the SAME RTMPose ONNX model the app uses (public/models/rtmpose-halpe26.onnx),
directly on the test-video frames in Python. For a fair detector comparison it reuses
the EXACT fighter boxes the MediaPipe candidate JSONs already found and only swaps the
pose inside each box for RTMPose — identical boxes, different detector — mirroring how
FightAnalyzer fuses them (box from MediaPipe/identity, refine with RTMPose).

Pre/post-processing mirrors src/lib/pose/rtmposeBackend.ts exactly:
  crop+0.05 pad -> letterbox 192x256 -> ImageNet norm (RGB) -> RTMPose -> SimCC argmax
  /2.0 -> Halpe-26 -> BlazePose-33 map.

Usage:
  python rtm_offline_harness.py            # all 3 clips
  python rtm_offline_harness.py clip3      # one clip
Outputs v2_rtm_<clip>.json next to the inputs and prints a comparison table.
"""
import sys, os, json
import cv2
import numpy as np
import onnxruntime as ort

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
MODEL = os.path.join(ROOT, "public", "models", "rtmpose-halpe26.onnx")

CLIPS = {
    "clip1": ("test-video-for-app.mp4", "v2_0_400.json"),
    "clip2": ("clip2-overlap.mp4", "v2_0_683.json"),
    "clip3": ("slowmo-slip.mp4", "v2_clip3.json"),
}

INPUT_W, INPUT_H = 192, 256
SPLIT = 2.0
MEAN = np.array([123.675, 116.28, 103.53], np.float32)
STD = np.array([58.395, 57.12, 57.375], np.float32)

# Halpe-26 -> BlazePose-33 (identical to rtmposeBackend.ts BP_FROM_HALPE)
H = dict(nose=0, Leye=1, Reye=2, Lear=3, Rear=4, Lsho=5, Rsho=6, Lelb=7, Relb=8,
         Lwri=9, Rwri=10, Lhip=11, Rhip=12, Lkne=13, Rkne=14, Lank=15, Rank=16,
         LbigToe=20, RbigToe=21, Lheel=24, Rheel=25)
BP_FROM_HALPE = [
    H["nose"],
    H["Leye"], H["Leye"], H["Leye"],
    H["Reye"], H["Reye"], H["Reye"],
    H["Lear"], H["Rear"],
    H["nose"], H["nose"],
    H["Lsho"], H["Rsho"],
    H["Lelb"], H["Relb"],
    H["Lwri"], H["Rwri"],
    H["Lwri"], H["Rwri"], H["Lwri"], H["Rwri"], H["Lwri"], H["Rwri"],
    H["Lhip"], H["Rhip"],
    H["Lkne"], H["Rkne"],
    H["Lank"], H["Rank"],
    H["Lheel"], H["Rheel"],
    H["LbigToe"], H["RbigToe"],
]
APPROX_BP = {9, 10, 17, 18, 19, 20, 21, 22}

sess = ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"])
IN_NAME = sess.get_inputs()[0].name
OUTS = [o.name for o in sess.get_outputs()]
X_NAME = next((n for n in OUTS if "x" in n.lower()), OUTS[0])
Y_NAME = next((n for n in OUTS if "y" in n.lower()), OUTS[1])


def bbox_of(pose, vis_th=0.3):
    vis = [p for p in pose if p["visibility"] > vis_th]
    if not vis:
        return None
    return (min(p["x"] for p in vis), min(p["y"] for p in vis),
            max(p["x"] for p in vis), max(p["y"] for p in vis))


def rtmpose_in_box(frame_bgr, box):
    """frame_bgr: HxWx3 BGR. box: (l,t,r,b) normalized. -> BlazePose-33 pose or None."""
    vh, vw = frame_bgr.shape[:2]
    pad = 0.05
    left = max(0.0, box[0] - pad); top = max(0.0, box[1] - pad)
    right = min(1.0, box[2] + pad); bottom = min(1.0, box[3] + pad)
    sx, sy = round(left * vw), round(top * vh)
    sw = max(1, round((right - left) * vw)); sh = max(1, round((bottom - top) * vh))
    if sw < 8 or sh < 8:
        return None
    scale = min(INPUT_W / sw, INPUT_H / sh)
    rw, rh = max(1, round(sw * scale)), max(1, round(sh * scale))
    padX, padY = (INPUT_W - rw) // 2, (INPUT_H - rh) // 2
    crop = frame_bgr[sy:sy + sh, sx:sx + sw]
    if crop.size == 0:
        return None
    resized = cv2.resize(crop, (rw, rh), interpolation=cv2.INTER_LINEAR)
    canvas = np.zeros((INPUT_H, INPUT_W, 3), np.uint8)
    canvas[padY:padY + rh, padX:padX + rw] = resized
    rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32)
    norm = (rgb - MEAN) / STD
    chw = np.transpose(norm, (2, 0, 1))[None]  # [1,3,H,W]
    xo, yo = sess.run([X_NAME, Y_NAME], {IN_NAME: chw})
    xo, yo = xo[0], yo[0]  # [K,Wx], [K,Wy]
    K = xo.shape[0]
    halpe = []
    for k in range(K):
        bx = int(np.argmax(xo[k])); by = int(np.argmax(yo[k]))
        mx, my = bx / SPLIT, by / SPLIT
        cx = (mx - padX) / max(1, rw); cy = (my - padY) / max(1, rh)
        x = left + cx * (right - left); y = top + cy * (bottom - top)
        v = float(np.clip((xo[k][bx] + yo[k][by]) / 2.0, 0.0, 1.0))
        halpe.append((min(1.0, max(0.0, x)), min(1.0, max(0.0, y)), v))
    pose = []
    for bp in range(33):
        hx, hy, hv = halpe[BP_FROM_HALPE[bp]]
        vis = hv * 0.5 if bp in APPROX_BP else hv
        pose.append({"x": round(hx, 4), "y": round(hy, 4), "z": 0.0,
                     "visibility": round(vis, 3)})
    return pose


def anchor_of(p):
    xs = [p[i]["x"] for i in (11, 12, 23, 24)]; ys = [p[i]["y"] for i in (11, 12, 23, 24)]
    return {"x": sum(xs) / 4, "y": sum(ys) / 4}


def run_clip(name):
    video, cand_file = CLIPS[name]
    vpath = os.path.join(ROOT, "public", "test-videos", video)
    cands = json.load(open(os.path.join(HERE, cand_file)))
    by_frame = {c["f"]: c for c in cands}
    cap = cv2.VideoCapture(vpath)
    out = []
    fi = 0
    fallbacks = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        entry = by_frame.get(fi)
        if entry is not None:
            new_cands = []
            for c in entry["candidates"]:
                box = bbox_of(c["pose"])
                pose = rtmpose_in_box(frame, box) if box else None
                if pose is None:
                    pose = c["pose"]  # fall back to MediaPipe, like the app
                    fallbacks += 1
                new_cands.append({"pose": pose, "anchor": anchor_of(pose),
                                  "scale": c["scale"], "color": c["color"]})
            out.append({"f": fi, "tMs": entry["tMs"], "candidates": new_cands})
        fi += 1
    cap.release()
    json.dump(out, open(os.path.join(HERE, f"v2_rtm_{name}.json"), "w"))
    return cands, out, fallbacks


# ---- metrics (mirror scripts/jointEval.mjs definitions) ----
ARMS = [(11, 13), (12, 14), (13, 15), (14, 16)]
LEGS = [(23, 25), (24, 26), (25, 27), (26, 28)]
SPAN_IDX = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]


def dist(a, b):
    return float(np.hypot(a["x"] - b["x"], a["y"] - b["y"]))


def scale_of(p):
    sw = dist(p[11], p[12]); hw = dist(p[23], p[24])
    th = (dist(p[11], p[23]) + dist(p[12], p[24])) / 2
    return max(0.08, sw, hw, th)


def metrics(stream):
    arm_ratios, leg_ratios = [], []
    exploded = 0
    poses = 0
    arm_big = leg_big = 0
    jit = []
    prev_by_slot = {}
    for entry in stream:
        for slot, c in enumerate(entry["candidates"]):
            p = c["pose"]
            poses += 1
            s = scale_of(p)
            for a, b in ARMS:
                r = dist(p[a], p[b]) / s
                arm_ratios.append(r)
                if r > 1.8:
                    arm_big += 1
            for a, b in LEGS:
                r = dist(p[a], p[b]) / s
                leg_ratios.append(r)
                if r > 1.8:
                    leg_big += 1
            span = 0.0
            for i in range(len(SPAN_IDX)):
                for j in range(i + 1, len(SPAN_IDX)):
                    span = max(span, dist(p[SPAN_IDX[i]], p[SPAN_IDX[j]]))
            if span / s > 4.5:
                exploded += 1
            # body-relative jitter vs same slot prev frame
            prev = prev_by_slot.get(slot)
            if prev is not None:
                pa, ca = anchor_of(prev), anchor_of(p)
                bdx, bdy = ca["x"] - pa["x"], ca["y"] - pa["y"]
                for idx in (13, 14, 15, 16, 25, 26, 27, 28, 0):
                    m = np.hypot((p[idx]["x"] - prev[idx]["x"]) - bdx,
                                 (p[idx]["y"] - prev[idx]["y"]) - bdy)
                    jit.append(m / scale_of(p))
            prev_by_slot[slot] = p
    pct = lambda arr, q: round(float(np.percentile(arr, q)), 3) if arr else 0.0
    return {
        "poses": poses,
        "exploded": exploded,
        "armP95": pct(arm_ratios, 95),
        "legP95": pct(leg_ratios, 95),
        "arm>1.8": arm_big,
        "leg>1.8": leg_big,
        "jitterP95": pct(jit, 95),
    }


def main():
    which = sys.argv[1:] or list(CLIPS.keys())
    print(f"{'clip':6} {'detector':9} {'poses':>5} {'expl':>5} {'armP95':>7} "
          f"{'legP95':>7} {'arm>1.8':>7} {'leg>1.8':>7} {'jitP95':>7}")
    print("-" * 72)
    for name in which:
        mp_cands, rtm_cands, fb = run_clip(name)
        mm = metrics(mp_cands); rm = metrics(rtm_cands)
        for label, m in (("mediapipe", mm), ("rtmpose", rm)):
            print(f"{name:6} {label:9} {m['poses']:>5} {m['exploded']:>5} "
                  f"{m['armP95']:>7} {m['legP95']:>7} {m['arm>1.8']:>7} "
                  f"{m['leg>1.8']:>7} {m['jitterP95']:>7}")
        print(f"{'':6} (rtmpose fell back to MediaPipe on {fb} boxes)")
        print("-" * 72)


if __name__ == "__main__":
    main()
