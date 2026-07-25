"""RTMPose (Halpe-26) keypoint decoding, independent of any detector.

Extracted verbatim from pose_pipeline.PosePipeline so the SAM 2.1 path can draw
keypoints without importing MediaPipe. Both pose_pipeline.py (MediaPipe boxes)
and sam_pipeline.py (SAM mask boxes) now share this one decoder.

Pre/post-processing is identical to src/lib/pose/rtmposeBackend.ts — the SimCC
split ratio, the ImageNet mean/std, the 5% box pad, and BP_FROM_HALPE must stay
in sync with that file. RTMPose speaks Halpe-26; the app speaks BlazePose-33, so
the mapping below is the only place that translation happens server-side.
"""
from __future__ import annotations

import numpy as np
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
# Joints RTMPose does not measure directly — derived from a neighbour, so their
# confidence is halved rather than inherited (matches rtmposeBackend.ts).
APPROX_BP = {9, 10, 17, 18, 19, 20, 21, 22}


class RtmPoseDecoder:
    """One ONNX session, reused for every box in every frame of a container."""

    def __init__(self, model_path: str, providers: list[str] | None = None):
        import cv2  # noqa: F401  (imported here so the module imports without OpenCV)

        provs = providers or ["CPUExecutionProvider"]
        self.sess = ort.InferenceSession(model_path, providers=provs)
        self.in_name = self.sess.get_inputs()[0].name
        outs = [o.name for o in self.sess.get_outputs()]
        self.x_name = next((n for n in outs if "x" in n.lower()), outs[0])
        self.y_name = next((n for n in outs if "y" in n.lower()), outs[1])

    def infer_in_box(self, frame_bgr, box):
        """box = (left, top, right, bottom) normalized 0-1. Returns 33 BlazePose
        landmarks in FULL-FRAME normalized coords, or None if the box is unusable."""
        import cv2

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
