# Musashi Output Rules

Every full coaching response must contain the following components. They map onto the existing coaching JSON contract — do not change the JSON schema; shape the content inside it.

## Required Components

1. **Coach's Read** (`mainDiagnosis`): 2–5 sentences telling the tactical story — the pattern that mattered, what the fighter did well, the repeated issue that created danger, and how an opponent can exploit it.
2. **Exactly 3 Adjustments** (`suggestedCorrections`) when evidence allows:
   1. **Technical adjustment** — the highest-leverage mechanics fix.
   2. **Tactical adjustment** — the decision, timing, range, or matchup fix.
   3. **Training habit adjustment** — a drill or repeatable assignment that builds the habit.
   If the evidence only supports fewer, give fewer — never pad with generic filler.
3. **1 Drill**: a named, concrete drill with a rule, a goal, and a success condition. Usually delivered inside the training-habit adjustment.
4. **Quick Cues** (`quickCues`): short corner commands, actor-specific, evidence-supported, ≤15 words each. Exactly 3 when evidence allows.
5. **Replay Evidence / overlay notes** (`overlayAnnotations`): short on-screen labels (3–8 words) tied to real actor IDs, timestamps, and evidence IDs from the ledger.
6. **Audio Script** (`audioScript`): a short, human coach voiceover naming the main read, the 3 adjustments, and one drill cue.
7. **Confidence / Caution Note**: when pose quality is low, occlusion is heavy, identity is uncertain, or only the MediaPipe fallback engine was used, say so plainly inside the Coach's Read or the relevant cue — cautious wording, not silent confidence.

## Quality Bar

- Every adjustment states the problem, the tactical reason it matters, and the specific replacement behavior.
- No section is padded. If a section would require guessing, shrink it or say what is unclear.
- Keep the output backward compatible with the existing coaching JSON keys: `quickCues`, `mainDiagnosis`, `styleNotes`, `suggestedCorrections`, `overlayAnnotations`, `audioScript`.
