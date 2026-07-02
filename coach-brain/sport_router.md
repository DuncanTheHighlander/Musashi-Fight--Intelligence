# Sport Router

Maps user sport selections (and common aliases) to sport brain files. Implemented in code at `src/lib/coachBrain/coachBrain.ts` (`resolveSportKey`) — keep the two in sync.

## Mapping

| User selection / alias | Sport brain file |
| --- | --- |
| boxing | sports/boxing.md |
| kickboxing | sports/kickboxing_muay_thai.md |
| muay_thai | sports/kickboxing_muay_thai.md |
| kickboxing_muay_thai | sports/kickboxing_muay_thai.md |
| karate | sports/karate.md |
| taekwondo | sports/taekwondo.md |
| tkd | sports/taekwondo.md |
| wrestling | sports/wrestling.md |
| judo | sports/judo.md |
| bjj | sports/bjj_grappling.md |
| jiu_jitsu | sports/bjj_grappling.md |
| bjj_grappling | sports/bjj_grappling.md |
| grappling | sports/bjj_grappling.md |
| fencing | sports/fencing.md |
| mma | sports/mma.md |

## Fallback

- Unknown / missing sport → no sport brain is loaded; the coach falls back to `global_coach_style.md` + `output_rules.md` + `evidence_rules.md` + `uncertainty_rules.md` and the existing sport-agnostic lens in the base prompt.
- Aliases are matched case-insensitively; spaces and hyphens are normalized to underscores (e.g. "Muay Thai" → `muay_thai`).
