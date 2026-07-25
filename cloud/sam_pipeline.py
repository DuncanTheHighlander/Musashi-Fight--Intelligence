"""Musashi SAM 2.1 fighter tracking — identity first, keypoints second.

WHY THIS EXISTS
---------------
pose_pipeline.py derives fighter identity from pose detections, and that is
backwards. MediaPipe returns one pose per frame (the biggest body), its bbox is
latched into `prev_boxes`, and nothing can ever displace it — so a foreground
spectator who wins frame 0 gets a beautifully-refined RTMPose skeleton for the
rest of the clip (docs/AI_VISION_PIPELINE_AUDIT.md §5). Everything downstream —
the colour histograms, Kalman filters, claim gates and teleport guards in
src/lib/identityTracking.ts — is scaffolding trying to reconstruct identity that
was already destroyed at detection time.

SAM 2.1 has real object memory: prompt it once with a box and it tracks that
object through occlusion, motion blur and crossings, emitting a stable object id
per frame. So here identity is established ONCE, explicitly, and keypoints are
decoded inside boxes that are already identity-locked:

    detector (every person) -> score_fighters (pick 2) -> SAM 2.1 (stable ids)
      -> mask -> bbox -> RTMPose -> candidates tagged with trackId

The emitted JSON is the SAME ReplayInFrame contract src/lib/identityReplayCore.ts
already consumes, with one addition: `trackId` on each candidate. When every
frame carries it, the client skips heuristic A/B assignment entirely.

SAM 2.1 (Apache 2.0) is used rather than SAM 3, whose checkpoints are gated and
licensed for non-commercial research only. `track_objects` is the single seam to
swap if that ever changes.

No Modal dependency here on purpose — plain Python so it can be run locally.
"""
from __future__ import annotations

import json
import os
import tempfile

import cv2
import numpy as np

from rtmpose_decoder import RtmPoseDecoder

# Frames are written out for SAM at this long-edge size. SAM works at 1024
# internally, so larger costs memory and buys nothing.
SAM_LONG_EDGE = 1024
# Hard ceiling on tracked frames. The client caps a dense track at 1800 samples
# (DENSE_TRACK_MAX_SAMPLES in FightAnalyzer.tsx) and Modal's timeout is 900s.
MAX_FRAMES = 1800
# Seed frames are probed across the clip, not just frame 0 — fighters routinely
# walk in after the camera starts rolling.
SEED_PROBES = 5
# Gap used to measure per-box motion energy at seed time (~0.3s at 30fps).
MOTION_GAP_FRAMES = 9

NOSE, LS, RS, LH, RH = 0, 11, 12, 23, 24


def score_fighters(cands: list[dict]) -> list[dict]:
    """Bigger + more central + more motion = more fighter-like.

    Port of scoreFighters() in src/lib/pose/fighterSelection.ts — KEEP IN SYNC
    (same convention as BP_FROM_HALPE mirroring rtmposeBackend.ts). Size is
    weighted highest because the two fighters are almost always the largest
    bodies in frame; centrality and motion break ties and demote stationary
    background people near the edges.
    """
    areas = [max(0.0, c["box"][2] - c["box"][0]) * max(0.0, c["box"][3] - c["box"][1])
             for c in cands]
    max_area = max([1e-6] + areas)
    scored = []
    for i, c in enumerate(cands):
        area = areas[i] / max_area
        cx = (c["box"][0] + c["box"][2]) / 2
        cy = (c["box"][1] + c["box"][3]) / 2
        centrality = 1 - min(1.0, float(np.hypot(cx - 0.5, cy - 0.5)) / 0.7)
        motion = min(1.0, c["motion"] / 0.04) if c.get("motion") is not None else 0.5
        scored.append({
            "index": i,
            "score": area * 0.5 + centrality * 0.3 + motion * 0.2,
            "area": area,
            "centrality": centrality,
            "motion": motion,
        })
    return scored


def suggest_fighters(cands: list[dict]) -> list[int]:
    """Indices of the 2 likeliest fighters, best first."""
    if len(cands) <= 2:
        return list(range(len(cands)))
    ranked = sorted(score_fighters(cands), key=lambda s: s["score"], reverse=True)
    return [s["index"] for s in ranked[:2]]


# Small geometry helpers. pose_pipeline.py has equivalents as PosePipeline
# statics, but importing that module would drag MediaPipe into this path — the
# very dependency this pipeline exists to remove. They consolidate when
# MediaPipe leaves pose_pipeline.py.
def _anchor(p):
    xs = [p[i]["x"] for i in (LS, RS, LH, RH)]
    ys = [p[i]["y"] for i in (LS, RS, LH, RH)]
    return {"x": sum(xs) / 4, "y": sum(ys) / 4}


def _scale(p):
    sw = np.hypot(p[LS]["x"] - p[RS]["x"], p[LS]["y"] - p[RS]["y"])
    th = (np.hypot(p[LS]["x"] - p[LH]["x"], p[LS]["y"] - p[LH]["y"]) +
          np.hypot(p[RS]["x"] - p[RH]["x"], p[RS]["y"] - p[RH]["y"])) / 2
    return float(max(sw, th))


def _torso_color(frame, p, w, h):
    pts = np.array([[p[i]["x"] * w, p[i]["y"] * h] for i in (LS, RS, RH, LH)], np.int32)
    mask = np.zeros(frame.shape[:2], np.uint8)
    cv2.fillPoly(mask, [pts], 255)
    if mask.sum() == 0:
        return None
    b, g, r = cv2.mean(frame, mask)[:3]
    return {"torso": {"r": r / 255, "g": g / 255, "b": b / 255}}


def _mask_to_box(mask: np.ndarray) -> tuple[float, float, float, float] | None:
    """Tight normalized bbox around a boolean mask, or None if empty.

    This is where SAM's identity becomes a pose box. Unlike the pose-derived
    boxes it replaces, it cannot drift onto a neighbouring body: the mask is
    the object, so an occluded fighter yields an empty mask (an honest gap)
    rather than a box that has quietly slid onto whoever is still visible.
    """
    ys, xs = np.nonzero(mask)
    if xs.size == 0:
        return None
    h, w = mask.shape[:2]
    return (float(xs.min()) / w, float(ys.min()) / h,
            float(xs.max() + 1) / w, float(ys.max() + 1) / h)


class SamPipeline:
    """Loads the detector, SAM 2.1 and RTMPose once per warm container."""

    def __init__(self, rtmpose_model_path: str,
                 sam_model_id: str = "facebook/sam2.1-hiera-small",
                 providers: list[str] | None = None):
        import torch
        from sam2.sam2_video_predictor import SAM2VideoPredictor

        from detector import PersonDetector

        self.torch = torch
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.predictor = SAM2VideoPredictor.from_pretrained(sam_model_id, device=self.device)
        self.detector = PersonDetector()
        self.rtm = RtmPoseDecoder(rtmpose_model_path, providers)

    # ---- frame store ----
    @staticmethod
    def _extract_frames(path: str, out_dir: str) -> tuple[int, float, int, int]:
        """Decode to JPEGs (what SAM's init_state wants) and report geometry."""
        cap = cv2.VideoCapture(path)
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        count = 0
        out_w = out_h = 0
        while count < MAX_FRAMES:
            ok, frame = cap.read()
            if not ok:
                break
            h, w = frame.shape[:2]
            if max(w, h) > SAM_LONG_EDGE:
                s = SAM_LONG_EDGE / max(w, h)
                frame = cv2.resize(frame, (max(1, round(w * s)), max(1, round(h * s))))
            out_h, out_w = frame.shape[:2]
            cv2.imwrite(os.path.join(out_dir, f"{count:05d}.jpg"), frame)
            count += 1
        cap.release()
        return count, fps, out_w, out_h

    @staticmethod
    def _read_frame(frame_dir: str, idx: int):
        return cv2.imread(os.path.join(frame_dir, f"{idx:05d}.jpg"))

    # ---- seeding ----
    def _seed(self, frame_dir: str, total: int) -> tuple[int, list[tuple]]:
        """Pick the frame to prompt from, and the two fighter boxes in it.

        Probing several frames matters: seeding on frame 0 of a clip where the
        fighters have not yet engaged is how you end up tracking the referee.
        The frame that yields the most people is the most informative one to
        choose from, and ties break toward the earliest so tracking covers as
        much of the clip forward as possible.
        """
        best_idx, best_people = 0, []
        for probe in range(SEED_PROBES):
            idx = min(total - 1, round(probe * (total - 1) / max(1, SEED_PROBES - 1)))
            frame = self._read_frame(frame_dir, idx)
            if frame is None:
                continue
            people = self.detector.detect(frame)
            if len(people) > len(best_people):
                best_idx, best_people = idx, people
            if len(best_people) >= 2 and probe > 0:
                break

        if not best_people:
            return best_idx, []

        # Motion energy inside each box separates fighters from bystanders.
        later = self._read_frame(frame_dir, min(total - 1, best_idx + MOTION_GAP_FRAMES))
        base = self._read_frame(frame_dir, best_idx)
        if later is not None and base is not None and later.shape == base.shape:
            diff = cv2.absdiff(cv2.cvtColor(base, cv2.COLOR_BGR2GRAY),
                               cv2.cvtColor(later, cv2.COLOR_BGR2GRAY))
            h, w = diff.shape[:2]
            for p in best_people:
                x0, y0, x1, y1 = p["box"]
                region = diff[round(y0 * h):round(y1 * h), round(x0 * w):round(x1 * w)]
                p["motion"] = float(region.mean()) / 255.0 if region.size else 0.0

        chosen = suggest_fighters(best_people)
        return best_idx, [best_people[i]["box"] for i in chosen]

    # ---- tracking (the SAM 3 swap seam) ----
    def track_objects(self, frame_dir: str, seed_frame: int, seed_boxes: list[tuple],
                      width: int, height: int) -> dict[int, dict[int, np.ndarray]]:
        """{frame_idx: {obj_id: boolean mask}} for the whole clip.

        Propagates forward from the seed frame AND in reverse, so seeding mid
        clip still covers the frames before it.
        """
        torch = self.torch
        masks: dict[int, dict[int, np.ndarray]] = {}

        # bfloat16 needs Ampere or newer (L4 = sm_89). T4 is our capacity
        # fallback and is Turing (sm_75), where bf16 is unsupported — float16
        # there rather than letting the autocast blow up mid-clip.
        if self.device == "cuda":
            major = torch.cuda.get_device_capability()[0]
            autocast = torch.autocast("cuda", dtype=torch.bfloat16 if major >= 8 else torch.float16)
        else:
            autocast = torch.autocast("cpu", enabled=False)
        with torch.inference_mode(), autocast:
            state = self.predictor.init_state(
                frame_dir,
                offload_video_to_cpu=True,
                offload_state_to_cpu=True,
            )
            for obj_id, box in enumerate(seed_boxes, start=1):
                self.predictor.add_new_points_or_box(
                    state,
                    frame_idx=seed_frame,
                    obj_id=obj_id,
                    box=np.array([box[0] * width, box[1] * height,
                                  box[2] * width, box[3] * height], dtype=np.float32),
                )

            for reverse in (False, True):
                for frame_idx, obj_ids, logits in self.predictor.propagate_in_video(
                    state, start_frame_idx=seed_frame, reverse=reverse
                ):
                    per_obj = masks.setdefault(int(frame_idx), {})
                    for i, obj_id in enumerate(obj_ids):
                        per_obj[int(obj_id)] = (logits[i] > 0.0).cpu().numpy().squeeze()

        return masks

    # ---- public API ----
    def process_video(self, path: str, fps: float = 30.0) -> list[dict]:
        with tempfile.TemporaryDirectory() as frame_dir:
            total, container_fps, width, height = self._extract_frames(path, frame_dir)
            if total == 0:
                return []
            fps = container_fps or fps

            seed_frame, seed_boxes = self._seed(frame_dir, total)
            if not seed_boxes:
                # No people found at all — emit empty frames rather than
                # guessing, so the client's quality gate can grade it honestly.
                return [{"f": i, "tMs": round(i * 1000 / fps, 1), "candidates": []}
                        for i in range(total)]

            masks = self.track_objects(frame_dir, seed_frame, seed_boxes, width, height)

            results = []
            for i in range(total):
                frame = self._read_frame(frame_dir, i)
                per_obj = masks.get(i, {})
                cands = []
                for obj_id in sorted(per_obj):
                    box = _mask_to_box(per_obj[obj_id])
                    if box is None or frame is None:
                        continue
                    pose = self.rtm.infer_in_box(frame, box)
                    if pose is None:
                        continue
                    cands.append({
                        "pose": pose,
                        "anchor": _anchor(pose),
                        "scale": _scale(pose),
                        "color": _torso_color(frame, pose, width, height),
                        # The whole point: identity comes from the tracker, not
                        # from a client-side guess about colour and shape.
                        "trackId": obj_id,
                    })
                results.append({"f": i, "tMs": round(i * 1000 / fps, 1), "candidates": cands})
            return results


if __name__ == "__main__":
    import sys
    import time

    vid = sys.argv[1] if len(sys.argv) > 1 else "public/test-videos/slowmo-slip.mp4"
    model = sys.argv[2] if len(sys.argv) > 2 else "public/models/rtmpose-halpe26.onnx"
    t0 = time.time()
    pipe = SamPipeline(model)
    out = pipe.process_video(vid)
    dt = time.time() - t0
    twop = sum(1 for r in out if len(r["candidates"]) == 2)
    print(f"frames={len(out)} 2-fighter={twop} time={dt:.1f}s "
          f"({len(out)/max(dt,0.01):.1f} fps)")
    json.dump(out, open("cloud/_sam_smoketest_out.json", "w"))
    print("wrote cloud/_sam_smoketest_out.json")
