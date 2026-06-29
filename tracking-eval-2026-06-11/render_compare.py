"""Render a side-by-side skeleton comparison video: checkpoint MediaPipe (left)
vs RTMPose (right), drawn on the same clip frames. Lets you SEE the jitter
difference that the metrics report — jitter is motion, so it needs video.

Usage: python render_compare.py clip3   ->  compare_clip3.mp4
"""
import sys, os, json
import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
CLIPS = {
    "clip1": ("test-video-for-app.mp4", "v2_0_400.json"),
    "clip2": ("clip2-overlap.mp4", "v2_0_683.json"),
    "clip3": ("slowmo-slip.mp4", "v2_clip3.json"),
}
# BlazePose-33 bones (the joints the app actually analyses)
BONES = [
    (11, 12), (11, 23), (12, 24), (23, 24),         # torso
    (11, 13), (13, 15), (12, 14), (14, 16),         # arms
    (23, 25), (25, 27), (27, 29), (29, 31),         # left leg + foot
    (24, 26), (26, 28), (28, 30), (30, 32),         # right leg + foot
    (0, 11), (0, 12),                               # neck-ish
]


def draw_pose(img, pose, w, h, color):
    for a, b in BONES:
        pa, pb = pose[a], pose[b]
        if pa["visibility"] < 0.2 or pb["visibility"] < 0.2:
            continue
        x1, y1 = int(pa["x"] * w), int(pa["y"] * h)
        x2, y2 = int(pb["x"] * w), int(pb["y"] * h)
        cv2.line(img, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)
    for p in pose:
        if p["visibility"] < 0.2:
            continue
        cv2.circle(img, (int(p["x"] * w), int(p["y"] * h)), 3, color, -1, cv2.LINE_AA)


def label(img, text, color):
    cv2.rectangle(img, (0, 0), (img.shape[1], 28), (20, 20, 20), -1)
    cv2.putText(img, text, (10, 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2, cv2.LINE_AA)


def main():
    name = sys.argv[1] if len(sys.argv) > 1 else "clip3"
    video, mp_file = CLIPS[name]
    mp = {c["f"]: c for c in json.load(open(os.path.join(HERE, mp_file)))}
    rtm = {c["f"]: c for c in json.load(open(os.path.join(HERE, f"v2_rtm_{name}.json")))}
    cap = cv2.VideoCapture(os.path.join(ROOT, "public", "test-videos", video))
    w = int(cap.get(3)); h = int(cap.get(4)); fps = cap.get(5) or 30
    out_path = os.path.join(HERE, f"compare_{name}.mp4")
    vw = cv2.VideoWriter(out_path, cv2.VideoWriter_fourcc(*"mp4v"), fps, (w * 2, h))
    MP_COLOR = (80, 200, 255)   # amber-ish (BGR)
    RTM_COLOR = (120, 255, 120)  # green (BGR)
    fi = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        left = (frame * 0.45).astype(np.uint8)
        right = left.copy()
        for c in mp.get(fi, {}).get("candidates", []):
            draw_pose(left, c["pose"], w, h, MP_COLOR)
        for c in rtm.get(fi, {}).get("candidates", []):
            draw_pose(right, c["pose"], w, h, RTM_COLOR)
        label(left, "CHECKPOINT (MediaPipe)", MP_COLOR)
        label(right, "RTMPose", RTM_COLOR)
        vw.write(np.hstack([left, right]))
        fi += 1
    cap.release(); vw.release()
    print(f"wrote {out_path}  ({fi} frames, {w*2}x{h})")


if __name__ == "__main__":
    main()
