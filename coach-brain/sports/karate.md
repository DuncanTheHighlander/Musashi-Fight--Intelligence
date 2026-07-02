# Karate Coaching Brain

## Purpose

Helps Musashi analyze sport karate (point-fighting / WKF-style kumite). Karate is a contest of extreme distance management (ma-ai), timing (sen), and explosive linear entries — not attritional exchanges. The brain must NOT apply boxing or kickboxing heuristics to karate's movement profile.

## Core Tactical Priorities

1. **Ma-ai (distance)** — karateka fight at longer range than boxers. Three working ranges: close (one step), middle (~1.5 steps, max power), long (two steps, max controllable). Who dictates the engagement zone wins the chess match.
2. **Timing (sen)** — intercept, don't trade. *Go no sen* = react-and-counter after the attack starts; *sen no sen* = launch simultaneously/into the opponent's initiation.
3. **The blitz** — explosive distance-closing (tsugi-ashi / step-in) with a single decisive technique. Point fighting rewards the perfectly timed single strike over long combinations.
4. **Score-and-exit (zanshin)** — strike, then leave immediately on an angle. Lingering ("score-and-stay") gets points nullified and invites counters. Straight-back exits invite a linear counter-blitz.
5. **Loading the entry** — hips drop before the blitz to load the legs; a tall, floating entry is slow and readable.
6. **Karate mechanics are their own thing** — hikite (pulling the off hand back) aids hip rotation, brief rigid extension (kime) is correct shock transfer, and a lower guard is a legitimate stylistic choice for mobility and mid-protection.

## Common Positions / Phases

- **Kamae**: bladed, bouncy stance, weight even or slightly rear; constant micro-bounces mask the first step. Hands often lower than boxing — legitimate.
- **Entry (blitz)**: explosive forward drive off the rear leg; kizami-zuki (lead jab) or gyaku-zuki (reverse punch) with rapid hip rotation.
- **Execution**: full extension with kime; head kicks are scored on controlled light contact, not follow-through.
- **Exit / reset**: instant retraction and angled disengagement back outside counter range.

## Common Mistakes

- **Attacking from too far** — strike reaches maximum extension before the target; dead on arrival and open to the counter.
- **Straight-line exit** — reversing the entry vector exactly; the opponent blitzes down the same line.
- **Score-and-stay** — landing but not leaving; loses the point and eats the return.
- **Lead-hand drop** during exchanges — opens jodan (head) kicks and intercepting jabs.
- **Standing too tall on the entry** — no leg loading, slow first step.
- **Missing hikite** — reduced hip rotation, weaker gyaku-zuki, off arm exposed.
- **Overcommitted entry** — head past the lead knee; balance breaks, exit becomes impossible.

## High-Value FightLang Events

`attack_from_too_far`, `score_and_stay`, `blitz_entry`, `straight_line_exit`, `angle_exit_missing`, `stance_too_tall`, `lead_hand_drop`, `counter_window_open`, `overcommit_entry`, `failed_distance_recovery`, `retraction_late`, `balance_break_after_attack`

## What AI Vision Should Look For

- The gap between fighters and how fast it collapses (a sub-half-second collapse = blitz entry).
- Whether the strike initiates inside effective range or falls short at full extension.
- Exit trajectory after each scoring attempt: lateral deviation vs. exact reverse of the entry line.
- Hip height before entries (loading) and head position vs lead knee (overcommit).
- Distinguish rhythm bounces and limb pumps (feints) from actual entries: require real center-of-mass displacement plus high-velocity extension.
- Controlled head-level techniques that pull short of contact are SUCCESSFUL karate techniques, not misses.

## What RTMPose / MediaPipe Should Measure

- Wrist/ankle peak velocities on entries (explosiveness) and retraction time after extension.
- Hip-height change before the blitz (loading) and hip rotation on gyaku-zuki.
- Center-of-mass displacement speed during entries and exits.
- Lead-wrist height during exchanges (only flag drops during live exchanges at range, not at kamae).
- Exit vector angle relative to entry vector.
Thresholds internal only; report qualitatively unless measured.

## Coaching Rules

- Do not force boxing logic: a low guard at range is not a fault; flag it only during live head-level exchanges.
- Weight the exit as heavily as the entry — a fast strike with no exit is a failed sequence in point karate.
- Accept brief rigid extension (kime); do not coach a boxing-style snap-back as a correction.
- Prefer the single perfectly timed technique over recommending long combinations.
- Read the opponent's rhythm for counter windows (e.g., guard drops on the back-bounce) and coach sen no sen entries into them.

## Caution / Uncertainty Rules

- The bladed stance hides the rear hand and shoulder from many camera angles — hedge rear-hand claims.
- Blitz speed causes motion blur; avoid micro-mechanic claims at peak velocity, coach macro entry/exit shape.
- Feint-heavy bouncing produces false entry detections — require displacement + extension before calling an attack.
- Controlled head contact rules mean "light" strikes may be points, not weak strikes — don't coach "follow through" on jodan techniques.

## Good Feedback Patterns

- "Your blitz is fast but launches from outside your range — the gyaku-zuki dies at full extension. Steal a half-step first, then explode."
- "You scored clean at 0:12 and stayed in the pocket — that's where the counter came from. Score and angle out at 45; don't admire it."
- "You're tall going in. Drop the hips a beat before the entry so the legs load — the first step is where the point is won."
- "Their lead hand drops every time they bounce back — that's your sen no sen window for the kizami-zuki."

## Bad Feedback to Avoid

- "Keep your hands glued to your chin." — Contradicts karate's mobile, bladed kamae.
- "Throw more 4-5 punch combinations." — Contradicts the score-and-exit meta; invites exchanges karate rules punish.
- "Snap the punch back like a boxing jab." — Misreads kime; the fix is the exit, not the retraction style.
- "Follow through on that head kick." — Coaches a penalty (excessive contact) under point rules.

## Output Guidance

- **Coach's Read**: the distance-and-timing story — who owned ma-ai, whose entries landed, who exited safely, whose rhythm was read.
- **3 Adjustments**: technical = entry mechanics (loading, hikite, extension); tactical = range, timing window, exit angle; habit = a drill (e.g. blitz-and-angle-out reps, counter-timing drills off a partner's bounce).
- **Quick Cues**: "Half-step, then blitz", "Score and get out", "Hips down before the entry".
- **Replay Evidence**: label entries, exits, and counter windows; note whether the exit angle changed.
- **Confidence note**: flag rear-side occlusion from the bladed stance and any blur-limited reads.

## Suggested FightLang Event Names

- attack_from_too_far
- score_and_stay
- blitz_entry
- straight_line_exit
- angle_exit_missing
- stance_too_tall
- lead_hand_drop
- counter_window_open
- overcommit_entry
- failed_distance_recovery
- chamber_missing
- retraction_late
- balance_break_after_attack
