# Click-to-select fighters + AI auto-suggest — wiring guide

Goal: let the user pick **which 1 or 2 people** to track (by tap, or accept the
AI suggestion), so background bystanders are ignored. This is the fix for
clip3's "10–11 active detections" clutter.

Logic is done and unit-tested: [`src/lib/pose/fighterSelection.ts`](src/lib/pose/fighterSelection.ts)
(+ `.test.ts`, 6/6 passing). It's **pure and inert** — nothing happens until
the 3 wiring steps below. Left un-wired on purpose: the seeding edit touches the
identity core ([FightAnalyzer.tsx](src/components/video/FightAnalyzer.tsx)), and
that must be done where it can be deep-pass tested against all 3 clips, not blind.

## How it plugs in (opt-in, no-regression)

The selection is an **override**. With no selection, the tracker auto-picks A/B
exactly as today (so clip1/clip2 cannot regress).

1. **Collect candidates** where the dense pass / pre-scan has all detected poses
   (FightAnalyzer, after `detectedPoses` is built ~line 1000). Build a
   `Candidate[]` (box from visible-landmark bounds, center = hip midpoint,
   motion = torso displacement vs previous frame).

2. **Choose the focus set:**
   - manual: on a video tap, convert to normalized coords and call
     `pickByClick(candidates, point)`; store the chosen person's center as a
     "focus anchor" for slot A (1st pick) / B (2nd pick).
   - AI-assist: a "Suggest" button calls `suggestFighters(candidates)` and
     pre-fills the two anchors. (Same heuristic the tracker can show as a hint.)
   - "1 fighter vs both" toggle: keep 1 or 2 anchors.

3. **Seed A/B from the anchors** instead of auto-select. At the point where the
   dense pass seeds its follow boxes (`denseBoxesRef`, init from the sparse
   pre-scan) and where corners are assigned, prefer the candidate nearest each
   focus anchor. Persist the anchors so the whole clip locks to the chosen
   people; ignore detections far from both anchors (the bystander rejection).
   **Bump `TRACK_PIPELINE_VERSION`** so cached tracks regenerate.

## UI

- A small "Select fighters" toggle near the SKELETON ON pill. When on, taps on
  the video pick people (highlight chosen, dim others). Show the AI suggestion
  as a 1-click accept.
- Selection state lives in FightCoachExperience; pass anchors down to
  FightAnalyzer as a prop, read in the seeding step above.

## Proof-test (do before shipping)

Load clip3, select the 2 fighters (or accept the suggestion), re-run the deep
pass, and confirm: identity teleports drop (was ~35–41) and no background person
is ever tracked as A/B. Re-run clip1/clip2 with NO selection and confirm their
numbers are unchanged (auto-select path untouched).

## Can AI help decide who to select?

Yes — `suggestFighters` is the lightweight version (size + centrality + motion).
A stronger version (later): feed the candidate crops to a small classifier or the
existing Gemini path to label "fighter vs spectator/coach/referee," but the
heuristic already handles the common case (the 2 biggest central movers).
