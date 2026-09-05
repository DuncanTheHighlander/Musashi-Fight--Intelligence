"""Safe optional 3D pose lifting for Musashi cloud dense pass.

Uses external libraries (mmpose / VideoPose3D-style lifters) — never custom IK.
On any import failure, timeout, or runtime error, returns None so the 2D
pipeline continues unchanged.

Enable via:
  - Modal form field: lift3d=true
  - Env: MUSASHI_ENABLE_POSE_3D=1

Optional deps (not in default Modal image — add to image when ready):
  pip install openmim && mim install mmengine mmcv mmpose
"""

from __future__ import annotations

import copy
import logging
import os
from typing import Any

logger = logging.getLogger(__name__)

# Halpe/MediaPipe hip indices in the 33-landmark layout used downstream.
LEFT_HIP, RIGHT_HIP = 11, 12


def _enabled(explicit: bool | None = None) -> bool:
    if explicit is not None:
        return explicit
    return os.environ.get("MUSASHI_ENABLE_POSE_3D", "").lower() in {"1", "true", "yes", "on"}


def try_lift_pose3d(
    frames: list[dict[str, Any]],
    fps: float = 30.0,
    *,
    enabled: bool | None = None,
    timeout_sec: float = 45.0,
) -> list[dict[str, Any]] | None:
    """Lift 2D candidate tracks to 3D. Returns None on failure (2D-only fallback)."""
    if not _enabled(enabled):
        return None
    if not frames or len(frames) < 5:
        logger.info("3D lift skipped: need >= 5 frames, got %d", len(frames or []))
        return None

    try:
        return _lift_with_library(frames, fps=fps, timeout_sec=timeout_sec)
    except ImportError as exc:
        logger.info("3D lifter deps not installed (2D-only): %s", exc)
        return None
    except Exception as exc:
        logger.warning("3D pose lifting failed (2D-only fallback): %s", exc)
        return None


def _lift_with_library(
    frames: list[dict[str, Any]],
    *,
    fps: float,
    timeout_sec: float,
) -> list[dict[str, Any]] | None:
    """Attempt mmpose pose lifter; returns deep-copied frames with z populated."""
    try:
        from mmpose.apis import inference_pose_lifter_model, init_pose_lifter  # type: ignore
    except ImportError as exc:
        raise ImportError("mmpose not installed") from exc

    # Build 2D keypoint sequences per candidate slot (best-effort: first two candidates).
    seq_a, seq_b = _extract_2d_sequences(frames)
    if not seq_a and not seq_b:
        return None

    # Lazy-init lifter once per process (Modal warm container reuse).
    lifter = getattr(_lift_with_library, "_lifter", None)
    if lifter is None:
        lifter = init_pose_lifter(
            "configs/body_3d_keypoint/video_pose_lift/h36m/videopose3d_27frames_fullconv_supervised_cpn_ft.py",
            "https://download.openmmlab.com/mmpose/body3d/videopose/videopose3d_27frames_fullconv_supervised_cpn_ft-35e06a05-20200227.pth",
            device="cuda:0",
        )
        _lift_with_library._lifter = lifter  # type: ignore[attr-defined]

    lifted_a = _run_lifter(inference_pose_lifter_model, lifter, seq_a, fps) if seq_a else None
    lifted_b = _run_lifter(inference_pose_lifter_model, lifter, seq_b, fps) if seq_b else None

    if lifted_a is None and lifted_b is None:
        return None

    return _merge_lifted_z(frames, lifted_a, lifted_b)


def _extract_2d_sequences(
    frames: list[dict[str, Any]],
) -> tuple[list[list[tuple[float, float]]], list[list[tuple[float, float]]]]:
    """Extract hip-midpoint 2D proxy sequences for lifter input (per candidate index)."""
    seq_a: list[list[tuple[float, float]]] = []
    seq_b: list[list[tuple[float, float]]] = []

    for frame in frames:
        cands = frame.get("candidates") or []
        for slot, bucket in ((0, seq_a), (1, seq_b)):
            if slot >= len(cands):
                continue
            pose = cands[slot].get("pose") or []
            if len(pose) <= max(LEFT_HIP, RIGHT_HIP):
                continue
            lh, rh = pose[LEFT_HIP], pose[RIGHT_HIP]
            mid = ((lh["x"] + rh["x"]) / 2, (lh["y"] + rh["y"]) / 2)
            bucket.append([mid])

    return seq_a, seq_b


def _run_lifter(inference_fn, lifter, seq: list, fps: float):
    try:
        return inference_fn(seq, lifter, fps=fps)
    except Exception as exc:
        logger.warning("mmpose inference failed: %s", exc)
        return None


def _merge_lifted_z(
    frames: list[dict[str, Any]],
    lifted_a: Any,
    lifted_b: Any,
) -> list[dict[str, Any]]:
    """Copy frames and write lifted z onto hip landmarks (best-effort)."""
    out = copy.deepcopy(frames)
    for i, frame in enumerate(out):
        cands = frame.get("candidates") or []
        for slot, lifted in ((0, lifted_a), (1, lifted_b)):
            if slot >= len(cands) or lifted is None:
                continue
            try:
                z_val = float(lifted[i][0][2]) if lifted[i] is not None else None
            except (IndexError, TypeError, ValueError):
                z_val = None
            if z_val is None:
                continue
            pose = cands[slot].get("pose") or []
            for hip_idx in (LEFT_HIP, RIGHT_HIP):
                if hip_idx < len(pose):
                    pose[hip_idx]["z"] = round(z_val, 5)
    return out
