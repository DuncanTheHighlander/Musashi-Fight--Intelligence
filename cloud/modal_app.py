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
import subprocess
import sys
import tempfile
import time
from urllib.parse import unquote
from pathlib import Path

import modal

try:
    from fastapi import Request
    from fastapi.responses import FileResponse
    from starlette.background import BackgroundTask
except ModuleNotFoundError:  # Modal deploy imports this file before building the image.
    from typing import Any as Request

APP_ROOT = Path("/root/musashi")
MODEL_PATH = Path("/models/rtmpose-halpe26.onnx")
REMOTE_PIPELINE_PATH = "/root/musashi/cloud/pose_pipeline.py"
REMOTE_LIFTER_PATH = "/root/musashi/cloud/pose3d_lifter.py"
REMOTE_MODEL_PATH = "/models/rtmpose-halpe26.onnx"

image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libglib2.0-0", "libgl1", "libgomp1")
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

# Keep the upload-critical transcode path independent from the GPU pose image.
# Loading MediaPipe, ONNX Runtime, and the RTMPose model made a cold video
# upload wait several minutes before FFmpeg could even start. This small image
# starts the normalizer promptly and has no model/GPU dependency.
normalizer_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install("fastapi[standard]>=0.115,<1")
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


def _cleanup_files(*paths: str) -> None:
    for path in paths:
        try:
            os.remove(path)
        except OSError:
            pass


def _probe_duration_sec(path: str) -> float:
    probe = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            path,
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if probe.returncode != 0:
        return 0.0
    try:
        return float(probe.stdout.strip())
    except (TypeError, ValueError):
        return 0.0


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


@app.function(
    image=normalizer_image,
    secrets=[auth_secret],
    timeout=900,
    memory=2048,
    scaledown_window=120,
)
@modal.fastapi_endpoint(method="POST")
async def normalize_video(request: Request):
    """Normalize a raw R2 video stream into a capped, mobile-safe MP4.

    The Worker sends the original R2 stream as the raw request body. This avoids
    browser canvas/MediaRecorder trimming and lets FFmpeg handle HEVC, VFR MOV,
    Android containers, and bad mobile timestamps consistently.
    """
    from fastapi import HTTPException

    expected = os.environ.get("POSE_API_TOKEN")
    if expected and _bearer_token(request.headers) != expected:
        raise HTTPException(status_code=401, detail="Unauthorized")

    try:
        max_sec = float(request.headers.get("x-musashi-max-sec", "0"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="x-musashi-max-sec must be numeric")
    if not 0 < max_sec <= 600:
        raise HTTPException(status_code=400, detail="x-musashi-max-sec must be between 0 and 600")

    try:
        requested_start_sec = float(request.headers.get("x-musashi-source-start-sec", "0"))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="x-musashi-source-start-sec must be numeric")
    # The Worker has already limited this value; keep a second boundary at the
    # processor and validate it against the real file below.
    if not 0 <= requested_start_sec <= 86_400:
        raise HTTPException(status_code=400, detail="x-musashi-source-start-sec must be between 0 and 86400")

    source_name = unquote(request.headers.get("x-musashi-source-name", "clip.mp4"))
    suffix = Path(source_name).suffix or ".mp4"
    input_path = ""
    output_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as source:
            input_path = source.name
            total = 0
            async for chunk in request.stream():
                if not chunk:
                    continue
                total += len(chunk)
                if total > 500 * 1024 * 1024:
                    raise HTTPException(status_code=413, detail="Source video exceeds 500 MB")
                source.write(chunk)
        if total <= 0:
            raise HTTPException(status_code=400, detail="Source video is empty")

        source_duration = _probe_duration_sec(input_path)
        if source_duration <= 0:
            raise HTTPException(status_code=422, detail="Could not read source video duration")
        # A stale UI timestamp must not make FFmpeg emit an empty clip. Normal
        # selections pass through unchanged; an out-of-range request safely
        # falls back to the beginning of the source.
        source_start_sec = requested_start_sec if requested_start_sec < source_duration else 0.0

        output_path = f"{input_path}.normalized.mp4"
        command = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            input_path,
            "-ss",
            f"{source_start_sec:.3f}",
            "-t",
            str(max_sec),
            "-map",
            "0:v:0",
            "-map",
            "0:a?",
            "-vf",
            "scale='min(1280,iw)':-2:force_divisible_by=2,fps=30,format=yuv420p",
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            output_path,
        ]
        encoded = subprocess.run(
            command,
            check=False,
            capture_output=True,
            text=True,
            timeout=780,
        )
        if encoded.returncode != 0 or not os.path.exists(output_path):
            detail = (encoded.stderr or "FFmpeg failed").replace("\n", " ")[:500]
            raise HTTPException(status_code=422, detail=detail)

        output_size = os.path.getsize(output_path)
        effective_duration = _probe_duration_sec(output_path)
        if output_size <= 0 or effective_duration <= 0 or effective_duration > max_sec + 0.25:
            raise HTTPException(status_code=422, detail="FFmpeg produced an invalid duration")

        _cleanup_files(input_path)
        return FileResponse(
            output_path,
            media_type="video/mp4",
            filename="normalized.mp4",
            headers={
                "X-Musashi-Output-Bytes": str(output_size),
                "X-Musashi-Effective-Duration-Sec": f"{effective_duration:.3f}",
                "X-Musashi-Source-Start-Sec": f"{source_start_sec:.3f}",
            },
            background=BackgroundTask(_cleanup_files, output_path),
        )
    except HTTPException:
        _cleanup_files(input_path, output_path)
        raise
    except subprocess.TimeoutExpired:
        _cleanup_files(input_path, output_path)
        raise HTTPException(status_code=504, detail="FFmpeg processing timed out")
    except Exception as exc:
        _cleanup_files(input_path, output_path)
        raise HTTPException(status_code=500, detail=f"Video normalization failed: {exc}")
