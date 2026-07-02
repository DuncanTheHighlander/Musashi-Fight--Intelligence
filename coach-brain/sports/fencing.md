# Fencing Coaching Brain

## Purpose

Helps Musashi analyze fencing: distance (measure), tempo, priority/right-of-way mechanics, preparation discipline, and recovery. Blades are too thin, fast, and blurred for reliable video tracking — the brain infers blade lines and threats from body kinematics (wrist, elbow, shoulder, arm extension) and never hallucinates blade contact.

## Core Tactical Priorities

1. **Distance / measure as a dynamic state** — out of measure (safe), long (advance-lunge needed), medium (single lunge lands), short (arm extension alone reaches — the danger zone), close/infighting. Deliberate transitions between zones set traps; drifting between them loses touches.
2. **Timing and tempo** — actions succeed by breaking the opponent's rhythm and striking during *lost time* (temps perdu): mid-direction-change, mid-step, or mid-recovery.
3. **Right-of-way discipline (foil/sabre)** — the extension must precede or accompany the footwork ("hand before foot"). Advancing with a bent arm is a preparation, not an attack, and cedes priority.
4. **Preparation vs overcommitment** — good preparations close distance while keeping the ability to retreat or parry; leaning weight onto the front leg during preparation creates a punishable window.
5. **Recovery** — after a lunge, snap back to en garde in one tempo. Lingering extended ("admiring the touch") invites the riposte.
6. **Second intention** — deliberately short attacks or drawn parries to trigger a predictable reaction, then counter it. Recognizable by planned short lunges with immediate balanced recovery.

## Common Positions / Phases

- **En garde**: elite stances use moderate knee bend (deep squats slow the launch) and a slight forward torso bias, calibrated per fencer — stances are idiosyncratic.
- **Lunge**: arm extends, rear leg drives; front knee lands roughly over the ankle (excess over-travel strains the knee and kills recovery).
- **Flèche** (foil/épée): explosive crossover run; arm fully extended before the rear foot crosses.
- **Parry-riposte**: tight lateral/circular hand movements closing a line (4 = high inside, 6 = high outside, 7/8 = low lines), point staying on target.
- **Recovery**: rear leg bends, front heel pushes back, guard re-forms in one motion.
- **Infighting / close distance**: bodies overlap; tracking degrades — fall back to tactical tags.

## Common Mistakes

- **Attacking from too far** — full lunge from long/outside measure without a preparation; the defender simply retreats.
- **Bent-arm attack (arm late)** — footwork launches before the extension; loses priority and exposes the attacker to the stop-hit.
- **Teapotting** — torso pitches forward over the front knee in the lunge; recovery becomes impossible.
- **Predictable straight retreats** — three-plus uniform backward steps build the attacker a runway; retreats need tempo changes, half-steps, and threat.
- **Failed distance recovery** — standing in the extended lunge after the attack misses or is parried.
- **Overcommitted preparation** — deep step with the arm back and weight committed; stop-hit bait.
- **Repeating the same line** — consecutive attacks into an unchanged defensive line without disengages.

## High-Value FightLang Events

`attack_from_too_far`, `attack_arm_late`, `lunge_recovery_late`, `failed_distance_recovery`, `straight_retreat`, `overcommit_attack`, `preparation_exposed`, `balance_break_after_lunge`, `counter_lunge_window`, `second_intention_drawn`, `angle_change_missing`, `distance_closed_unprepared`

## What AI Vision Should Look For

- Inter-fencer distance and which measure zone each action launches from.
- Extension timing vs front-foot acceleration (hand-before-foot priority read).
- Torso inclination and front-knee position during lunges (teapotting, over-travel).
- Retreat step rhythm: uniform vs varied tempo.
- Time from lunge completion to backward weight shift (recovery speed).
- Inferred blade lines from hand/elbow position relative to the torso midline and elbow height — never from blade pixels.

## What RTMPose / MediaPipe Should Measure

- Shoulder-to-wrist extension distance vs. the fencer's own calibrated max (arm-extension percentage).
- Center-of-mass velocity/acceleration during lunges and flèches.
- Front knee angle at lunge landing; torso angle vs vertical.
- Retreat step timing variance across consecutive steps.
- Time between front-foot landing and backward COM motion (recovery latency).
Normalize per fencer (stances and proportions vary); thresholds internal only.

## Coaching Rules

- Never assert blade contact ("you were parried", "you beat the blade") unless scoring-light data or an unmistakable wrist-trajectory disruption confirms it — describe body mechanics instead ("their hand closed line 4 as you extended").
- On priority calls, present kinematic facts (who extended first, by how much) rather than verdicts — the referee owns the call.
- Coach distance context on every failed attack: which measure it launched from and what preparation was missing.
- Coach recovery with the same weight as the attack.
- When direct attacks keep failing, suggest second-intention setups rather than "more speed".

## Caution / Uncertainty Rules

- Blades are unreliable on video: blur, occlusion, flexibility. All blade-level claims must be probabilistic and body-derived.
- Under ~0.5 m separation (infighting/corps-à-corps), suppress detailed kinematics; log the phase and resume when they separate.
- Calibrate against each fencer's own baseline stance before flagging posture — non-standard en garde is normal.
- Minor rear-foot rolling during max-effort lunges is common even among elites — only flag when it visibly impedes recovery or balance.

## Good Feedback Patterns

- "Your front foot lands with the arm barely over half extended — that's a preparation, not an attack, and it hands them priority. Push the point out first, then let the legs carry it."
- "Three identical retreats in a row built them a runway. Break the rhythm — half-step, pause, threaten the counter — and make them re-solve the distance every step."
- "Four straight lunges from long distance, all pulled short. Steal into medium measure with a half-advance before committing the lunge."
- "They keep stop-hitting your direct attack — draw it on purpose: short lunge, recover immediately, and take the counter-parry when they bite."

## Bad Feedback to Avoid

- "You failed to parry their blade." — Camera can't verify blade contact; coach the hand position and timing instead.
- "Fence faster / want it more." — No kinematic content; give the measurable fix.
- "Keep the back foot perfectly flat." — Over-indexes on classical form; elite fencers roll the rear foot at max effort.
- Praising an "explosive attack" that advanced with a bent arm into an established point-in-line — a right-of-way failure, not a highlight.

## Output Guidance

- **Coach's Read**: the distance-and-tempo story — which measures the touches were won in, who controlled preparation, whose recovery held.
- **3 Adjustments**: technical = extension timing / lunge posture / recovery mechanics; tactical = measure management, tempo breaks, second intention; habit = a drill (e.g. hand-first wall-target extensions, varied-retreat footwork ladders, short-lunge-recover-counter patterns).
- **Quick Cues**: "Point first, feet second", "Break the retreat rhythm", "Recover in one tempo".
- **Replay Evidence**: label late arms, long-distance launches, lingering lunges, and drawn reactions.
- **Confidence note**: state explicitly when blade action is inferred from body mechanics, and suppress claims during infighting.

## Suggested FightLang Event Names

- distance_outside_measure
- distance_long
- distance_medium
- distance_short
- distance_closed_unprepared
- advance_preparation
- straight_retreat
- tempo_broken_half_step
- attack_arm_early
- attack_arm_late
- attack_from_too_far
- lunge_initiated
- front_foot_commitment
- overcommit_attack
- balance_break_after_lunge
- lunge_recovery_late
- failed_distance_recovery
- blade_line_4_closed
- blade_line_6_closed
- angle_change_missing
- preparation_exposed
- second_intention_drawn
- counter_lunge_window
- punishment_temps_perdu
