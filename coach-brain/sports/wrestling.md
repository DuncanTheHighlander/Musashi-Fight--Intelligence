# Wrestling Coaching Brain

## Purpose

Helps Musashi analyze wrestling: the battle for leverage, posture, and the opponent's center of gravity across neutral, top, and bottom phases. The brain diagnoses root causes (stance height, setups, head position, hip alignment) rather than outcomes ("got taken down").

## Core Tactical Priorities

1. **Center of gravity & level changes** — level changes come from the knees, not the waist. Bending at the waist ("piking") kills drive, exposes the neck, and telegraphs.
2. **Structural alignment** — head up, hips under shoulders, spine straight. The head is both shield and postural anchor; if it drops, the position is dying.
3. **Inside position & hand fighting** — clearing ties, winning underhooks and wrist control opens the path to legs and hips. Attacks into intact defenses fail.
4. **Setups before shots** — a shot on a balanced opponent with live hands is a tactical error regardless of shot mechanics. Snap, fake, or tie first.
5. **Chain wrestling / kinetic continuity** — no pauses between efforts. Blocked shot → immediate re-attack, angle change, or front headlock. Static pauses concede everything.
6. **Hips and pressure in top/bottom** — top: stay off the knees, weight through the opponent, break them flat. Bottom: build the base, win wrist control, hip heist or stand up.

## Common Positions / Phases

- **Neutral**: staggered stance, knees flexed, lateral motion without crossing feet; ties (collar, two-on-one, underhook) to create reactions.
- **Penetration step**: level change → lead step between their feet → lead knee to the mat → trail leg drives through; head up and tight to their body.
- **Sprawl / defense**: legs thrown back, hips (not knees) driven down onto the attacker's shoulders/head, then circle, front headlock, or go-behind.
- **Top phase**: breakdowns (spiral ride, claw, tight waist), mat returns off the standup (waist lock, lift/trip, return safely), constant pressure on the toes.
- **Bottom phase**: base up, two-on-one wrist control, stand-up (outside leg up, drive back, cut away) or sit-out → hip heist.
- **Scramble**: chaotic transitions — control is only established when one wrestler dictates the other's hip movement.

## Common Mistakes

- **Shooting from too far / reaching** — fully extended arrival, no leg drive; free sprawl and front headlock for the opponent.
- **Piking (waist bend) on level changes** — no drive, exposed neck, easy snap-down.
- **Shot without setup** — the defender's head and hands are intact; shot dies at the first line of defense.
- **Head drops or goes outside on shots** — loses the fulcrum, invites guillotines/front headlocks.
- **Both knees down mid-penetration** — momentum dies under the sprawl.
- **Sprawling to the knees instead of the hips** — no weight transfer, the shot keeps driving.
- **Losing inside position / wrist control** — offense (neutral) and escapes (bottom) become nearly impossible.
- **Kinetic pauses** — resetting to neutral after a defended attack instead of chaining.

## High-Value FightLang Events

`stance_too_tall`, `shot_from_too_far`, `shot_without_setup`, `level_change_missing`, `penetration_step_missing`, `head_position_fault`, `hips_back_on_finish`, `sprawl_late`, `chain_wrestling_break`, `re_attack_missing`, `mat_return_opportunity`, `bottom_flattened`, `inside_tie_lost`, `wrist_control_lost`

## What AI Vision Should Look For

- Stance height (knee flexion) and stagger before exchanges; who wins the hand fight and inside space.
- Forward velocity of head/shoulders and hips on shots — explosive entries beat reactions; hips lagging behind shoulders on finishes stalls the drive.
- Sprawl mechanics: do the hips spike down before/instead of the knees touching?
- Whether contact/ties/fakes preceded the shot (look 1–2 seconds back).
- Top phase: whose weight is on whom (top wrestler on toes vs. knees), whether the bottom base is flattened.
- Scramble vs control: opposing hip vectors without stabilization = scramble; don't assign dominance prematurely.

## What RTMPose / MediaPipe Should Measure

- Knee flexion angle in neutral (stance height) and during level changes (knees vs waist).
- Trunk-vs-femur angle during shots (piking detector).
- Head/ear alignment relative to spine during shots and clinches (cervical flexion fault).
- Hip vs shoulder alignment during the drive/finish phase.
- Hip vertical trajectory in sprawls (hips down before knees).
- Wrist/elbow positions vs opponent's centerline (inside control).
Thresholds internal only; coach qualitatively unless measured.

## Coaching Rules

- **Rule of setups**: if a shot fails, check the preceding 1–2 seconds first — no tie/fake/snap means the diagnosis is the setup, not the shot.
- **Posture over power**: failed finishes are alignment problems (head, hips, spine) before strength problems.
- **Sprawl priority**: evaluate head/hands block → hip pressure → leg withdrawal, in that order; knees-first sprawls are automatic faults.
- **Continuity rule**: after any defended attack (either direction), expect an immediate follow-up; flag static pauses.
- **Bottom rule**: escapes start with wrist control; coach the grips before the movement.

## Caution / Uncertainty Rules

- Ground grappling occludes heavily — when limbs vanish, infer from hips/shoulders geometry or explicitly call it an occluded scramble; never hallucinate grips.
- Don't assign top/bottom dominance during live scrambles; control = dictating the opponent's hip movement for sustained time.
- Monocular depth distorts shot distance — hedge "too far" claims unless the geometry is clear.
- Grip micro-detail (fingers, wrist grips) is often invisible; infer from forearm/elbow vectors and say so.

## Good Feedback Patterns

- "Your head dropped on the entry and your hips trailed your shoulders on the drive — that's why the double stalled. Eyes up, forehead into the ribs, trail leg through faster."
- "You sprawled to your knees, not your hips — none of your weight landed on them. Throw the legs back, laces down, and drive the hips into their shoulders."
- "The penetration step was clean but you shot on a set opponent. Snap the collar tie or fake first so they plant a foot, then change levels."
- "You flattened out on bottom because you never won the wrists. Two-on-one immediately off the whistle, peel the tight waist, then build the base."

## Bad Feedback to Avoid

- "Shoot faster." — Explain the missing setup or the mechanical leak instead.
- "Don't let him take you down." — Name the specific defensive failure (late hips, no hand fight, tall stance).
- "Work harder on bottom." — Escapes are leverage and grips, not effort.
- "Get deeper on the shot." — Say how: lead knee to the mat, step between their feet, head tight.

## Output Guidance

- **Coach's Read**: the positional story — who won the hand fight, whose posture broke first, where the chain stopped.
- **3 Adjustments**: technical = the alignment/mechanics fix (head, hips, level change); tactical = setups, re-attacks, ride/escape selection; habit = a drill (e.g. penetration-step ladders, sprawl-and-circle reps, two-on-one escape starts).
- **Quick Cues**: "Head up on the shot", "Hips, not knees, on the sprawl", "Chain it — second attack ready".
- **Replay Evidence**: label the setup (or its absence), the posture break, and the missed re-attack/mat return at their timestamps.
- **Confidence note**: flag occluded scrambles and any identity uncertainty in tangles.

## Suggested FightLang Event Names

- stance_too_tall
- stance_square_vulnerable
- shot_from_too_far
- shot_without_setup
- level_change_missing
- level_change_waist_bend
- penetration_step_missing
- trail_leg_drive_stalled
- head_position_fault
- hips_back_on_finish
- re_attack_missing
- sprawl_late
- sprawl_hips_high
- mat_return_opportunity
- mat_return_achieved
- bottom_flattened
- standup_base_broken
- hip_heist_executed
- inside_tie_lost
- wrist_control_lost
- chain_wrestling_break
- top_pressure_relieved
- spiral_ride_secured
