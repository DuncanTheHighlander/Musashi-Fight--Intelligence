# Boxing Coaching Brain

## Purpose

Helps Musashi turn boxing footage plus FightLang pose evidence into elite, evidence-backed coaching. Boxing is analyzed as a problem of spatial geometry, kinetic-chain sequencing, and rhythm — not strike counting. The brain diagnoses WHY a fighter is getting hit, why punches lack power, and why they lose control of range.

## Core Tactical Priorities

1. **Kinetic chain & effective mass** — power starts at the floor (ground reaction force) and travels ankle → knee → hip → torso → shoulder → fist. An "arm punch" means the chain broke, usually at the hips or base. Straight punches carry more effective mass than looping shots when structure is aligned. (Internal guidance only — never quote force/mass numbers to the user.)
2. **Centerline control & head position** — the head must move off the centerline before, during, and after exchanges. A static head after a combination is a counter invitation.
3. **Defensive responsibility during offense** — the non-punching hand protects. The rear hand must return to the chin during lead-hand strikes.
4. **Dynamic balance & structural integrity** — center of mass stays over the base of support. Crossing feet, squaring up, or leaning past the lead knee collapses structure. What looks like "quitting" under pressure is usually structural collapse.
5. **Angles over lines** — retreating straight back keeps the fighter in the opponent's firing line and concedes ring position. 45–90° pivots and lateral steps change the geometry and open counters.
6. **Range management & rhythm** — probing range, pocket, clinch. Entries must be set up with feints/jabs; rhythm breaks (half-beat pauses, delayed counters) disrupt the opponent's anticipation. Feints are deliberate tools, not failed punches.

## Common Positions / Phases

- **Probing (out of range)**: feints, rhythm-setting, lead-foot battle (especially open-stance matchups fighting for outside foot position). Weight balanced or slightly rear-biased, light on the balls of the feet.
- **Entry**: closing into the pocket. Sound entries push off the rear foot with the lead foot landing as the punch lands. Errors here: elevated chin, flared elbow, overreaching.
- **Pocket exchange**: hooks/uppercuts/crosses live here. Look for hip-shoulder separation (torque), active weight shifting, shells and shoulder rolls. Fatal error: the **pocket pause** — staying stationary in range with no offense, defense, or exit.
- **Exit**: disengaging on an angle. Two-step exits, pivots off the lead foot, check hooks. Straight-back exits are the cardinal failure.

## Common Mistakes

- **Straight-line exit** — backing straight up after exchanges; absorbs advancing power shots and gets trapped on the ropes.
- **Rear-hand recovery fault (lazy guard)** — rear hand drops during the jab or lead hook, opening a counter-hook window over the top.
- **Overreaching** — leaning the torso past the lead knee instead of stepping into range; kills power and balance, invites pull counters and uppercuts.
- **Crossing feet / squaring the stance** — collapses the base; a squared stance kills rotational power and widens the target.
- **Elbow flare ("chicken wing")** — elbow lifts before straight punches; telegraphs and bleeds power sideways.
- **No defensive action after offense** — throwing, then standing on the centerline or resetting with hands low. Counter-punchers time the retraction.

## High-Value FightLang Events

`counter_window_open`, `straight_line_exit`, `head_on_centerline`, `balance_break_after_strike`, `rear_hand_recovery_fault`, `stance_square`, `angle_exit_missing`, `feet_crossing`, `pocket_pause`, `jab_entry`, `overreach`, `chin_rise`, `reset_with_hands_low`

## What AI Vision Should Look For

- Wrist-to-chin relationship during exchanges (guard integrity), scaled to the fighter's proportions.
- Center of mass vs base of support: does the head/torso project past the lead foot on punches?
- Which foot moves first in lateral movement (foot closest to the direction should move first), and foot-path crossings.
- Hip-shoulder separation before hooks/crosses (torque) vs. arm-only punching.
- Exit vectors after combinations: pivot/lateral step vs. straight retreat.
- Recognize deliberate defensive shapes (shoulder roll / Philly shell) before flagging "hands low".
- Stance switches: re-read lead foot continuously; don't inherit a stale stance call.

## What RTMPose / MediaPipe Should Measure

- Rear-wrist distance from chin/jaw during lead-hand strikes (guard fault trigger).
- Shoulder abduction angle during straight punches (elbow flare).
- Nose deviation from the fighters' centerline axis during exchanges (static head).
- Ankle positions on the floor plane: stance width, squaring, feet crossing, exit direction over consecutive steps.
- Hip vs shoulder rotation timing and peak wrist velocity (kinetic-chain sequencing / effective-mass proxy).
- Rear-ankle angular displacement around the lead ankle (pivot detection, ~45–90° for a defensive exit).
All thresholds are internal detection guidance — output qualitative language unless the value was actually measured.

## Coaching Rules

- Rear hand drops on the jab in the pocket → coach the counter window it opens (opponent's lead hook over the top) and the fix (anchor the rear thumb to the chin).
- Repeated straight-line exits → coach the 45° pivot off the lead foot after the combination.
- Balance break after a power cross → coach driving from the rear foot and rotating the hips instead of lunging the upper body.
- Static head post-combination → coach moving the head off the centerline on the retraction of the last punch, or framing out.
- Feet crossing while circling → coach "near foot moves first" stepping.
- Missing angle after a 1-2-3 → coach "close the door": pivot outside off the lead hook's rotation.
- Diagnose failures backwards through the chain: a weak punch is usually a base/hip problem, not a hand problem.

## Caution / Uncertainty Rules

- In the pocket and clinch, limbs occlude — suspend guard-drop and power claims when wrists/hips aren't reliably visible.
- A short, fast, uncommitted extension is a **feint**, not a flawed punch — don't coach mechanics on it.
- Single-camera depth is unreliable: prefer relative/angular reads ("head past the lead knee") over exact distances.
- Re-verify stance from settled moments; camera angle is the most common source of a wrong stance call. If feet are unclear, say "unknown".
- Do not read a shoulder-roll defense as a dropped guard.

## Good Feedback Patterns

- "Your rear foot leaves the floor on the cross — the power has nowhere to come from. Keep the rear toe anchored and pivot the hip so the force drives through the floor."
- "At 1:14 you retreated straight back off the 1-2 and ate the right hand that followed. After the 2, shift to the back foot and step off at 45 degrees."
- "The lead elbow flares before your jab — it telegraphs and bleeds power sideways. Keep the elbow on the ribs until the fist turns over at the end."
- "Your head stays on the centerline through the lead hook. Slip outside their lead shoulder as you throw so the counter cross has nothing to hit."

## Bad Feedback to Avoid

- "Keep your hands up." — Which hand? When? What does it expose? Name the window.
- "Punch harder." — Diagnose the chain: hips, base, overreach.
- "Move your feet more." — Coach efficient movement: stop crossing feet, pivot off the lead leg.
- "You need more heart." — The tape shows structure collapsing, not character. Name the physical collapse.

## Output Guidance

- **Coach's Read**: the geometric story — who controlled range and the centerline, the repeated structural leak, and how it gets punished.
- **3 Adjustments**: technical = the chain/guard fix; tactical = the range/angle/timing fix; habit = the drill that burns it in.
- **Drill**: named, with a rule and a consequence (e.g. "Pivot or Pay": partner walks you down with 1-2s; you must parry-and-pivot 45° — no straight retreats allowed).
- **Quick Cues**: corner-shout length ("Rear hand home on the jab", "Angle out after the 3").
- **Replay Evidence**: short labels at the timestamped events ("counter window — rear hand low").
- **Confidence note**: flag occlusion-heavy pocket exchanges and any stance uncertainty.

## Suggested FightLang Event Names

- guard_drop
- hand_return_low
- rear_hand_recovery_fault
- elbow_flare_pre_strike
- head_on_centerline
- straight_line_exit
- angle_exit_missing
- stance_square
- feet_crossing
- pocket_pause
- counter_window_open
- jab_entry
- balance_break_after_strike
- overreach
- chin_rise
- reset_with_hands_low
- effective_mass_failure
- pelvic_thoracic_desync
- lead_foot_dominance_lost
- shoulder_roll_active
- check_hook_pivot
