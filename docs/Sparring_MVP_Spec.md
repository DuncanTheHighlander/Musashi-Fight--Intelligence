# Sparring Intelligence Core (Novel Feedback Engine) — MVP Spec

## Goal
Build the minimum viable **offline sparring intelligence** engine that produces **defensible, evidence-backed feedback** from uploaded sparring video.

**Non-goals (explicit):** social features, billing, real-time voice, ML training, “LLM as truth.”

**Key constraint:** Every claim in the report must be traceable to a measurable signal derived from **MediaPipe Pose** (plus simple geometry/time).

---

## MVP Output (exact)
The MVP produces one JSON report per uploaded video:

1. **Exchange Timeline**
   - A sequence of time-bounded “exchanges” (segments) with per-exchange metrics.
   - Each exchange includes:
     - `startMs`, `endMs`, `durationMs`
     - participants (A/B)
     - high-level phase label (e.g., `approach`, `engaged`, `break`)
     - measurable per-exchange signals (distance, closing speed, punch attempt counts, guard drops, etc.)

2. **Three Pattern Findings (exactly 3)**
   - Top 3 most confident recurring patterns from a small vocabulary (max 10).
   - Each finding includes:
     - pattern id
     - evidence: list of timestamps/exchanges where it occurred
     - confidence score
     - **traceability**: the exact signals, thresholds, and counts used

3. **Timestamps + Confidence Scores**
   - Every pattern evidence item is anchored to:
     - `exchangeId`
     - `startMs`/`endMs` (or `eventMs`)
   - Confidence is numeric and computed from rule-based reliability factors (no ML).

---

## Signal Pipeline (no training)

### Inputs
- **Video** (offline upload)
- **MediaPipe Pose** per frame for each detected person:
  - 2D keypoints (x,y) + visibility
  - optional 3D (if available)
  - timestamp per frame

### Preprocessing
- **Frame filtering:** discard keypoints with low visibility (e.g., `< 0.5`) and mark frame/person as low-quality.
- **Smoothing:** light temporal smoothing on key joint positions (e.g., exponential moving average) to reduce jitter.
- **Person tracking:** assign consistent IDs `A` and `B` across frames (heuristic, no training):
  - nearest-neighbor by torso center (mid-hip / mid-shoulder)
  - fallback to bounding box overlap

### Derived Signals (measurable)
All signals are computed per frame and then aggregated per exchange.

**Core geometry** (2D):
- `torsoCenterA`, `torsoCenterB`
- `rangeBw` = distance(A,B) / bodyWidth (normalize by avg shoulder width)
- `closingBwps` = d(rangeBw)/dt
- `relativeHeading` (optional): shoulder line orientation

**Hands & guard**:
- `handSpeedBwps` for each wrist (finite difference of wrist positions)
- `guardHeight` = wrist y relative to nose/eyes (normalized)
- `guardDropped` boolean per frame (rule-based)

**Strike attempt proxy (no impact claim):**
- `punchAttempt` event when:
  - wrist speed exceeds threshold AND
  - hand moves outward from torso center directionally AND
  - elbow angle extends (if reliable)
- This is an **attempt detector**, not a landed-strike detector.

**Defense proxies:**
- `headDisplacementBw` (nose movement) as slip/evade proxy
- `forearm-to-head proximity` as “cover” proxy (optional)

### Exchange Segmentation Logic (rule-based)
An **exchange** is a time window where fighters are engaged (range closes + meaningful hand motion) and then disengage.

Define states per frame:
- `FAR`: `rangeBw > R_far`
- `NEAR`: `rangeBw <= R_near`
- `ACTIVE`: any of:
  - `|closingBwps| > V_close`
  - `punchAttemptCountInLastT > N`
  - `bothHandsSpeedHigh` (burst)

Segmentation algorithm:
1. Start an exchange when transitioning into `(NEAR && ACTIVE)` for at least `T_enter` ms.
2. End an exchange when `(FAR || !ACTIVE)` persists for `T_exit` ms.
3. Merge exchanges separated by tiny gaps `< T_merge` ms.
4. Drop exchanges shorter than `T_min` ms.

Outputs:
- `ExchangeTimeline.exchanges[]` with stable IDs and timestamps.

### Confidence Scoring (defensible, no ML)
Confidence is computed per pattern occurrence and per overall finding.

**Per-occurrence confidence factors (example):**
- `poseQualityScore` (fraction of frames with visibility >= threshold)
- `signalMargin` (how far past thresholds the signal is)
- `temporalConsistency` (pattern persists for minimum frames)

**Finding confidence:**
- frequency across video (at least `k` occurrences)
- diversity across time (not all in one cluster)
- average per-occurrence confidence

---

## Pattern Vocabulary v0 (max 10, boxing/MMA sparring)
Each pattern must be detectable via pose + geometry without claiming hits.

1. **RANGE_COLLAPSE_ENTRY**
   - Evidence: repeated rapid closing from `rangeBw > R_far` to `rangeBw < R_near` within `<= T`.

2. **STALL_AT_LONG_RANGE**
   - Evidence: extended time with `rangeBw > R_far` AND low activity.

3. **LEAD_HAND_HIGH_VOLUME**
   - Evidence: lead-hand punchAttempt rate above threshold vs rear hand.

4. **REAR_HAND_RUSHES**
   - Evidence: bursts of rear-hand punchAttempt coinciding with rapid closing.

5. **GUARD_DROP_AFTER_ATTACK**
   - Evidence: within `X ms` after a punchAttempt burst, guardDropped becomes true for `>= Y ms`.

6. **HEAD_MOVEMENT_ON_ENTRY**
   - Evidence: head displacement spikes during closing windows (slip/evade proxy).

7. **LINEAR_BACKPEDAL**
   - Evidence: consistent retreat vector aligned with opponent centerline while range increases.

8. **CIRCLE_OFF_EXIT**
   - Evidence: after engagement, lateral displacement dominates over backward displacement.

9. **PAUSE_AFTER_EXCHANGE**
   - Evidence: post-exchange inactivity window (range stable + low hand speed) repeats.

10. **ASYMMETRIC_INITIATION**
   - Evidence: one fighter initiates (first punchAttempt / closing burst) in majority of exchanges.

---

## JSON Schema — ExchangeTimeline
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://musashi.app/schemas/ExchangeTimeline.json",
  "title": "ExchangeTimeline",
  "type": "object",
  "required": ["videoId", "fps", "exchanges"],
  "properties": {
    "videoId": { "type": "string" },
    "fps": { "type": "number", "minimum": 1 },
    "exchanges": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["exchangeId", "startMs", "endMs", "phase", "signals"],
        "properties": {
          "exchangeId": { "type": "string" },
          "startMs": { "type": "integer", "minimum": 0 },
          "endMs": { "type": "integer", "minimum": 0 },
          "phase": {
            "type": "string",
            "enum": ["approach", "engaged", "break", "unknown"]
          },
          "participants": {
            "type": "array",
            "items": { "type": "string", "enum": ["A", "B"] },
            "minItems": 2,
            "maxItems": 2
          },
          "signals": {
            "type": "object",
            "required": ["rangeBwAvg", "rangeBwMin", "closingBwpsPeak", "poseQuality"],
            "properties": {
              "rangeBwAvg": { "type": "number" },
              "rangeBwMin": { "type": "number" },
              "closingBwpsPeak": { "type": "number" },
              "poseQuality": {
                "type": "object",
                "required": ["A", "B"],
                "properties": {
                  "A": { "type": "number", "minimum": 0, "maximum": 1 },
                  "B": { "type": "number", "minimum": 0, "maximum": 1 }
                }
              },
              "punchAttempts": {
                "type": "object",
                "required": ["A", "B"],
                "properties": {
                  "A": { "type": "integer", "minimum": 0 },
                  "B": { "type": "integer", "minimum": 0 }
                }
              },
              "guardDropMs": {
                "type": "object",
                "required": ["A", "B"],
                "properties": {
                  "A": { "type": "integer", "minimum": 0 },
                  "B": { "type": "integer", "minimum": 0 }
                }
              }
            },
            "additionalProperties": true
          }
        }
      }
    }
  }
}
```

---

## JSON Schema — PatternFinding
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://musashi.app/schemas/PatternFinding.json",
  "title": "PatternFinding",
  "type": "object",
  "required": ["patternId", "title", "summary", "confidence", "evidence"],
  "properties": {
    "patternId": {
      "type": "string",
      "enum": [
        "RANGE_COLLAPSE_ENTRY",
        "STALL_AT_LONG_RANGE",
        "LEAD_HAND_HIGH_VOLUME",
        "REAR_HAND_RUSHES",
        "GUARD_DROP_AFTER_ATTACK",
        "HEAD_MOVEMENT_ON_ENTRY",
        "LINEAR_BACKPEDAL",
        "CIRCLE_OFF_EXIT",
        "PAUSE_AFTER_EXCHANGE",
        "ASYMMETRIC_INITIATION"
      ]
    },
    "title": { "type": "string" },
    "summary": { "type": "string" },
    "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
    "traceability": {
      "type": "object",
      "required": ["signalsUsed", "thresholds"],
      "properties": {
        "signalsUsed": { "type": "array", "items": { "type": "string" } },
        "thresholds": { "type": "object", "additionalProperties": true },
        "aggregation": { "type": "string" }
      }
    },
    "evidence": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["exchangeId", "startMs", "endMs", "confidence"],
        "properties": {
          "exchangeId": { "type": "string" },
          "startMs": { "type": "integer", "minimum": 0 },
          "endMs": { "type": "integer", "minimum": 0 },
          "confidence": { "type": "number", "minimum": 0, "maximum": 1 },
          "metrics": { "type": "object", "additionalProperties": true }
        }
      }
    }
  }
}
```

---

## JSON Schema — CoachReport
```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://musashi.app/schemas/CoachReport.json",
  "title": "CoachReport",
  "type": "object",
  "required": ["videoId", "generatedAt", "exchangeTimeline", "patternFindings"],
  "properties": {
    "videoId": { "type": "string" },
    "generatedAt": { "type": "string", "format": "date-time" },
    "exchangeTimeline": { "$ref": "https://musashi.app/schemas/ExchangeTimeline.json" },
    "patternFindings": {
      "type": "array",
      "minItems": 3,
      "maxItems": 3,
      "items": { "$ref": "https://musashi.app/schemas/PatternFinding.json" }
    },
    "notes": {
      "type": "object",
      "properties": {
        "limitations": { "type": "array", "items": { "type": "string" } },
        "poseQualitySummary": { "type": "object", "additionalProperties": true }
      },
      "additionalProperties": true
    }
  }
}
```

---

## Implementation Notes (minimal)
- The LLM may be used to rewrite `PatternFinding.summary` into clean language **but must not introduce new claims**.
- The engine should preserve `traceability` so you can render “click-to-evidence” UI:
  - show the exchange clip and the computed metrics that triggered the pattern.

## Completion Criteria (MVP)
- Given a sparring video, system outputs:
  - Exchange timeline (segmented)
  - Exactly 3 pattern findings
  - Each finding has timestamps and confidence
  - Every finding includes traceability (signals + thresholds)
