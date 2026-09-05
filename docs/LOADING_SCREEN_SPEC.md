# Spec — "Preparing your clip" engagement content

Status: **DRAFT / planning** · Owner: Duncan

## 1. Goal

Fill the 30–60s deep-tracking wait (the "PREPARING YOUR CLIP" boot overlay,
which pre-scans ~1000 frames) with rotating content so it feels intentional, not
stalled — fight wisdom quotes and/or "get better results" tips, cycling while the
frames load. Secondary win: the tips quietly teach users how to get better
analysis (e.g. one clear pair per clip).

## 2. Current state (verified in code)

- The boot overlay lives in `FightCoachExperience.tsx` — a `z-[60]` full-cover
  panel: spinner + "Preparing your clip" + a live `Deep tracking N/996 frames…`
  line + three phase chips (Buffer / Pre-scan / Ready) + a progress bar + one
  static helper line ("MediaPipe pose tracking runs locally while paused…").
- The selected sport/clipType is known at this point (used elsewhere in the
  component) — so content can be sport-aware.
- No rotating/engagement content today; the helper line is static.

## 3. Requirements

- **F1** Rotating lines: cycle a curated line every ~6s with a gentle fade.
- **F2** Non-blocking: purely presentational; must never delay or interfere with
  the tracking pass or the "click Play when Ready" instruction.
- **F3** Sport-aware: prefer a line tagged for the selected sport; fall back to
  general lines.
- **F4** Mix of types: `quote` (fight wisdom) and `tip` (how to get better
  analysis) — weighted so at least one useful tip appears per session.
- **F5** Accessibility: respect `prefers-reduced-motion` (no fade, just swap or
  hold one line); `aria-live="polite"` so it isn't spammy to screen readers.
- **F6** Deterministic-enough: no `Math.random` at module load; seed rotation by
  an index/time so it's stable per mount.
- **F7** Legal-safe content: public-domain backbone (see §6).

## 4. Design

### Content model (`src/lib/wisdom.ts`)
```ts
export type WisdomLine = {
  text: string
  author?: string        // e.g. "Musashi", "Bruce Lee", "Cus D'Amato"
  source?: string        // e.g. "The Book of Five Rings"
  kind: 'quote' | 'tip'
  sports?: SportKey[]    // omit = general; else prefer for these sports
}
export const WISDOM: WisdomLine[] = [ /* curated, see §6 */ ]
export function pickWisdom(sport: SportKey | null, seed: number): WisdomLine[]
```
`pickWisdom` returns an ordered playlist: sport-matched first, then general,
guaranteeing ≥1 `tip`. Pure + unit-testable (test: sport filtering, tip
guarantee, stable order for a seed).

### Component (`src/components/fight/RotatingWisdom.tsx`)
- Props: `{ sport: SportKey | null }`.
- Builds the playlist once on mount; advances an index on a `setInterval(~6s)`.
- Renders current line: `“{text}”` + `— {author}{, source}`.
- CSS fade via a keyframe; disabled under `prefers-reduced-motion`.
- `aria-live="polite"`.

### Integration
- Replace the single static helper line in the boot overlay with
  `<RotatingWisdom sport={selectedSport} />`.
- Keep the phase chips + `Deep tracking N/996` line exactly as-is (that's the
  real progress signal; wisdom is the flavor beneath it).

## 5. Phasing
- **Phase 1** — `wisdom.ts` (general quotes + tips) + `RotatingWisdom` + swap
  into overlay. ~1 component + 1 data file + 1 test. Small.
- **Phase 2** — sport-aware playlists + weighted tip guarantee.
- **Phase 3** — polish: phase-linked micro-copy ("Reading guard positions…"),
  subtle crest animation.

## 6. Content sourcing & legal note
- **Backbone: *The Book of Five Rings* (Miyamoto Musashi)** — public domain;
  safest, on-brand. Use these freely.
- **Accents:** short, attributed lines in the spirit of Bruce Lee / Cus D'Amato
  / boxing corners. Keep them short and attributed; a handful of brief attributed
  quotes is low-risk, but **run the final list past the same lawyer review as the
  privacy spec** to be safe, and lean on Five Rings as the majority.
- **Tips** (fully owned, no attribution risk) — e.g.:
  - "One clear pair per clip gets the sharpest read."
  - "Good light and a steady camera beat 4K every time."
  - "Trim to the exchange that matters — Musashi reads intent, not runtime."
- Curate ~15–20 lines for Phase 1; Duncan approves the final list.

## 7. Acceptance criteria
- Overlay shows a rotating line that changes ~every 6s and never blocks tracking.
- A BJJ clip surfaces at least one grappling/appropriate line; a boxing clip
  does not show a grappling-only line.
- Every session shows at least one actionable tip.
- Reduced-motion users get a static/held line, no flashing.
- `pickWisdom` unit tests pass (sport filter, tip guarantee, stable order).

## 8. Out of scope
- Server-fetched/remote quote lists (static in-bundle is fine and faster).
- Localization (English only for launch).
