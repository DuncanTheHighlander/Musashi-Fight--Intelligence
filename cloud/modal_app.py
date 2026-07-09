"""Modal web endpoint for Musashi's heavy pose pass.

This wraps pose_pipeline.PosePipeline as a GPU-backed HTTP API. The app should
keep MediaPipe as the instant on-device preview; this endpoint is for uploaded
clips that need the slower, higher-quality dense pass.

Deploy:
  modal deploy cloud/modal_app.py

Test while developing:
  modal serve cloud/modal_app.py
  curl -X POST -F "video=@public/test-videos/slowmo-slip.mp4" \
    https://<modal-url>/analyze_pose
"""

from __future__ import annotations

import os
import sys
import tempfile
import time
from pathlib import Path

import modal

try:
    from fastapi import Request
except ModuleNotFoundError:  # Modal deploy imports this file before building the image.
    from typing import Any as Request

APP_ROOT = Path("/root/musashi")
MODEL_PATH = Path("/models/rtmpose-halpe26.onnx")
REMOTE_PIPELINE_PATH = "/root/musashi/cloud/pose_pipeline.py"
REMOTE_LIFTER_PATH = "/root/musashi/cloud/pose3d_lifter.py"
REMOTE_MODEL_PATH = "/models/rtmpose-halpe26.onnx"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("libglib2.0-0", "libgl1", "libgomp1")
    .pip_install(
        "fastapi[standard]>=0.115,<1",
        "mediapipe==0.10.21",
        "numpy<2",
        "onnxruntime-gpu>=1.20,<1.23",
        "opencv-python-headless>=4.10,<5",
    )
    .add_local_file("cloud/pose_pipeline.py", REMOTE_PIPELINE_PATH)
    .add_local_file("cloud/pose3d_lifter.py", REMOTE_LIFTER_PATH)
    .add_local_file("public/models/rtmpose-halpe26.onnx", REMOTE_MODEL_PATH)
)

app = modal.App("musashi-pose-api")
auth_secret = modal.Secret.from_local_environ(["POSE_API_TOKEN"])

_pipelines = {}


def _pipeline(use_rtmpose: bool):
    """Lazy-load the CV stack once per warm container."""
    key = "rtmpose" if use_rtmpose else "mediapipe"
    if key in _pipelines:
        return _pipelines[key]

    sys.path.insert(0, str(APP_ROOT / "cloud"))
    from pose_pipeline import PosePipeline

    providers = (
        ["CUDAExecutionProvider", "CPUExecutionProvider"]
        if use_rtmpose
        else ["CPUExecutionProvider"]
    )
    pipe = PosePipeline(str(MODEL_PATH), use_rtmpose=use_rtmpose, providers=providers)
    _pipelines[key] = pipe
    return pipe


def _bearer_token(headers) -> str | None:
    value = headers.get("authorization") or headers.get("Authorization")
    if not value:
        return None
    prefix = "Bearer "
    return value[len(prefix) :].strip() if value.startswith(prefix) else None


@app.function(
    image=image,
    secrets=[auth_secret],
    # L4 is the first production pick for RTMPose. T4 is a cheaper fallback
    # when L4 capacity is unavailable.
    gpu=["L4", "T4"],
    timeout=900,
    memory=4096,
    scaledown_window=120,
)
@modal.fastapi_endpoint(method="POST")
async def analyze_pose(request: Request):
    """POST multipart form-data with a `video` file.

    Optional fields:
      mode=mediapipe     -> run the same pipeline with MediaPipe-only fallback
      use_rtmpose=false  -> legacy alias for mode=mediapipe
      fps=30             -> fallback FPS when OpenCV cannot read container FPS

    Returns the per-frame candidate JSON consumed by Musashi's identity/tracking
    code, plus small metadata for logging.
    """
    from fastapi import HTTPException

    expected = os.environ.get("POSE_API_TOKEN")
    if expected and _bearer_token(request.headers) != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")

    form = await request.form()
    upload = form.get("video")
    if upload is None or not hasattr(upload, "read"):
        raise HTTPException(status_code=400, detail="Expected multipart field `video`")

    mode_raw = form.get("mode")
    if mode_raw is not None:
        mode = str(mode_raw).lower()
        if mode not in {"rtmpose", "mediapipe"}:
            raise HTTPException(status_code=400, detail="`mode` must be `rtmpose` or `mediapipe`")
        use_rtmpose = mode == "rtmpose"
    else:
        use_rtmpose_raw = str(form.get("use_rtmpose", "true")).lower()
        use_rtmpose = use_rtmpose_raw not in {"0", "false", "no", "off"}

    try:
        fps = float(form.get("fps", 30))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="`fps` must be numeric")

    suffix = Path(getattr(upload, "filename", "") or "clip.mp4").suffix or ".mp4"
    started = time.time()
    data = await upload.read()
    if not data:
        raise HTTPException(status_code=400, detail="Uploaded video is empty")

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp_path = tmp.name
        tmp.write(data)

    try:
        pipe = _pipeline(use_rtmpose)
        frames = pipe.process_video(tmp_path, fps=fps)
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass

    pose3d_frames = None
    lift3d_raw = str(form.get("lift3d", os.environ.get("MUSASHI_ENABLE_POSE_3D", "false"))).lower()
    lift3d_enabled = lift3d_raw in {"1", "true", "yes", "on"}
    if lift3d_enabled and use_rtmpose and frames:
        try:
            sys.path.insert(0, str(APP_ROOT / "cloud"))
            from pose3d_lifter import try_lift_pose3d

            pose3d_frames = try_lift_pose3d(frames, fps=fps, enabled=True)
        except Exception as exc:
            # Never fail the 2D response because 3D lifting failed.
            pose3d_frames = None
            print(f"[musashi-pose-api] 3D lift failed (2D-only): {exc}")

    candidate_frames = sum(1 for frame in frames if frame.get("candidates"))
    two_fighter_frames = sum(1 for frame in frames if len(frame.get("candidates", [])) >= 2)
    elapsed_ms = round((time.time() - started) * 1000)

    return {
        "version": "musashi-pose-api-v1",
        "backend": "rtmpose" if use_rtmpose else "mediapipe",
        "meta": {
            "frames": len(frames),
            "candidateFrames": candidate_frames,
            "twoFighterFrames": two_fighter_frames,
            "elapsedMs": elapsed_ms,
            "pose3DEnabled": pose3d_frames is not None,
        },
        "frames": frames,
        "pose3DFrames": pose3d_frames,
    }
