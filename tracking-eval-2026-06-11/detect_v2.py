"""Crop-zoomed two-fighter pose extraction (complexity 1, per-fighter crops).

Full-frame pass finds bodies; each body is then re-detected on a padded,
zoomed crop so MediaPipe sees ~4x the pixels per fighter -> tighter landmarks.
Crops follow the previous frame's boxes so detection stays locked per fighter.

Usage: detect_v2.py <start> <end>   -> v2_<start>_<end>.json
"""
import sys, json
import cv2
import numpy as np
import mediapipe as mp

mp_pose = mp.solutions.pose
START, END = int(sys.argv[1]), int(sys.argv[2])
NOSE, LS, RS, LH, RH = 0, 11, 12, 23, 24

full_pose = mp_pose.Pose(static_image_mode=True, model_complexity=1,
                         min_detection_confidence=0.35)
retry_pose = mp_pose.Pose(static_image_mode=True, model_complexity=1,
                          min_detection_confidence=0.12)
crop_pose = mp_pose.Pose(static_image_mode=True, model_complexity=1,
                         min_detection_confidence=0.30)

def lm_list(lms):
    return [{"x": round(l.x, 4), "y": round(l.y, 4), "z": round(l.z, 4),
             "visibility": round(l.visibility, 3)} for l in lms]

def anchor_of(lms):
    xs = [lms[i]["x"] for i in (LS, RS, LH, RH)]
    ys = [lms[i]["y"] for i in (LS, RS, LH, RH)]
    return {"x": sum(xs) / 4, "y": sum(ys) / 4}

def scale_of(lms):
    sw = np.hypot(lms[LS]["x"] - lms[RS]["x"], lms[LS]["y"] - lms[RS]["y"])
    th = (np.hypot(lms[LS]["x"] - lms[LH]["x"], lms[LS]["y"] - lms[LH]["y"]) +
          np.hypot(lms[RS]["x"] - lms[RH]["x"], lms[RS]["y"] - lms[RH]["y"])) / 2
    return float(max(sw, th))

def torso_color(frame, lms, w, h):
    pts = np.array([[lms[i]["x"] * w, lms[i]["y"] * h] for i in (LS, RS, RH, LH)], np.int32)
    mask = np.zeros(frame.shape[:2], np.uint8)
    cv2.fillPoly(mask, [pts], 255)
    if mask.sum() == 0:
        return None
    b, g, r = cv2.mean(frame, mask)[:3]
    mid_y = int(np.clip((lms[LS]["y"] + lms[LH]["y"]) / 2 * h, 0, h - 1))
    upper = mask.copy(); upper[mid_y:, :] = 0
    lower = mask.copy(); lower[:mid_y, :] = 0
    def mean_rgb(m):
        if m.sum() == 0: return None
        bb, gg, rr = cv2.mean(frame, m)[:3]
        return {"r": rr / 255, "g": gg / 255, "b": bb / 255}
    return {"torso": {"r": r / 255, "g": g / 255, "b": b / 255},
            "upper": mean_rgb(upper), "lower": mean_rgb(lower)}

def bbox_of(lms, vis_th=0.3):
    vis = [l for l in lms if l["visibility"] > vis_th]
    if not vis: return None
    return (min(l["x"] for l in vis), min(l["y"] for l in vis),
            max(l["x"] for l in vis), max(l["y"] for l in vis))

def crop_detect(rgb, box, w, h):
    """Re-detect on a padded crop; return landmarks mapped to full-frame coords."""
    x0, y0, x1, y1 = box
    pw, ph = (x1 - x0) * 0.35 + 0.02, (y1 - y0) * 0.20 + 0.02
    cx0 = max(0, int((x0 - pw) * w)); cx1 = min(w, int((x1 + pw) * w))
    cy0 = max(0, int((y0 - ph) * h)); cy1 = min(h, int((y1 + ph) * h))
    if cx1 - cx0 < 40 or cy1 - cy0 < 40: return None
    crop = rgb[cy0:cy1, cx0:cx1]
    res = crop_pose.process(crop)
    if not res.pose_landmarks: return None
    cw, ch = cx1 - cx0, cy1 - cy0
    out = []
    for l in res.pose_landmarks.landmark:
        out.append({"x": round((cx0 + l.x * cw) / w, 4),
                    "y": round((cy0 + l.y * ch) / h, 4),
                    "z": round(l.z, 4), "visibility": round(l.visibility, 3)})
    return out

def mask_person(rgb, lms, w, h):
    vis = [l for l in lms if l["visibility"] > 0.3]
    if not vis: return rgb
    x0 = max(0, int(min(l["x"] for l in vis) * w) - 8)
    x1 = min(w, int(max(l["x"] for l in vis) * w) + 8)
    y0 = max(0, int(min(l["y"] for l in vis) * h) - 8)
    y1 = min(h, int(max(l["y"] for l in vis) * h) + 8)
    out = rgb.copy(); out[y0:y1, x0:x1] = 128
    return out

def overlap(b1, b2):
    if not b1 or not b2: return 0.0
    ix = max(0, min(b1[2], b2[2]) - max(b1[0], b2[0]))
    iy = max(0, min(b1[3], b2[3]) - max(b1[1], b2[1]))
    a1 = (b1[2]-b1[0])*(b1[3]-b1[1]); a2 = (b2[2]-b2[0])*(b2[3]-b2[1])
    return ix*iy / max(1e-6, min(a1, a2))

cap = cv2.VideoCapture("clip.mp4")
cap.set(cv2.CAP_PROP_POS_FRAMES, START)
results = []
prev_boxes = []
fi = START
while fi < END:
    ok, frame = cap.read()
    if not ok: break
    h, w = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    # 1. full-frame seeds (find bodies / new entrants)
    seeds = []
    r1 = full_pose.process(rgb)
    if r1.pose_landmarks:
        s1 = lm_list(r1.pose_landmarks.landmark)
        seeds.append(s1)
        r2 = retry_pose.process(mask_person(rgb, s1, w, h))
        if r2.pose_landmarks:
            seeds.append(lm_list(r2.pose_landmarks.landmark))

    # 2. crop boxes: previous-frame boxes win (stable per-fighter zoom),
    #    seed boxes fill in when prev is missing
    boxes = list(prev_boxes)
    for s in seeds:
        b = bbox_of(s)
        if b and all(overlap(b, pb) < 0.55 for pb in boxes):
            boxes.append(b)
    boxes = boxes[:2]

    # 3. zoomed re-detection per box; fall back to the seed if crop fails
    cands_lms = []
    for b in boxes:
        cl = crop_detect(rgb, b, w, h)
        if cl is not None:
            cands_lms.append(cl)
    # de-dup crops that landed on the same body
    if len(cands_lms) == 2:
        b1, b2 = bbox_of(cands_lms[0]), bbox_of(cands_lms[1])
        if overlap(b1, b2) > 0.85:
            cands_lms = [cands_lms[0]]
    # fill from seeds if crops missed someone
    for s in seeds:
        if len(cands_lms) >= 2: break
        sb = bbox_of(s)
        if sb and all(overlap(sb, bbox_of(c)) < 0.55 for c in cands_lms if bbox_of(c)):
            cands_lms.append(s)

    prev_boxes = [bbox_of(c) for c in cands_lms if bbox_of(c)]
    results.append({
        "f": fi, "tMs": round(fi * 1000 / 30, 1),
        "candidates": [{
            "pose": c, "anchor": anchor_of(c), "scale": scale_of(c),
            "color": torso_color(frame, c, w, h),
        } for c in cands_lms],
    })
    fi += 1

cap.release()
json.dump(results, open(f"v2_{START}_{END}.json", "w"))
counts = [len(r["candidates"]) for r in results]
print(f"frames {START}-{fi}: 2p {counts.count(2)}, 1p {counts.count(1)}, 0p {counts.count(0)}")
