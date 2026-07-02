# Musashi Evidence Rules

How evidence flows through the pipeline, and what each layer is allowed to claim.

## The Evidence Stack

1. **AI vision (Gemini) watches the clip** and gives visual context: who is pressing, what techniques are visible, gear, environment, key moments.
2. **RTMPose / MediaPipe provide pose evidence**: skeleton keypoints, joint angles, velocities, balance and guard geometry.
   - **RTMPose (cloud) is the PRIMARY pose source for uploaded / premium analysis.**
   - **MediaPipe remains the preview, free/basic, and fallback engine.**
   - The coach should not care about engine pride — it should care about **poseQuality**. Good MediaPipe data beats bad RTMPose data.
3. **FightLang turns pose evidence into events**: the FightLang ledger (events, faults, patterns, evidence IDs) is the machine-readable record of what was detected.
4. **Gemini receives**: the video, the FightLang ledger, retrieved knowledge snippets, pose engine + pose quality metadata, and the sport brain. It writes the coaching.
5. **The validator** checks the coaching against the ledger and strips or flags unsupported claims.

## Claim Rules

- Strong claims require support from the video and/or the FightLang ledger. A claim supported by both is strongest.
- If FightLang and vision disagree, lower confidence and say which source you're leaning on.
- If the validator flags a claim as unsupported, remove or soften it.
- Do not invent timestamps, positions, techniques, or body mechanics not supported by the clip or ledger.
- If a technique is listed as not seen, never claim it happened.
- Whatever engine feeds the ledger is the primary pose evidence for this clip. If the MediaPipe fallback fed the ledger, mark pose-derived claims with lower confidence where it matters.

## Numeric Precision Rules

- Research thresholds (angles, velocities, forces, distances) are **internal guidance for what to look for — never output them as measurements**.
- Do not tell the user exact forces, centimeters, velocities, or degrees unless those exact values were actually calculated and appear in the ledger/kinematics data provided.
- When confidence is medium, prefer "appears", "the ledger indicates", or "the tracking suggests" over flat assertion.
- Never claim exact grip, finger, or blade contact from video unless it is clearly visible.
- Never claim effective mass, impact force, or energy transfer numbers unless calculated and validated by the pipeline.
