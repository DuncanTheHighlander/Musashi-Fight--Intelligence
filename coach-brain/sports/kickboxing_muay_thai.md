# Kickboxing / Muay Thai Coaching Brain

## Purpose

Helps Musashi analyze kickboxing and Muay Thai ("art of eight limbs") footage. The paradigm differs from boxing: kicks, knees, elbows, and the clinch redefine stance, balance, and defense. The brain evaluates strike setups, checking, retraction, balance recovery, and clinch posture — and never applies pure-boxing standards to a kick-threat environment.

## Core Tactical Priorities

1. **Balance over evasion** — with legs as constant targets and weapons, deep slips and ducks are liabilities (a duck meets a knee). Upright, vertically aligned posture that can check, teep, and absorb is prioritized. Judges score strikes that visibly disturb balance and posture.
2. **Square-ish stance, light lead leg** — hips/shoulders face the opponent more than in boxing; a bladed stance exposes the lead leg to low kicks and slows checks. Weight ~50/50 or slightly rear-biased so the lead leg can lift instantly.
3. **Rhythm / the march** — the marching cadence masks strike initiation and keeps the lead leg unweighted. A static, planted fighter is a low-kick target.
4. **Kick setups** — "naked" kicks (no preceding punch, feint, or rhythm break) get checked, caught, or countered. Hands blind, kicks chop.
5. **Retraction and reset** — every kick must return fast along its path and land back in stance. Slow teep retraction = caught leg = swept. Landing squared after a kick = broken base.
6. **Clinch posture** — tall spine, hips under shoulders, hips driven forward. Bending at the waist in the clinch surrenders leverage and feeds the head into knees.
7. **Kick defense hierarchy** — check with the shin (leg lifted, knee angled out), don't absorb kicks on the arms; arms-blocking low kicks drops the guard and concedes points.

## Common Positions / Phases

- **Outside / kicking range**: teep as the jab-equivalent (chamber high, drive with the hips, retract instantly); long roundhouse. Exits must be angular.
- **Pocket / mid-range**: punch-kick combinations with weight transfer logic (a cross loads the lead-leg kick); **long guard** to frame, jam kicks, and manage distance while the rear hand stays home; counter-kick windows — a kicker is on one leg and can be jammed with a straight down the middle or checked-then-countered.
- **Clinch (plum)**: pummel for inside position (double collar tie, inside biceps), skeletal frames on collarbone/neck, knees driven with hip thrust and rising onto the ball of the support foot. Balance during knees depends on upper-body framing.

## Common Mistakes

- **Naked kicks** — kicks thrown without setup; easily read, checked, caught.
- **Bladed boxing stance under kick threat** — lead leg can't lift in time; thigh/calf accumulate damage.
- **Late or glancing checks** — shin not up and rotated out before the kick arrives; force lands on soft tissue and balance breaks.
- **Opposite hand drops during kicks** — the kick-side arm swinging down is correct counterbalance, but the OTHER hand must stay anchored to the jaw (or extended in long guard).
- **Landing square / crossed after a kick** — base destroyed, no ability to absorb or fire back.
- **Broken clinch posture** — bending at the waist, hips back; head goes into knee traffic.
- **Straight-line exits** — retreating on the centerline into teeps and crosses.
- **Flat-footed teeps/knees** — support heel planted kills hip drive and power.

## High-Value FightLang Events

`kick_without_setup`, `stance_too_bladed`, `retraction_late`, `land_square_after_kick`, `check_late`, `clinch_posture_fault`, `straight_line_exit`, `hands_drop_during_kick`, `low_kick_counter_window`, `knee_base_foot_flat`, `teep_entry`

## What AI Vision Should Look For

- Kinetic sequencing on round kicks: support-foot pivot → pelvic rotation → hip → knee whip. Knee extension before hip rotation = weak "flick" kick.
- Center of mass vs base of support during kick retraction and landing — flag exits that land squared/crossed.
- Check geometry: is the defending shin elevated and rotated out before the incoming strike crosses mid-trajectory?
- Long-guard structures (extended lead arm framing) — do not misread as a dropped guard.
- Clinch: spinal verticality (shoulders stacked over hips), hip proximity, inside vs outside arm control.
- Whether kicks are preceded by hand strikes, feints, or rhythm changes.

## What RTMPose / MediaPipe Should Measure

- Trunk inclination (shoulder-midpoint vs hip-midpoint) — clinch posture and upright striking posture.
- Ankle linear velocity and knee angular velocity on kicks (power vs push).
- Pelvic axial rotation on round kicks (full hip turnover vs linear flick).
- Support-foot heel elevation during teeps and knees (hip drive enabled or not).
- Non-kicking wrist height vs chin during kick execution.
- Lead-leg load/unload rhythm (marching) and time-to-check on incoming low kicks.
Thresholds are internal guidance only — coach qualitatively unless a value was actually measured.

## Coaching Rules

- Balance before speed: if exits and retractions are broken, fix the base before critiquing strike velocity.
- Setup before mechanics: a biomechanically perfect but naked kick is a tactical error first.
- Distinguish checking from blocking: absorbing low kicks on gloves/forearms is an error — coach the shin check or the counter.
- On bounding-box overlap (clinch), switch evaluation to posture, hip proximity, and arm control — pause velocity metrics.
- Punish missed counter-kick windows: opponent on one leg = jam, straight counter, or check-and-return.

## Caution / Uncertainty Rules

- Clinch occlusion is severe: when hip/knee keypoints are unreliable, coach macro posture only or abstain.
- Toe-up vs toe-down on checks is a legitimate coaching debate — stay agnostic; only require the shin elevated and angled.
- 2D camera angles distort check angles and kick depth — hedge exact-angle claims unless the camera plane cooperates.
- The kick-side arm swinging down on a power roundhouse is correct mechanics — do not flag it; only flag the opposite hand dropping.
- If feet aren't visible, skip stance and check critiques.

## Good Feedback Patterns

- "Your right kick mechanics are strong, but every one is naked — no jab, no feint — so they step out of range each time. Blind them with the jab-cross first, then chop the lead leg."
- "You're falling square after the teep. Snap the heel back toward your glute after impact and land back in stance so the base survives the exchange."
- "You ate three low kicks standing flat in punching range. Either keep the march so the lead leg is light to check, or step in and jam the kick with the cross."
- "In the clinch you're bending at the waist — that feeds your head into the knee. Stay tall, hips under shoulders, and drive your hips into them to smother the knee space."

## Bad Feedback to Avoid

- "Widen your stance and get lower for head movement." — Pure boxing advice; a wide low stance eats low kicks and can't check.
- "Faster knees in the clinch." — Clinch dominance is posture, frames, and leverage, not flailing speed.
- "Keep both hands glued to your head on the kick." — The kick-side arm must swing to counterbalance; only the opposite hand must stay home.
- "Kick harder." — Diagnose the hip turnover, support-foot pivot, or setup instead.

## Output Guidance

- **Coach's Read**: the weapons story — who controlled range with what, whose setups worked, whose defense (check/long guard/clinch posture) held or broke.
- **3 Adjustments**: technical = kick/check/clinch mechanics; tactical = setups, counter-kick windows, range and rhythm; habit = a drill (e.g. check-and-counter rounds, teep-retraction reps, clinch posture holds).
- **Quick Cues**: "March — lead leg light", "Jab before the kick", "Tall in the clinch".
- **Replay Evidence**: label naked kicks, late checks, square landings, clinch posture breaks at their timestamps.
- **Confidence note**: flag clinch occlusion and any check-angle uncertainty from camera position.

## Suggested FightLang Event Names

- stance_too_bladed
- stance_weight_too_far_forward
- rhythm_static_no_march
- kick_without_setup
- teep_retraction_late
- kick_hip_turnover_insufficient
- kicking_arm_swing_missing
- opposite_hand_dropped_on_kick
- land_square_after_kick
- balance_compromised_on_exit
- straight_line_exit
- angle_exit_missing
- check_late
- check_angle_insufficient
- hands_dropped_to_block_kick
- low_kick_counter_window_missed
- knee_base_foot_flat
- clinch_posture_fault_waist_bend
- clinch_hips_too_far_from_opponent
- teep_entry
- knee_entry_open
