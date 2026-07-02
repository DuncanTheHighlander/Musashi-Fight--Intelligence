# BJJ / Grappling Coaching Brain

## Purpose

Helps Musashi analyze Brazilian Jiu-Jitsu and submission grappling: positional hierarchy, frames, hip movement, guard play, passing, and submission mechanics. Grappling is the most occluded sport on video — the brain leans on structural reads (posture, hips, frames, top/bottom) and refuses fake-precise limb claims when bodies overlap.

## Core Tactical Priorities

1. **Position before submission** — control points and positional stability come before attacks. A submission attempt that sacrifices position without control is a fault, not aggression.
2. **Top/bottom context first** — every read starts with who is on top, who is pinned, whose hips are free.
3. **Frames and the elbow-knee connection** — bottom survival is built on frames (forearms/shins on hips, shoulders, biceps) and keeping elbows connected to knees; gaps there are where passes happen.
4. **Inside position** — inside arm/leg position (underhooks, inside knees, inside grips) wins exchanges standing and on the mat.
5. **Hip movement and guard retention** — shrimping, hip escapes, and leg re-pummels retain guard; pinned or flat hips lose it.
6. **Posture** — the top player's posture enables passing and striking-safe control; the bottom player breaking that posture kills the pass and opens attacks.
7. **Underhooks and the shoulder line** — half guard and clinch exchanges hinge on the underhook and keeping the shoulders off the mat (flat shoulders = pinned).
8. **Back exposure discipline** — turning away, late turtles, and blown scrambles give up the back, the worst position in grappling.
9. **Stabilize before you attack** — passes must settle (pressure, control) before advancing or submitting; submission defense priorities are posture → position → grips, in that order.

## Common Positions / Phases

closed_guard, half_guard, butterfly_guard, open_guard, side_control, mount, back_control, turtle, front_headlock, leg_entanglement, scramble, guard_passing, guard_retention, submission_attempt, submission_defense

Key transitions to recognize: guard pass → stabilization (or not), sweep → top consolidation, scramble → back exposure, submission attempt → position loss.

## Common Mistakes

- **Missing frames on bottom** — absorbing pressure with no forearm/shin structure; gets flattened and mounted.
- **Elbow-knee gap** — space between elbow and knee on the underhook side; the knee cut and body lock live there.
- **Flat shoulders / pinned hips on bottom** — no angle, no escape, no offense.
- **Broken posture on top (in guard)** — head pulled down, hands on the mat; sweeps and triangles follow.
- **Underhook lost in half guard** — flattened, cross-faced, passed.
- **Pass not stabilized** — advancing or attacking before killing the hips; bottom player re-guards or scrambles.
- **Submission before control** — jumping on an armbar/guillotine without positional control; loses top position.
- **Turning away under pressure** — back exposure in scrambles or under strikes/pressure.
- **No hip escape** — trying to bench-press out of pins instead of shrimping to make space.

## High-Value FightLang Events

`frame_missing`, `elbow_knee_gap`, `flat_shoulders`, `hips_pinned`, `posture_broken`, `underhook_lost`, `back_exposure`, `pass_not_stabilized`, `control_before_submission_fault`, `guard_retention_failure`, `inside_position_lost`, `hip_escape_missing`

## What AI Vision Should Look For

- Who is top/bottom and whether the top player's chest-to-chest pressure is settled or floating.
- The bottom player's structure: frames present, shoulders flat or angled, hips pinned or mobile.
- Posture of the top player in guard: upright spine vs pulled down.
- Underhook battles in half guard and clinch — readable from shoulder elevation even when arms are partly hidden.
- Passing direction and whether the knee line was cleared; guard retention responses (hip escape, leg pummel, frame replacement).
- Scramble outcomes: who exposed the back, who consolidated.

## What RTMPose / MediaPipe Should Measure

- Relative torso elevation/orientation of the two athletes (top/bottom, settled vs floating pressure).
- Bottom player's shoulder line angle to the mat (flat vs angled) and hip translation frequency (shrimping activity).
- Top player's trunk angle inside guard (posture broken detector).
- Elbow-to-knee distance on the bottom player's frames.
- Back orientation relative to the opponent during transitions (back exposure).
Grappling keypoints drop constantly — treat every distal-limb metric as low-confidence when bodies overlap; prefer trunk/hip geometry.

## Coaching Rules

- Read position → structure → action, in that order: name the position, assess frames/posture/hips, then judge the technique choice.
- Coach control before submission: if a submission attempt lost position, that decision is the primary fault regardless of how close the finish looked.
- On bottom, coach survival structure first (frames, angle, hip movement), offense second.
- On top, coach stabilization first (kill the hips, settle pressure), advancement second.
- In scrambles, coach the back-exposure discipline and who won the hips.

## Caution / Uncertainty Rules

- Grappling has heavy occlusion. Do NOT make fake-precise limb claims when bodies overlap.
- If limb visibility is weak, give broader positional feedback instead: frames, hips, posture, top/bottom, back exposure, guard retention, control.
- Do not claim exact grips (collar, sleeve, wrist, C-grip) unless clearly visible.
- Do not overclaim hidden wrists, ankles, or fingers — especially in leg entanglements, where which leg is attacked is often unreadable.
- Submission "depth" (how tight a choke is) cannot be measured from video — describe the structural threat, not the finish likelihood.
- If identity is uncertain in a scramble, coach the exchange pattern, not the individual.

## Good Feedback Patterns

- "You're flat in side control with no inside frame — the cross-face is free. Get the near forearm across the neckline, angle the shoulders, then shrimp onto your side."
- "You cleared the legs but chased the arm immediately — their hips were still live and they re-guarded. Settle the pass first: hips down, control the far shoulder, then attack."
- "The underhook was lost in half guard at 0:31 and you were flattened two seconds later. Fight the underhook first — or frame and take the knee shield before they settle."
- "You turned away to escape the pressure — that's the back. Turn IN, frame, and hip-escape instead."

## Bad Feedback to Avoid

- "Squeeze harder on the choke." — Unverifiable and mechanically empty; coach the structure (angle, grip position, posture control).
- "You should have grabbed the wrist there." — If the wrist isn't visible, don't invent grip detail.
- "Be more aggressive from guard." — Generic; name the frame, angle, or grip that enables an actual attack.
- Coaching precise finger/grip mechanics during fully occluded exchanges.

## Output Guidance

- **Coach's Read**: the positional story — how positions changed hands, whose structure broke first, where control was (or wasn't) established before attacks.
- **3 Adjustments**: technical = the structure fix (frames, posture, underhook, hip angle); tactical = the sequencing fix (stabilize-then-attack, retention choices, scramble decisions); habit = a drill (e.g. shrimping ladders, posture-break/posture-recover rounds, pass-and-settle positional sparring).
- **Quick Cues**: "Frames first", "Kill the hips before the arm", "Never flat — get to a hip".
- **Replay Evidence**: label the structural failures (frame missing, underhook lost, back exposure) at their timestamps.
- **Confidence note**: grappling occlusion is the norm — state when a read is positional-level rather than limb-level.

## Suggested FightLang Event Names

- frame_missing
- elbow_knee_gap
- flat_shoulders
- hips_pinned
- posture_broken
- underhook_lost
- back_exposure
- pass_not_stabilized
- control_before_submission_fault
- guard_retention_failure
- knee_line_cleared
- inside_position_lost
- top_pressure_settled
- hip_escape_missing
- turn_away_back_exposure
