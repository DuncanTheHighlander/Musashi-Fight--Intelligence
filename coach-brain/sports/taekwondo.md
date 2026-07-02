# Taekwondo Coaching Brain

## Purpose

Helps Musashi analyze World Taekwondo (WT) style sparring: a kick-dominant, electronic-scoring sport built on leg fencing, chamber/retraction mechanics, and single-leg balance. The brain must never coach TKD like boxing or Muay Thai — the bladed stance, the cut-kick meta, and sensor scoring rules define what "correct" means.

## Core Tactical Priorities

1. **Kicking distance** — fights live at the edge of leg range; dart in, score, bounce out. Controlling the outer perimeter is the primary objective.
2. **The cut-kick / lead-leg meta** — electronic scoring shifted the sport to the lead leg: the cut kick scores, blocks, and manages distance simultaneously.
3. **Sensor-aware targeting** — body (hogu) scores need real impact; head scores need only a touch. Never coach "kick the head harder" — a brush is full points; extra force just risks balance.
4. **Chamber and retraction** — knee up first (hides trajectory, stores energy), then extend; re-chamber immediately after impact to prevent grabs/counters and enable multi-kicks without putting the foot down.
5. **Proximal-to-distal sequencing** — hip rotation peaks first, then knee extension, then foot speed. Broken sequencing = slow, readable "flappy" kicks.
6. **Single-leg stability** — most of the fight happens on one leg; landing bladed and balanced after every kick is non-negotiable.

## Common Positions / Phases

- **Bounce/stance**: heavily bladed, narrow-profile lateral stance, constant springing; minimizes the sensor target and loads the calves.
- **Setup / feints**: lead-leg pumps, shuffles, and rhythm changes to draw reactions before real attacks.
- **Attack**: chamber → extension. Swing kicks (dollyo chagi/roundhouse — highest foot speed) vs push kicks (dwit chagi/back kick — piston power).
- **Retraction and reset**: violent re-chamber, land back in the bladed stance at range; or chain the second kick without the foot touching down.
- **Clash/clinch**: modern rules see fighters jam each other; short crescent/axe kicks from close range and quick disengages.

## Common Mistakes

- **Kick without setup** — launched from a static base with no feint/footwork; telegraphed, easily cut-kicked.
- **Missing the chamber** — foot swings up in a wide arc without the knee lift; slow, weak, readable.
- **Late retraction** — leg hangs extended; caught, swept, or countered, and balance is gone.
- **Hands drop during kicks** — both hands falling below the hips for momentum leaves the head open to the fast head-kick counter.
- **Landing square** — chest sensors face the opponent after the kick; free target.
- **Unbalanced spin entries** — vertical/lateral sway during back kicks and spinning hooks kills both scoring chance and defense.

## High-Value FightLang Events

`kick_without_setup`, `chamber_missing`, `retraction_late`, `hands_drop_during_kick`, `land_square_after_kick`, `counter_kick_window`, `spin_entry_unbalanced`, `kick_recovery_late`, `stance_too_narrow`, `score_and_stay`

## What AI Vision Should Look For

- Pivot-foot rotation on roundhouse/back kicks (support foot turning away opens the hip; no pivot = fundamental fault).
- Knee height/chamber before extension; sequencing of hip → knee → foot velocities.
- Post-kick landing: bladed and at range vs squared and inside.
- Lead-leg activity: cut kicks used to intercept advances; missed intercept windows.
- Balance trajectory during spinning techniques.
- Clinch/clash phases: distance collapse, jamming, and disengage quality.

## What RTMPose / MediaPipe Should Measure

- Knee extension angular velocity and peak foot velocity on kicks.
- Hip flexion/abduction during chambers (elite chambers are high and tight).
- Time from impact to re-chamber and to foot re-planting.
- Wrist height vs hips during kick execution.
- Torso/hip orientation relative to the opponent after landing (squared vs bladed).
- Center-of-mass sway during spins.
Thresholds internal only; coach qualitatively unless measured.

## Coaching Rules

- Never penalize the bladed stance or lower hands at range — that's the sport's geometry; flag hand drops only during kick execution/exchanges.
- Retraction and landing are half the technique — weight them equally with the strike.
- Respect the cut kick as jab/shield/range-finder; coach its timing against advances.
- Differentiate power needs by target: body = impact, head = touch. Never coach more force on head kicks.
- Coach setups (skip-step, feint, broken rhythm) before coaching the kick itself when attacks are being read.

## Caution / Uncertainty Rules

- Spinning techniques self-occlude — use cautious wording on joint-level claims mid-spin; prefer entry/exit balance reads.
- Fast multi-kick clashes produce blur and limb tangles — flag ambiguity instead of guessing which leg scored.
- A visually hard kick may not have hit a sensor zone; don't equate visual impact with scoring.
- If feet aren't clearly visible, skip pivot-foot and stance-width claims.

## Good Feedback Patterns

- "Your roundhouse leaves the leg hanging after impact — that's the grab-and-counter window. Snap the heel back to your glute before the foot comes down."
- "You're launching the back kick from a dead stop. Sell it with the cut-kick feint first so their weight commits forward, then spin."
- "You land square after the head kick — the whole hogu faces them. Rotate the hips on the way down and land bladed."
- "The chamber is missing on the lead-leg kick — it's swinging up in an arc they can see coming. Knee to chest first, then extend."

## Bad Feedback to Avoid

- "Throw more punches to the head." — Illegal in WT; penalty.
- "Square your hips so you can hook." — Squaring up exposes the entire sensor vest; core TKD error.
- "That head kick was too light." — A touch to the head scores full points; extra force only risks balance.
- "Check that kick with your shin." — Muay Thai concept; TKD answers with footwork, distance, or the cut kick.

## Output Guidance

- **Coach's Read**: the leg-fencing story — who owned the perimeter, whose lead leg controlled exchanges, whose setups and retractions held up.
- **3 Adjustments**: technical = chamber/retraction/pivot mechanics; tactical = setups, cut-kick timing, distance resets; habit = a drill (e.g. chamber-hold reps, kick-retract-land-bladed circuits, feint-then-spin patterns).
- **Quick Cues**: "Knee up first", "Snap it back", "Land bladed".
- **Replay Evidence**: label missed chambers, hanging legs, square landings, counter-kick windows.
- **Confidence note**: flag spin occlusion, blur-limited exchanges, and sensor-vs-visual scoring uncertainty.

## Suggested FightLang Event Names

- kick_without_setup
- chamber_missing
- retraction_late
- hands_drop_during_kick
- land_square_after_kick
- balance_after_kick
- counter_kick_window
- distance_closed_after_kick
- spin_entry_unbalanced
- kick_recovery_late
- stance_too_narrow
- score_and_stay
