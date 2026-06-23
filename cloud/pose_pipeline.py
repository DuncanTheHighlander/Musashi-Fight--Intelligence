"""Musashi cloud pose pipeline — the heavy CV that belongs on a GPU server.

Input:  a video file.
Output: the SAME per-frame candidate JSON the app's TS pipeline already consumes
        (identity tracking, smoothing, ledger all stay client-side / on-device).

Detection mirrors tracking-eval-2026-06-11/detect_v2.py (proven MediaPipe crop-zoom
two-fighter localisation). The pose inside each fighter box is then refined with
RTMPose (rtmpose-halpe26.onnx) — identical pre/post-processing to
src/lib/pose/rtmposeBackend.ts. This is exactly the MediaPipe-box + RTMPose-pose
fusion the app does, lifted server-side so phones never run the model.

No Modal dependency here on purpose — this module is plain Python so it can be
unit-tested locally. modal_app.py imports it and wraps it as the GPU endpoint.
"""
from __future__ import annotations
import json
import numpy as np
import cv2
import mediapipe as mp
import onnxruntime as ort

# ---- RTMPose config (mirrors rtmposeBackend.ts) ----
INPUT_W, INPUT_H = 192, 256
SPLIT = 2.0
MEAN = np.array([123.675, 116.28, 103.53], np.float32)
STD = np.array([58.395, 57.12, 57.375], np.float32)
H = dict(nose=0, Leye=1, Reye=2, Lear=3, Rear=4, Lsho=5, Rsho=6, Lelb=7, Relb=8,
         Lwri=9, Rwri=10, Lhip=11, Rhip=12, Lkne=13, Rkne=14, Lank=15, Rank=16,
         LbigToe=20, RbigToe=21, Lheel=24, Rheel=25)
BP_FROM_HALPE = [
    H["nose"], H["Leye"], H["Leye"], H["Leye"], H["Reye"], H["Reye"], H["Reye"],
    H["Lear"], H["Rear"], H["nose"], H["nose"], H["Lsho"], H["Rsho"], H["Lelb"],
    H["Relb"], H["Lwri"], H["Rwri"], H["Lwri"], H["Rwri"], H["Lwri"], H["Rwri"],
    H["Lwri"], H["Rwri"], H["Lhip"], H["Rhip"], H["Lkne"], H["Rkne"], H["Lank"],
    H["Rank"], H["Lheel"], H["Rheel"], H["LbigToe"], H["RbigToe"],
]
APPROX_BP = {9, 10, 17, 18, 19, 20, 21, 22}
NOSE, LS, RS, LH, RH = 0, 11, 12, 23, 24


class PosePipeline:
    """Loads RTMPose + MediaPipe once (per container) and reuses across requests."""

    def __init__(self, model_path: str, use_rtmpose: bool = True,
                 providers: list[str] | None = None):
        self.use_rtmpose = use_rtmpose
        mp_pose = mp.solutions.pose
        self.full = mp_pose.Pose(static_image_mode=True, model_complexity=1,
                                 min_detection_confidence=0.35)
        self.retry = mp_pose.Pose(static_image_mode=True, model_complexity=1,
                                  min_detection_confidence=0.12)
        self.crop = mp_pose.Pose(static_image_mode=True, model_complexity=1,
                                 min_detection_confidence=0.30)
        if use_rtmpose:
            provs = providers or ["CPUExecutionProvider"]
            self.sess = ort.InferenceSession(model_path, providers=provs)
            self.in_name = self.sess.get_inputs()[0].name
            outs = [o.name for o in self.sess.get_outputs()]
            self.x_name = next((n for n in outs if "x" in n.lower()), outs[0])
            self.y_name = next((n for n in outs if "y" in n.lower()), outs[1])

    # ---- helpers (from detect_v2.py) ----
    @staticmethod
    def _lm_list(lms):
        return [{"x": round(l.x, 4), "y": round(l.y, 4), "z": round(l.z, 4),
                 "visibility": round(l.visibility, 3)} for l in lms]

    @staticmethod
    def _anchor(p):
        xs = [p[i]["x"] for i in (LS, RS, LH, RH)]
        ys = [p[i]["y"] for i in (LS, RS, LH, RH)]
        return {"x": sum(xs) / 4, "y": sum(ys) / 4}

    @staticmethod
    def _scale(p):
        sw = np.hypot(p[LS]["x"] - p[RS]["x"], p[LS]["y"] - p[RS]["y"])
        th = (np.hypot(p[LS]["x"] - p[LH]["x"], p[LS]["y"] - p[LH]["y"]) +
              np.hypot(p[RS]["x"] - p[RH]["x"], p[RS]["y"] - p[RH]["y"])) / 2
        return float(max(sw, th))

    @staticmethod
    def _bbox(p, vis_th=0.3):
        vis = [l for l in p if l["visibility"] > vis_th]
        if not vis:
            return None
        return (min(l["x"] for l in vis), min(l["y"] for l in vis),
                max(l["x"] for l in vis), max(l["y"] for l in vis))

    @staticmethod
    def _overlap(b1, b2):
        if not b1 or not b2:
            return 0.0
        ix = max(0, min(b1[2], b2[2]) - max(b1[0], b2[0]))
        iy = max(0, min(b1[3], b2[3]) - max(b1[1], b2[1]))
        a1 = (b1[2] - b1[0]) * (b1[3] - b1[1]); a2 = (b2[2] - b2[0]) * (b2[3] - b2[1])
        return ix * iy / max(1e-6, min(a1, a2))

    @staticmethod
    def _torso_color(frame, p, w, h):
        pts = np.array([[p[i]["x"] * w, p[i]["y"] * h] for i in (LS, RS, RH, LH)], np.int32)
        mask = np.zeros(frame.shape[:2], np.uint8)
        cv2.fillPoly(mask, [pts], 255)
        if mask.sum() == 0:
            return None
        b, g, r = cv2.mean(frame, mask)[:3]
        return {"torso": {"r": r / 255, "g": g / 255, "b": b / 255}}

    def _mask_person(self, rgb, p, w, h):
        vis = [l for l in p if l["visibility"] > 0.3]
        if not vis:
            return rgb
        x0 = max(0, int(min(l["x"] for l in vis) * w) - 8)
        x1 = min(w, int(max(l["x"] for l in vis) * w) + 8)
        y0 = max(0, int(min(l["y"] for l in vis) * h) - 8)
        y1 = min(h, int(max(l["y"] for l in vis) * h) + 8)
        out = rgb.copy(); out[y0:y1, x0:x1] = 128
        return out

    def _crop_detect(self, rgb, box, w, h):
        x0, y0, x1, y1 = box
        pw, ph = (x1 - x0) * 0.35 + 0.02, (y1 - y0) * 0.20 + 0.02
        cx0 = max(0, int((x0 - pw) * w)); cx1 = min(w, int((x1 + pw) * w))
        cy0 = max(0, int((y0 - ph) * h)); cy1 = min(h, int((y1 + ph) * h))
        if cx1 - cx0 < 40 or cy1 - cy0 < 40:
            return None
        res = self.crop.process(rgb[cy0:cy1, cx0:cx1])
        if not res.pose_landmarks:
            return None
        cw, ch = cx1 - cx0, cy1 - cy0
        return [{"x": round((cx0 + l.x * cw) / w, 4),
                 "y": round((cy0 + l.y * ch) / h, 4),
                 "z": round(l.z, 4), "visibility": round(l.visibility, 3)}
                for l in res.pose_landmarks.landmark]

    def _rtmpose_in_box(self, frame_bgr, box):
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
        canvas = np.zeros((INPUT_H, INPUT_W, 3), np.uint8)
        canvas[padY:padY + rh, padX:padX + rw] = cv2.resize(crop, (rw, rh))
        rgb = cv2.cvtColor(canvas, cv2.COLOR_BGR2RGB).astype(np.float32)
        chw = np.transpose((rgb - MEAN) / STD, (2, 0, 1))[None]
        xo, yo = self.sess.run([self.x_name, self.y_name], {self.in_name: chw})
        xo, yo = xo[0], yo[0]
        halpe = []
        for k in range(xo.shape[0]):
            bx = int(np.argmax(xo[k])); by = int(np.argmax(yo[k]))
            cx = (bx / SPLIT - padX) / max(1, rw); cy = (by / SPLIT - padY) / max(1, rh)
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

    def process_video(self, path: str, fps: float = 30.0) -> list[dict]:
        cap = cv2.VideoCapture(path)
        fps = cap.get(cv2.CAP_PROP_FPS) or fps
        results = []
        prev_boxes = []
        fi = 0
        while True:
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            # 1. full-frame seeds
            seeds = []
            r1 = self.full.process(rgb)
            if r1.pose_landmarks:
                s1 = self._lm_list(r1.pose_landmarks.landmark)
                seeds.append(s1)
                r2 = self.retry.process(self._mask_person(rgb, s1, w, h))
                if r2.pose_landmarks:
                    seeds.append(self._lm_list(r2.pose_landmarks.landmark))
            # 2. stable per-fighter boxes
            boxes = list(prev_boxes)
            for s in seeds:
                b = self._bbox(s)
                if b and all(self._overlap(b, pb) < 0.55 for pb in boxes):
                    boxes.append(b)
            boxes = boxes[:2]
            # 3. MediaPipe crop pose per box (this also gives the box + fallback)
            cands = []
            for b in boxes:
                cl = self._crop_detect(rgb, b, w, h)
                if cl is not None:
                    cands.append(cl)
            if len(cands) == 2 and self._overlap(self._bbox(cands[0]), self._bbox(cands[1])) > 0.85:
                cands = [cands[0]]
            for s in seeds:
                if len(cands) >= 2:
                    break
                sb = self._bbox(s)
                if sb and all(self._overlap(sb, self._bbox(c)) < 0.55 for c in cands if self._bbox(c)):
                    cands.append(s)
            # 4. refine each candidate's pose with RTMPose (box from MediaPipe)
            out_cands = []
            for c in cands:
                box = self._bbox(c)
                pose = c
                if self.use_rtmpose and box:
                    refined = self._rtmpose_in_box(frame, box)
                    if refined is not None:
                        pose = refined
                out_cands.append({"pose": pose, "anchor": self._anchor(pose),
                                  "scale": self._scale(pose),
                                  "color": self._torso_color(frame, pose, w, h)})
            prev_boxes = [self._bbox(c["pose"]) for c in out_cands if self._bbox(c["pose"])]
            results.append({"f": fi, "tMs": round(fi * 1000 / fps, 1), "candidates": out_cands})
            fi += 1
        cap.release()
        return results


if __name__ == "__main__":
    import sys, os, time
    vid = sys.argv[1] if len(sys.argv) > 1 else "public/test-videos/slowmo-slip.mp4"
    model = sys.argv[2] if len(sys.argv) > 2 else "public/models/rtmpose-halpe26.onnx"
    t0 = time.time()
    pipe = PosePipeline(model, use_rtmpose=True)
    out = pipe.process_video(vid)
    dt = time.time() - t0
    twop = sum(1 for r in out if len(r["candidates"]) == 2)
    print(f"frames={len(out)} 2-fighter={twop} time={dt:.1f}s "
          f"({len(out)/max(dt,0.01):.1f} fps)")
    json.dump(out, open("cloud/_smoketest_out.json", "w"))
    print("wrote cloud/_smoketest_out.json")
