# Musashi MVP polish — design

**Date:** 2026-05-15
**Author:** working session with Claude Opus 4.7
**Status:** Draft, awaiting user review

## Goal

Ship Musashi as an honest MVP: the **fight-coaching loop is real and polished**, and every other surface either works or is gracefully labeled "Preview." Zero buttons that do nothing. Zero faked data masquerading as real.

## Non-goals

- Stripe Checkout / entitlements wiring (deferred).
- Analyst job marketplace, disputes, escrow (deferred).
- Real-time messaging features beyond text (calls, video).
- New CV features (the existing pipeline is the differentiator and is good enough to ship).
- CSP, COOP/COEP, Sentry/observability (separate hardening pass).

## In-scope changes (the work)

### A. Fix what's broken (the showstoppers)

A1. **Logout works.**
- Add `'/api/auth/logout'` to `PUBLIC_PATHS` in `src/middleware.ts:5–13`. The handler in `src/app/api/auth/logout/route.ts:4–19` is currently unreachable for already-expired sessions because the middleware blocks it.
- Reason: the route's whole purpose is to clear server-side session and cookie; gating it behind a valid session cookie defeats the point.

A2. **`/api/auth/me` is not in the auth rate bucket.**
- In `src/middleware.ts:74–80`, separate `/api/auth/me` from the auth rate-limit bucket (`isAuthEndpoint = pathname.startsWith('/api/auth/') && pathname !== '/api/auth/me'`), or give it the larger `RATE_LIMIT_API` ceiling.
- Reason: AuthContext polls `me` on mount and after focus; sharing the 10/min/IP bucket with login/register causes spurious 429s during normal use.

A3. **`/api/test-ai` no longer leaks secrets.**
- Either: (a) require `requireUser({ role: 'shogun' })` and remove `geminiKeyPrefix` / `openaiKeyPrefix` / `allEnvKeys` fields from the response, OR (b) wrap the entire route in `if (process.env.NODE_ENV !== 'production')` and return 404 in prod.
- Recommended: do both — Shogun-only AND scrubbed output.
- Files: `src/app/api/test-ai/route.ts:4–67`.

A4. **Library Delete matches its UI.**
- Two acceptable resolutions:
  - **Hide for non-Shogun users** (cheaper): in `src/components/sections/LibrarySection.tsx`, only render the trash button when `useAuth().user?.role === 'shogun'`.
  - **Per-user ownership** (better but bigger): track `created_by` on documents, allow users to delete their own. Defer.
- Pick the hide-for-non-Shogun path for MVP.

A5. **Scouting paid/free split is correct.**
- Add `budget: row.budget ?? 0` to `mapRequestRow` in `src/app/api/social/scouting/route.ts:69–108`.
- Verify the column name matches the schema (audit cited `budget` as persisted at line 191–207).
- This is a 1-line fix that makes the scouting tab not lie to the user.

A6. **Dead `coachingMode='strategy'` branch is removed.**
- In `src/components/fight/FightCoachExperience.tsx:554, 1343–1394`: delete the `setCoachingMode` state, the `coachingMode` variable, and the `if (mode === 'strategy')` branch in `sendChat`. Keep the `'reflex'` path inline.
- Reason: dead code that confuses future maintainers; no UI ever sets it.

### B. Hide what isn't ready

B1. **Hide nav sections that aren't shippable.**
- In `src/components/layout/Navigation.tsx:34–47`, gate Marketplace, Scouting, Coaches, Messages behind a `NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES` env flag (default off).
- Visible-by-default for MVP: **Fight Lab, Library, Profile, Fighters** (Fighters is read-only and works).
- "Hire Coach" link in nav header points to `/marketplace` — also hidden under the same flag.

B2. **Marketplace, Scouting, Coaches, Messages render a "Preview" landing card** when the flag is off.
- One reusable component: `<ComingSoonSection title icon description />`.
- **Decision:** keep the existing section files unchanged. At the top of each section's render function, check `process.env.NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES !== '1'` and early-return `<ComingSoonSection ... />` if the flag is off. This keeps the original implementations intact, makes the toggle a single line per section, and avoids file-renaming gymnastics.

B3. **Dead per-component buttons are hidden, not greyed out.**
- `FighterCard` "View Profile" button → removed (the card itself is still useful as a directory entry).
- `MarketplaceSection` Cart button → removed.
- `MessagesSection` phone/video/more icons → removed.
- `ProfileSection` "Edit Profile" → removed (Profile becomes read-only). "Account Settings Coming Soon" already disabled — leave as is.

### C. Add the missing infrastructure

C1. **Route-level error pages.**
- Add `src/app/error.tsx` (root segment client error boundary; must be a client component).
- Add `src/app/not-found.tsx` (404 page rendered by Next.js when no route matches; can be a server component).
- Add `src/app/(app)/error.tsx` (per-segment client error boundary) and `src/app/(app)/loading.tsx` (per-segment loading skeleton).
- All four use the existing visual language (Card + Button + AlertCircle from lucide-react). Each shows a Reload + Home action where applicable.

C2. **Audit and document env vars.**
- Update `.env.example` so it accurately lists ALL env vars actually read in `src/`. Include comments per var: required vs optional, dev-only vs prod, what happens when missing.
- **Decision:** comment out `MUSASHI_DISABLE_AUTH=1` (do not delete the line) with a clear `# DEV ONLY — DO NOT SET IN PROD; see src/lib/env.ts:80` warning above it. Leaving the line as a comment preserves discoverability for new devs while removing the dangerous default.
- Reference the prod-required check in `src/lib/env.ts:69–82`.

C3. **Verify build is clean from a fresh checkout.**
- `pnpm install && pnpm exec tsc --noEmit && pnpm lint && pnpm test && pnpm build` must all pass on a fresh clone with the documented env vars.
- This is the verification command for the whole pass per the verification-before-completion skill.

### D. Defensive fixes for silent-mock risk

D1. **Surface the offline mode visually.**
- When `NEXT_PUBLIC_OFFLINE_MODE === '1'` is set in the client bundle, `FightCoachExperience` already short-circuits Gemini (`FightCoachExperience.tsx:1585`). Add a visible banner ("Offline mode — analysis is mocked") at the top of the Fight Lab section so we never accidentally ship in this state without anyone noticing.

D2. **Document `OFFLINE_MODE` / `GEMINI_DRY_RUN` clearly in `.env.example`** with explicit "DEV ONLY" comments.

## Architecture

This is mostly **deletion + gating + new error files** rather than new components. No new dependencies. No DB schema changes.

```
┌────────────────────────────────────────────────────────────────┐
│  Root layout (unchanged structure, gains error.tsx siblings)   │
│  ├── error.tsx           ← NEW                                 │
│  ├── not-found.tsx       ← NEW                                 │
│  └── (app)/                                                    │
│      ├── layout.tsx                                            │
│      ├── error.tsx       ← NEW                                 │
│      ├── loading.tsx     ← NEW                                 │
│      └── page.tsx (HomePage — minor: hide gated sections)      │
│                                                                 │
│  Navigation (gated by NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES)    │
│  Section components (unchanged for visible ones,               │
│                      replaced with ComingSoonSection           │
│                      for hidden ones)                          │
│                                                                 │
│  src/middleware.ts  (PUBLIC_PATHS + auth rate bucket fix)      │
│  src/lib/env.ts     (no change)                                │
│  src/app/api/test-ai/route.ts  (Shogun-only + scrub)           │
│  src/app/api/social/scouting/route.ts  (budget in mapper)      │
│                                                                 │
│  No changes to: kinematics, appearance, FightAnalyzer,         │
│  FightOverlay, videoCanvas, MediaPipe wiring, AuthContext,     │
│  Stripe webhook, library/embeddings, D1 schema, migrations.    │
└────────────────────────────────────────────────────────────────┘
```

## Components

| File | Change | Type |
|---|---|---|
| `src/middleware.ts` | Add `/api/auth/logout` to PUBLIC_PATHS; split `/api/auth/me` from auth rate bucket | edit |
| `src/app/api/test-ai/route.ts` | Shogun-only + remove key prefix fields | edit |
| `src/app/api/social/scouting/route.ts` | Add `budget` to `mapRequestRow` | edit |
| `src/components/layout/Navigation.tsx` | Gate Marketplace/Scouting/Coaches/Messages behind `NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES` | edit |
| `src/components/sections/MarketplaceSection.tsx` | Remove Cart button; render Preview card when flag off | edit |
| `src/components/sections/ScoutingSection.tsx` | Render Preview card when flag off | edit |
| `src/components/sections/CoachesSection.tsx` | Render Preview card when flag off | edit |
| `src/components/sections/MessagesSection.tsx` | Remove phone/video/more icons; Preview card when flag off | edit |
| `src/components/sections/LibrarySection.tsx` | Hide Delete button for non-Shogun users | edit |
| `src/components/sections/ProfileSection.tsx` | Remove "Edit Profile" button | edit |
| `src/components/social/FighterCard.tsx` | Remove "View Profile" button | edit |
| `src/components/fight/FightCoachExperience.tsx` | Delete `coachingMode` strategy dead branch | edit |
| `src/app/(app)/page.tsx` | Add visible "Offline mode" banner when `NEXT_PUBLIC_OFFLINE_MODE === '1'` | edit |
| `src/app/error.tsx` | NEW: root error boundary route file | create |
| `src/app/not-found.tsx` | NEW: 404 page | create |
| `src/app/(app)/error.tsx` | NEW: app segment error boundary | create |
| `src/app/(app)/loading.tsx` | NEW: app segment loading state | create |
| `src/components/sections/ComingSoonSection.tsx` | NEW: reusable Preview card component | create |
| `.env.example` | Audited and documented; `MUSASHI_DISABLE_AUTH` un-defaulted | edit |

**Estimated diff size:** ~600 lines of changes across ~17 files. Mostly small edits + ~5 new ~50-line files.

## Data flow

No data flow changes. Existing client → API → D1 → response remains identical for visible features. Hidden features short-circuit to a Preview card on the client; the API routes still exist (no deletions) so re-enabling later is a single env-var flip.

## Error handling

Three layers, in order from outermost in:

1. **`src/app/error.tsx`** — catches errors in the root layout / pages. Falls back to a Card with "Something went wrong, reload" + "Go home" action. Logs the error via the existing `console.error` flow (the existing `RootErrorBoundary` keeps doing its job for non-routing errors).
2. **`src/app/(app)/error.tsx`** — per-segment fallback for the authenticated app shell.
3. **`src/app/not-found.tsx`** — branded 404 page (currently Next.js falls back to its built-in default).

The existing `RootErrorBoundary` and `PageErrorBoundary` class components remain for client-side render errors that route-level `error.tsx` doesn't catch.

## Testing

- **Existing tests must pass** — the audit found 6 Vitest files (`bootVerification`, `env`, `gemini/reflex-frame`, `appearance`, `overlayGeometry`, `kinematics`). Run `pnpm test` after changes.
- **Add minimal new tests:**
  - `src/middleware.test.ts` — verify `/api/auth/logout` is treated as public; verify `/api/auth/me` doesn't share the auth rate bucket.
  - `src/app/api/social/scouting/route.test.ts` — verify GET response includes `budget`.
- **Manual smoke test checklist** (run on dev server):
  - Log in → main page renders → upload a clip → see skeleton tracking → log out (the test that's currently broken).
  - Visit Library → search returns results → upload a doc → see it in the list → confirm no Delete button as a non-Shogun user.
  - Visit Profile → see real email/role → no broken buttons.
  - Visit Fighters → see directory → no broken "View Profile" button.
  - Trigger an error (e.g., visit `/some-bad-path`) → see branded 404 instead of default Next.js page.
- **No e2e** — out of scope for this pass.

## Verification (per `verification-before-completion`)

Definition of done for this pass:

```
pnpm install            # exit 0
pnpm exec tsc --noEmit  # exit 0
pnpm lint               # exit 0
pnpm test               # all pass, no skipped
pnpm build              # exit 0
```

Plus the manual smoke test checklist above, executed by either the implementer or the user.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Hiding sections breaks deep links from external sources | Keep the route handlers and section components alive; the Preview card is just the default export. URL-based access still loads the underlying section if `NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES=1`. |
| `.env.example` change breaks dev workflow | Document the change in the spec; add a one-time migration note in the spec. Don't delete `MUSASHI_DISABLE_AUTH=1` line — comment it out with explanation. |
| Removing dead `coachingMode` branch breaks something I didn't see | Audit cited that `setCoachingMode` is never called; grep confirms. Removing it is safe. |
| Library delete hide is the wrong fix and we should do per-user ownership | Per-user ownership is acknowledged as the better long-term fix in section A4. Hide-for-non-Shogun is the explicit MVP choice; ownership is a follow-up. |
| Build breaks in fresh checkout because of env vars | Section C2 explicitly requires `pnpm build` to succeed with documented env vars; this is a verification gate. |

## Out of scope (acknowledged but not done in this pass)

- Per-user library document ownership.
- Stripe Checkout for marketplace.
- Wiring fighter profile detail pages.
- Real activity stats on Profile section.
- Sentry / Posthog / observability.
- Content Security Policy.
- CSRF token plumbing.
- Tests for components and API routes (only a couple of targeted unit tests added).
- Per-route SEO / OpenGraph metadata.
- Mobile keyboard handling on the chat input.

## Implementation sequence

The implementation plan (written separately in the next phase via the `writing-plans` skill) will sequence these as:

1. Section C2 first (`.env.example` + verify build) — establishes the green baseline.
2. Section A (broken-fix changes) one at a time, each with verify.
3. Section C1 (error pages) — independent of A.
4. Section B (hiding + Preview cards) — last, because it touches the most files.
5. Section D (offline-mode banner) — quick add at the end.
6. Final full verification gate.

Each step gets its own commit and its own verification, so partial progress is always reviewable and revertable.
