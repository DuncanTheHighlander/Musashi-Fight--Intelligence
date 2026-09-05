"""Person detection for SAM 2.1 seeding.

This replaces the MediaPipe seeding in pose_pipeline.py, which is the root cause
of the bystander lock documented in docs/AI_VISION_PIPELINE_AUDIT.md §5:
`mp.solutions.pose` returns exactly ONE pose per frame, biased toward the
largest, most camera-facing body, so in vertical phone video the foreground
spectator wins frame 0 and then owns a tracker slot for the whole clip.

A real multi-person detector returns EVERY person, so the choice of which two to
track becomes an explicit, reviewable decision (see score_fighters in
sam_pipeline.py) instead of an accident of who MediaPipe happened to like.

torchvision's Faster R-CNN is used rather than a bespoke ONNX export because
torch is already a hard requirement of SAM 2.1 — this adds no new runtime, no
letterbox/NMS code to get wrong, and its weights are BSD-3 licensed and fetched
by torchvision's own downloader when the Modal image is built.
"""
from __future__ import annotations

COCO_PERSON_LABEL = 1


class PersonDetector:
    """Loaded once per warm container; only ever run on a handful of seed frames."""

    def __init__(self, score_threshold: float = 0.7, device: str | None = None):
        import torch
        from torchvision.models.detection import (
            FasterRCNN_MobileNet_V3_Large_FPN_Weights,
            fasterrcnn_mobilenet_v3_large_fpn,
        )

        self.torch = torch
        self.score_threshold = score_threshold
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        weights = FasterRCNN_MobileNet_V3_Large_FPN_Weights.DEFAULT
        self.model = fasterrcnn_mobilenet_v3_large_fpn(weights=weights)
        self.model.eval().to(self.device)

    def detect(self, frame_bgr) -> list[dict]:
        """Return every person in the frame as normalized 0-1 boxes.

        [{"box": (left, top, right, bottom), "score": float}], best score first.
        """
        torch = self.torch
        h, w = frame_bgr.shape[:2]
        # torchvision detection models want float RGB in 0-1, CHW.
        rgb = frame_bgr[:, :, ::-1].copy()
        tensor = torch.from_numpy(rgb).permute(2, 0, 1).float().div_(255.0).to(self.device)

        with torch.inference_mode():
            output = self.model([tensor])[0]

        people = []
        boxes = output["boxes"].cpu().numpy()
        labels = output["labels"].cpu().numpy()
        scores = output["scores"].cpu().numpy()
        for box, label, score in zip(boxes, labels, scores):
            if int(label) != COCO_PERSON_LABEL or float(score) < self.score_threshold:
                continue
            x0, y0, x1, y1 = box
            people.append({
                "box": (
                    max(0.0, min(1.0, float(x0) / w)),
                    max(0.0, min(1.0, float(y0) / h)),
                    max(0.0, min(1.0, float(x1) / w)),
                    max(0.0, min(1.0, float(y1) / h)),
                ),
                "score": float(score),
            })
        people.sort(key=lambda p: p["score"], reverse=True)
        return people
