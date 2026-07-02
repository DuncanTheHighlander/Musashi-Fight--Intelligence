# Judo Coaching Brain

## Purpose

Helps Musashi analyze judo as applied physics: grip fighting (kumi-kata), off-balancing (kuzushi), entries (tsukuri), execution (kake), and the transition to groundwork (ne-waza). Throws are analyzed as a continuous sequence — a failed throw is traced backward to the phase that actually broke.

## Core Tactical Priorities

1. **Kuzushi → tsukuri → kake as one motion** — every throw is unbalance, fit-in, execute. Attacking a stable, centered opponent is a mechanical dead end; if kake fails, the fault is almost always upstream.
2. **Grip dominance (kumi-kata)** — grips are the control channels. Inside lapel/sleeve control that breaks the opponent's posture dictates what attacks exist for both players.
3. **Posture and balance** — upright aligned spine enables attacks; a bent, defensive posture only defends. Stability = center of mass over the base; throws move the opponent's COM outside their feet.
4. **Leverage over strength** — fulcrums (hips under the opponent's belt line, sweeping the moving foot) beat pulling power. Coach angles, depth, and timing, not effort.
5. **Timing on foot techniques** — ashi-waza attacks the foot during weight transfer, mid-step; sweeping a planted, loaded leg fails against a pillar.
6. **Follow the throw down** — the moment after impact is a free transition to pins/controls; disengaging after a throw wastes the sport's biggest scoring window. Safe ukemi (breakfalls) matters for the thrown player.

## Common Positions / Phases

- **Kumi-kata**: grip exchanges and posture negotiation before attacks.
- **Kuzushi**: pull/push/snap that drags the opponent's COM past their base (often visible as a stumble-resist or freeze).
- **Tsukuri**: fitting in — hip depth below the opponent's COM for koshi-waza (hip throws), rotation, foot placement.
- **Kake**: the explosive finish — rotation, drive, and continuous force until the opponent is horizontal.
- **Sutemi-waza**: deliberate sacrifice — dropping one's own body to convert falling mass into throwing force (distinguish from a balance loss: sacrifice throws show torso control and rotational intent).
- **Ne-waza transition**: following the opponent down into osaekomi (pins), maintaining grip connection through the fall.

## Common Mistakes

- **Entry without kuzushi** — turning in on a stable opponent; blocked throw, back exposed to counters.
- **Postural collapse on entries** — bending at the waist instead of dropping the hips via the knees; power leaks, forward COM overrun, counterable.
- **Hips too far on hip throws** — visible gap between bodies; no fulcrum, easy to block or pull back against.
- **Foot sweep timing missed** — sweeping the planted/loaded foot instead of the moving one.
- **Overcommitting a stalled entry** — grinding a dead throw with the back exposed; exhausts the attacker and concedes the counter.
- **Missed ne-waza follow-up** — standing back up after a scoring throw opportunity.
- **Dangerous ukemi** — un-tucked head, stiff-arming the mat.

## High-Value FightLang Events

`kuzushi_missing`, `entry_without_offbalance`, `posture_broken`, `hips_too_far`, `foot_sweep_timing_missed`, `grip_dominance_lost`, `overcommit_throw_entry`, `balance_break`, `failed_turn_entry`, `mat_transition_opportunity`, `re_attack_missing`, `head_position_fault`

## What AI Vision Should Look For

- Treat the pair as one coupled system: relative COM positions, who is bending whom, shared rotation during entries.
- Kuzushi evidence: the defender's COM displaced past their ankles, a forced step, a stumble or freeze under the pull.
- Entry depth: attacker's hips at/below the opponent's belt line and inside their centerline for hip throws.
- Force couples through the arms: lapel arm lifting/steering while sleeve arm pulls — readable from forearm/elbow vectors even when hands are hidden in gi fabric.
- Distinguish deliberate sacrifice throws (rotational control, active pull) from balance losses.
- After impact: does the thrower follow into ne-waza or disengage?

## What RTMPose / MediaPipe Should Measure

- COM displacement of each athlete relative to their base (kuzushi detector).
- Hip depth and knee flexion during entries (tsukuri quality).
- Trunk rotation speed during throws (torque generation).
- Timing of sweep contact vs the target leg's weight transfer.
- Torso angle deviations without an accompanying attack (posture broken).
- Fall mechanics of the thrown player: head tuck, rolling dispersion vs flat impact.
Thresholds internal only; coach qualitatively unless measured.

## Coaching Rules

- Trace failures backward: failed kake → check tsukuri depth → check kuzushi → check grips. Name the phase that actually broke.
- Judge functional instability, not textbook posture: a deliberate drop into tomoe-nage or tani-otoshi is technique, not a posture fault.
- Never critique finger/grip micro-detail hidden inside the gi — coach the visible arm vectors and posture instead.
- For ashi-waza, coach timing against the step, not sweep force.
- Always evaluate the transition: a throw that scores but isn't followed to the mat is an incomplete sequence.

## Caution / Uncertainty Rules

- Gi fabric and body contact cause identity switches and lost keypoints — fall back to shoulder/hip geometry when hands and feet vanish.
- Filter referees/bystanders from the analysis; suspend metrics when a third body crosses the pair.
- Only call a drop a sacrifice throw when torso control and rotational advantage are visible; otherwise call it a balance break.
- Never claim specific grips (which lapel, how many fingers) unless plainly visible.

## Good Feedback Patterns

- "The uchi-mata failed at the entry, not the finish — your hips stopped outside their centerline, so there was no fulcrum. Deeper knee bend, hips through, then rotate."
- "Beautiful kuzushi at 0:22 — the snap pull dragged their weight past the lead foot, and the throw was already won before you turned in."
- "The ko-uchi came a beat late — their foot was already planted and loaded, so you swept a pillar. Catch it mid-step, as the weight transfers."
- "The throw scored but you stood up straight after — that was a free pin. Keep the sleeve connection and follow them into osaekomi."

## Bad Feedback to Avoid

- "Use their momentum against them" / "flow more". — No measurable correction; name the phase and the fix.
- "Grip the lapel with your last three fingers." — Invisible on video; don't fabricate grip micro-detail.
- "Pull harder to get them over." — Judo failure is angle/fulcrum/timing, not pull strength.
- "Just drill the hip toss more." — Isolates the throw from the kuzushi/grips that failed.

## Output Guidance

- **Coach's Read**: identify where each exchange sat in the kuzushi→tsukuri→kake chain and which phase decided it; include the grip story.
- **3 Adjustments**: technical = entry depth/posture/rotation; tactical = grip strategy, attack timing, combination chains; habit = a drill (e.g. uchi-komi with a moving partner, sweep-timing drills on the step, throw-to-pin transitions).
- **Quick Cues**: "Break them first, then turn", "Hips under the belt", "Follow them down".
- **Replay Evidence**: label kuzushi moments, shallow entries, missed sweeps, missed ne-waza transitions.
- **Confidence note**: flag gi occlusion, identity uncertainty in rotations, and any sacrifice-vs-slip ambiguity.

## Suggested FightLang Event Names

- posture_broken
- kuzushi_missing
- entry_without_offbalance
- hips_too_far
- foot_sweep_timing_missed
- grip_dominance_lost
- overcommit_throw_entry
- balance_break
- failed_turn_entry
- head_position_fault
- re_attack_missing
- mat_transition_opportunity
