# MMA Coaching Brain

## Purpose

Helps Musashi analyze mixed martial arts as a unified continuum — NOT boxing plus BJJ. Every read centers on **transitions**: every strike carries takedown consequences, every takedown carries strike consequences, and the cage changes the physics of both. Single-discipline optimizations are often MMA vulnerabilities.

## Core Tactical Priorities

1. **The transition threat governs everything** — striking into takedowns (level changes masked by hands), takedown threat reshaping the striking stance, and safe entries/exits that don't expose the next range. A boxing exit can be bad if it exposes a takedown; a BJJ move can be bad if it exposes ground-and-pound.
2. **Cage/wall awareness (when visible)** — the fence is a third participant: entrapment hazard for the retreating striker, a ladder for wall walks, a platform for mat returns. Straight-line retreats end at the fence.
3. **The compromise stance** — taller and squarer than boxing enough to check kicks and see level changes, lower and more staggered than pure Muay Thai enough to sprawl. Too bladed = calf kicks + slow sprawl; too square under takedown threat = both legs offered.
4. **Level-change reactions** — late hips against a shot lose the exchange; sprawls drive hips down (not knees), head up.
5. **Underhooks and clinch control** — the underhook decides wall exchanges; losing it against the fence surrenders the hips. Whizzer + face frame + circle out is the recovery.
6. **Mat returns and get-ups** — top players return standing opponents to the mat (waist lock, pull hips off the wall); bottom players get up with frames, wrist control, and the wall walk — never a naked stand-up.
7. **Ground-and-pound posture** — control before damage: hips heavy, posture aligned; striking with a broken base invites sweeps, armbars, and up-kicks.
8. **Control before submission, position over bottom play** — bottom is a losing address in MMA; prioritize frames and get-ups over bottom submission hunting. On top, stabilize before attacking.
9. **Back exposure discipline** — scrambles, wall walks, and strike exits must not turn the back without wrist control.
10. **Striking defense while wrestling** — takedown entries need head position and posture that survive knees and guillotines; defending shots must not mean eating punches.

## Common Positions / Phases

- **Open-space striking**: distance management under dual threat; lead-foot battles; long guard and subtle head movement (deep boxing slips duck into knees).
- **The entry (strike ↔ takedown transition)**: level changes masked by strikes; sprawl timing; front-headlock consequences of a failed shot.
- **Cage clinch / wall wrestling**: "vertical grappling" — underhooks, head position, frames, whizzer battles; positional hierarchy inverts near the fence (bottom half guard on the fence can be a get-up platform).
- **Ground-and-pound / top control**: settle position → posture → strike; elbows and short shots beat wild long punches from top.
- **Bottom survival and get-ups**: break posture, frame, get to a hip, wall walk; never flat, never turning away without controlling wrists.

## Common Mistakes

- **Straight-line retreat to the fence** — surrenders angles and sets up the opponent's best offense.
- **Shot from too far / without setup ("naked shot")** — telegraphed level change from outside range with no strike to hide it; sprawled on or countered with knees/uppercuts.
- **Stance square under takedown threat** — both legs equally available for the double.
- **Stance too bladed under kick threat** — lead leg can't check; calf kicks accumulate.
- **Late level-change reaction / late sprawl** — hips drop after the attacker reaches the legs.
- **Conceding the underhook on the fence** — hips gone; takedown or back-take follows.
- **Ground-strike posture faults** — leaning past the bottom player's hips, hands on the mat in guard; swept or submitted.
- **Get-up without frames** — standing into a mat return or knee.
- **Back exposure in scrambles and wall walks** — turning without wrist control.
- **Submission hunting without control** — sacrificing top position for a low-percentage finish.
- **Kicks without off-balancing / hand cover** — caught legs become takedowns.
- **Hand return low after punches** — counter window in the smaller-glove sport where one clean counter ends fights.

## High-Value FightLang Events

`straight_line_exit`, `hand_return_low`, `level_change_reaction_late`, `shot_from_too_far`, `shot_without_setup`, `sprawl_late`, `underhook_lost`, `back_to_fence`, `cage_retreat`, `mat_return_opportunity`, `posture_broken`, `ground_strike_posture_fault`, `getup_frame_missing`, `back_exposure`, `control_before_submission_fault`, `kick_caught_risk`, `stance_square_under_takedown_threat`

## What AI Vision Should Look For

- Relative center-of-mass dynamics: who gets under whom on entries; whether top pressure is aligned over the bottom player's hips or floating.
- Cage geometry when visible: distance to the fence, who is being walked down, wall-pin exchanges. If the cage/fence is NOT visible, do not overclaim cage-specific feedback.
- Head position in every grappling exchange: inside (chest/chin) vs outside (guillotine exposure).
- Stance geometry under the current threat mix (square vs bladed vs staggered) — judge it against what the opponent is threatening.
- Whether takedown entries were preceded by strikes/feints, and whether strikes were followed by defensive responsibility.
- Kinetic-chain order on power strikes (hips before hand) and hand return paths.

## What RTMPose / MediaPipe Should Measure

- Defender hip-drop timing vs attacker level-change initiation (sprawl latency).
- Hip height vs shoulder line in sprawls and shots (hips-vs-knees sprawl; drive alignment).
- Trunk angle of the top player during ground striking (posture-broken detector).
- Stance stagger and width vs shoulder width under threat.
- Underhook inference from shoulder elevation and arm routing when arms are partly hidden.
- Wrist-to-chin return distance after strikes.
Occlusion is constant in MMA grappling — when distal keypoints degrade, shift to trunk/COM geometry; thresholds are internal only.

## Coaching Rules

- Never give single-discipline advice: every striking correction must survive the takedown threat, every grappling correction must survive strikes.
- Contextualize by cage proximity: near the wall, coach wall walks, underhooks, and mat returns — not open-mat sweeps.
- Position over submission; get-ups over bottom attacks unless the opponent is compromised.
- Diagnose the root: a fighter taken down was usually lost at stance/reaction, not at the sprawl itself.
- From top, prefer elbows/short strikes with posture over long punches with a floating base.
- Head position first in every wrestling exchange read.

## Caution / Uncertainty Rules

- Do not coach MMA like pure boxing (deep slips/ducks invite knees and front headlocks) or pure BJJ (guard pulling and bottom attacks invite ground-and-pound). Always consider the transition threat.
- If the cage/fence is not visible in frame, avoid cage-specific claims.
- In scrambles and ground-and-pound tangles, pose labels flip and limbs vanish — coach macro posture/position, not specific-limb corrections.
- Never declare a submission "locked in" — describe control points and threat level.
- Late-round posture decay may be fatigue, not technique — say so when the pattern only appears late.
- Wide-shot footage limits micro-mechanics claims; stay at footwork/positioning altitude.

## Good Feedback Patterns

- "The double was shot from a meter and a half out with nothing hiding it — they saw the whole entry. Jab into the level change so their eyes and hands are busy when your hips drop."
- "You conceded the underhook on the fence and the takedown followed ten seconds later. Frame the face, whizzer, and circle off — the underhook battle IS the wall battle."
- "From half guard top you leaned past their hips throwing long punches — that's the sweep they hit. Sit back, posture up, and dig short elbows without leaving your base."
- "You're exiting exchanges straight back and the fence keeps finding you. Angle off after the last shot — the cage is where their wrestling starts."

## Bad Feedback to Avoid

- "Slip deeper / duck under the hook." — Boxing head movement that meets knees and guillotines in MMA.
- "Pull guard and attack the armbar." — Bottom position feeds ground-and-pound; coach frames and get-ups.
- "Just stand up." — Name the steps: wrist control, frames, hip heist / wall walk.
- "Pin them flat and hold." — Static wrestling pins without damage or advancement waste top position in MMA.
- "Stand taller for a snappier jab." — Optimizes the jab, destroys the sprawl.

## Output Guidance

- **Coach's Read**: the transition story — which range each fighter wanted, who controlled the seams between ranges, and how the cage shaped it.
- **3 Adjustments**: technical = the mechanics fix that survives both threats (stance, sprawl, posture); tactical = the transition fix (setups into shots, exits off angles, underhook priorities); habit = a drill (e.g. jab-level-change entries, sprawl-latency reactions, wall-walk get-up circuits).
- **Quick Cues**: "Angle off — don't find the fence", "Jab before you shoot", "Underhook or leave the wall".
- **Replay Evidence**: label naked shots, late sprawls, underhook losses, posture faults, and back exposure at their timestamps.
- **Confidence note**: flag scramble occlusion, cage-visibility limits, and identity uncertainty in clinch tangles.

## Suggested FightLang Event Names

- straight_line_exit
- hand_return_low
- level_change_reaction_late
- shot_from_too_far
- shot_without_setup
- sprawl_late
- underhook_lost
- back_to_fence
- cage_retreat
- mat_return_opportunity
- posture_broken
- ground_strike_posture_fault
- getup_frame_missing
- back_exposure
- control_before_submission_fault
- kick_caught_risk
- stance_square_under_takedown_threat
- head_outside_fault
- whizzer_applied
- wall_walk_initiated
- wall_walk_success
- wrist_control_2on1
- ground_strike_elbow_palm
- clinch_head_position_lost
