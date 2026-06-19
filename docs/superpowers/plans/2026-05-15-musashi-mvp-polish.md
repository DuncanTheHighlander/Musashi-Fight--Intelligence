# Musashi MVP polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the existing Musashi app so the fight-coaching loop ships honestly: every visible button works, every visible data point is real, every dead/incomplete section is hidden behind a Preview card.

**Architecture:** This is mostly **deletion + gating + small surgical additions**, not new features. No new dependencies, no DB schema changes, no new API routes. Touches ~17 files (~12 edited, ~5 created).

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript (strict), TailwindCSS, Radix/shadcn UI, Vitest. Backend: Cloudflare D1 + Workers via OpenNext.

**Source spec:** `docs/superpowers/specs/2026-05-15-musashi-mvp-polish-design.md`

---

## Task 0: Baseline verification (establish green starting point)

**Files:** none changed — this confirms the current tree builds clean before changes.

- [ ] **Step 1: Verify install**

```bash
pnpm install
```
Expected: exit 0, lockfile unchanged.

- [ ] **Step 2: Typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: exit 0, no diagnostics.

- [ ] **Step 3: Lint**

```bash
pnpm lint
```
Expected: exit 0, no warnings (or only pre-existing acceptable ones).

- [ ] **Step 4: Tests**

```bash
pnpm test
```
Expected: all pass, no skipped.

- [ ] **Step 5: Build (full smoke)**

```bash
pnpm build
```
Expected: exit 0. If this fails, STOP and investigate before doing any other tasks — the spec gate requires fresh builds to work.

- [ ] **Step 6: Commit baseline (no changes, just a marker)**

Skip if working tree is clean. If there are stray uncommitted changes from prior sessions, stash or commit them as a baseline-cleanup commit before starting.

---

## Task 1: `.env.example` audit and `MUSASHI_DISABLE_AUTH` un-default

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Comment out the dangerous default**

In `.env.example`, find line 57 (currently `MUSASHI_DISABLE_AUTH=1`) and replace lines 56–57 with:

```text
# Development Settings (NEVER set in production — see src/lib/env.ts:80)
# Uncomment ONLY for local dev to bypass auth and use a synthetic shogun user.
# MUSASHI_DISABLE_AUTH=1
```

- [ ] **Step 2: Verify all `process.env.*` reads in `src/` have a corresponding documented var**

Run:
```bash
rg "process\.env\.[A-Z_]+" -o --no-filename src | sort -u
```

Cross-check against the variables listed in `.env.example`. For any env var read in `src/` but missing from `.env.example`, add it with a one-line comment describing required/optional + when used. Specifically expect to add or confirm:
- `MUSASHI_AI_KILL_SWITCH` (already documented)
- `MUSASHI_COACHING_CACHE*` (already documented)
- `MUSASHI_CRON_SECRET`
- `NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES` (new flag added by this plan — add it with a comment "set to 1 to show in-progress sections (Marketplace, Scouting, Coaches, Messages); default off for MVP")
- `MUSASHI_SHOGUN_INVITE_CODE` (referenced by `src/lib/musashiAuth.ts:276–314`)

- [ ] **Step 3: Verify build still passes**

```bash
pnpm build
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "chore: audit .env.example and un-default MUSASHI_DISABLE_AUTH"
```

---

## Task 2: Middleware — fix logout block + remove `/api/auth/me` from auth rate bucket

**Files:**
- Modify: `src/middleware.ts:5–13` (PUBLIC_PATHS)
- Modify: `src/middleware.ts:74–80` (rate bucket selection)
- Create: `src/middleware.test.ts`

- [ ] **Step 1: Write the failing test first**

Create `src/middleware.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

// We can't easily run the actual middleware in a Vitest jsdom context
// (it depends on NextRequest/NextResponse runtime). Instead, we export
// the two pure decision functions from middleware.ts so we can test
// them in isolation. This requires extracting them in Step 3.

import { isPublicPath, isAuthRateBucket } from '@/middleware-helpers'

describe('middleware decisions', () => {
  it('treats /api/auth/logout as public so expired sessions can still log out', () => {
    expect(isPublicPath('/api/auth/logout')).toBe(true)
  })

  it('keeps /api/auth/login and /api/auth/register public', () => {
    expect(isPublicPath('/api/auth/login')).toBe(true)
    expect(isPublicPath('/api/auth/register')).toBe(true)
  })

  it('does NOT count /api/auth/me against the auth rate bucket', () => {
    expect(isAuthRateBucket('/api/auth/me')).toBe(false)
  })

  it('DOES count login/register/logout against the auth rate bucket', () => {
    expect(isAuthRateBucket('/api/auth/login')).toBe(true)
    expect(isAuthRateBucket('/api/auth/register')).toBe(true)
    expect(isAuthRateBucket('/api/auth/logout')).toBe(true)
  })

  it('does not count generic api endpoints in the auth bucket', () => {
    expect(isAuthRateBucket('/api/fight/analyze')).toBe(false)
    expect(isAuthRateBucket('/api/social/profiles')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails (no helpers module yet)**

```bash
pnpm test src/middleware.test.ts
```
Expected: FAIL — "Cannot find module '@/middleware-helpers'".

- [ ] **Step 3: Extract the helper functions**

Create `src/middleware-helpers.ts`:

```typescript
export const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/billing/webhook',
]

export const STATIC_PREFIXES = ['/_next', '/favicon', '/manifest', '/fonts', '/images']

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true
  if (STATIC_PREFIXES.some((p) => pathname.startsWith(p))) return true
  if (pathname.match(/\.(ico|png|jpg|jpeg|svg|webp|woff2?|ttf|css|js|map)$/)) return true
  return false
}

/**
 * Login / register / logout share the tight auth rate bucket.
 * /api/auth/me is excluded — AuthContext polls it on mount and focus,
 * so sharing the auth bucket caused spurious 429s during normal use.
 */
export function isAuthRateBucket(pathname: string): boolean {
  if (!pathname.startsWith('/api/auth/')) return false
  if (pathname === '/api/auth/me') return false
  return true
}
```

Note: `/api/auth/me` is *also* added to PUBLIC_PATHS so unauthenticated session-checks return cleanly (the handler returns `{ user: null }` for missing sessions per its existing implementation).

- [ ] **Step 4: Update `src/middleware.ts` to import the helpers and use the new bucket logic**

Replace the top of `src/middleware.ts` (the current `PUBLIC_PATHS`, `STATIC_PREFIXES`, and `isPublicPath`) with:

```typescript
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isPublicPath, isAuthRateBucket, STATIC_PREFIXES } from './middleware-helpers'
```

Then in the rate-limit block, replace:

```typescript
const isAuthEndpoint = pathname.startsWith('/api/auth/')
const limit = isAuthEndpoint ? RATE_LIMIT_AUTH : RATE_LIMIT_API
const rateKey = `${ip}:${isAuthEndpoint ? 'auth' : 'api'}`
```

with:

```typescript
const isAuthBucket = isAuthRateBucket(pathname)
const limit = isAuthBucket ? RATE_LIMIT_AUTH : RATE_LIMIT_API
const rateKey = `${ip}:${isAuthBucket ? 'auth' : 'api'}`
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm test src/middleware.test.ts
```
Expected: all 5 tests PASS.

- [ ] **Step 6: Typecheck + full test suite**

```bash
pnpm exec tsc --noEmit && pnpm test
```
Expected: both exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/middleware.ts src/middleware-helpers.ts src/middleware.test.ts
git commit -m "fix(middleware): allow logout when session expired; split me from auth rate bucket"
```

---

## Task 3: `/api/test-ai` — Shogun-only + scrub key prefixes

**Files:**
- Modify: `src/app/api/test-ai/route.ts:4–67`

- [ ] **Step 1: Read the current file to see imports already present**

```bash
rg "^import" src/app/api/test-ai/route.ts
```

Confirm whether `requireUser` from `@/lib/musashiAuth` is already imported. If not, add it.

- [ ] **Step 2: Rewrite the GET handler**

Replace the body of the `GET` handler in `src/app/api/test-ai/route.ts` with:

```typescript
import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'

export async function GET(req: Request) {
  // Production: hard 404. This route is a developer/admin diagnostic only.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Non-production: still require Shogun role. Prevents accidental info
  // disclosure to authenticated dev/staging users.
  try {
    await requireUser(req, { role: 'shogun' })
  } catch {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const geminiKey = process.env.GEMINI_API_KEY
  const openaiKey = process.env.OPENAI_API_KEY

  // Scrubbed diagnostics — booleans only, no prefixes, no key lists.
  const diagnostics = {
    geminiKeyPresent: !!geminiKey,
    openaiKeyPresent: !!openaiKey,
    nodeEnv: process.env.NODE_ENV ?? 'unknown',
    geminiModel: process.env.GEMINI_MODEL ?? 'not set',
  }

  return NextResponse.json(diagnostics)
}
```

Remove the existing live-Gemini-call section if it returns more diagnostic fields than `diagnostics` above. If a live Gemini probe is still useful, make it a separate POST that requires the same Shogun check and returns `{ ok: boolean, error?: string }` only.

- [ ] **Step 3: Verify typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/test-ai/route.ts
git commit -m "fix(api/test-ai): require Shogun + scrub diagnostics; 404 in production"
```

---

## Task 4: Scouting GET returns `budget` so paid/free split works

**Files:**
- Modify: `src/app/api/social/scouting/route.ts:69–108` (`mapRequestRow`)
- Create: `src/app/api/social/scouting/route.test.ts`

- [ ] **Step 1: Write failing test**

Create `src/app/api/social/scouting/route.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'

// We test the pure mapper, not the whole route. Extract it in Step 3.
import { mapRequestRow } from './mapRequestRow'

describe('mapRequestRow', () => {
  it('includes budget so the UI paid/free split is correct', () => {
    const row = {
      id: 'r1',
      author_id: 'u1',
      author_name: 'Author',
      opponent_name: 'Opp',
      opponent_info: '',
      fight_date: null,
      location: null,
      description: '',
      videos: '[]',
      tags: '[]',
      status: 'open',
      response_count: 0,
      performance_metrics: null,
      technique_analysis: null,
      budget: 250,
      visibility: 'public',
      opponent_videos: '[]',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    }
    const mapped = mapRequestRow(row as unknown as Parameters<typeof mapRequestRow>[0])
    expect(mapped.budget).toBe(250)
  })

  it('coerces missing/null budget to 0 so .filter(r => r.budget > 0) is safe', () => {
    const row = {
      id: 'r1',
      author_id: 'u1',
      author_name: 'Author',
      opponent_name: 'Opp',
      opponent_info: '',
      fight_date: null,
      location: null,
      description: '',
      videos: '[]',
      tags: '[]',
      status: 'open',
      response_count: 0,
      performance_metrics: null,
      technique_analysis: null,
      budget: null,
      visibility: 'public',
      opponent_videos: '[]',
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    }
    const mapped = mapRequestRow(row as unknown as Parameters<typeof mapRequestRow>[0])
    expect(mapped.budget).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify fail**

```bash
pnpm test src/app/api/social/scouting/route.test.ts
```
Expected: FAIL — `mapRequestRow` is not exported from a `./mapRequestRow` module.

- [ ] **Step 3: Extract `mapRequestRow` to its own module and add `budget`**

Create `src/app/api/social/scouting/mapRequestRow.ts`:

```typescript
import type { ScoutingRequestRow } from './types'

export const mapRequestRow = (row: ScoutingRequestRow) => ({
  id: row.id,
  authorId: row.author_id,
  authorName: row.author_name ?? '',
  opponentName: row.opponent_name,
  opponentInfo: row.opponent_info,
  fightDate: row.fight_date,
  location: row.location,
  description: row.description,
  videos: JSON.parse(row.videos || '[]'),
  tags: JSON.parse(row.tags || '[]'),
  status: row.status,
  responseCount: Number(row.response_count || 0),
  performanceMetrics: row.performance_metrics ? JSON.parse(row.performance_metrics) : null,
  techniqueAnalysis: row.technique_analysis ? JSON.parse(row.technique_analysis) : null,
  budget: Number(row.budget ?? 0),
  visibility: row.visibility,
  opponentVideos: JSON.parse(row.opponent_videos || '[]'),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})
```

If a `ScoutingRequestRow` type definition does not already exist in a shared location, create `src/app/api/social/scouting/types.ts` with the row shape derived from the existing `mapRequestRow` in `route.ts` plus a `budget: number | null` field. (Look at the SQL `INSERT` at `route.ts:191–207` to confirm all column names.)

- [ ] **Step 4: Update `route.ts` to import the extracted mapper**

In `src/app/api/social/scouting/route.ts`, delete the inline `mapRequestRow` definition and add:

```typescript
import { mapRequestRow } from './mapRequestRow'
```

- [ ] **Step 5: Run tests + typecheck**

```bash
pnpm exec tsc --noEmit && pnpm test src/app/api/social/scouting
```
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/social/scouting
git commit -m "fix(api/social/scouting): return budget so paid/free split renders correctly"
```

---

## Task 5: Library — hide Delete button for non-Shogun users

**Files:**
- Modify: `src/components/sections/LibrarySection.tsx:362–368`

- [ ] **Step 1: Read existing useAuth import in LibrarySection**

```bash
rg "useAuth" src/components/sections/LibrarySection.tsx
```

If `useAuth` is not already imported, add `import { useAuth } from '@/hooks/useAuth'` to the imports.

- [ ] **Step 2: Add role check inside the component**

In `LibrarySection.tsx`, add inside the function body (near other hook calls):

```typescript
const { user } = useAuth()
const canDelete = user?.role === 'shogun'
```

- [ ] **Step 3: Conditionally render the delete button**

Replace the existing delete button block (around lines 361–368) with:

```tsx
{canDelete && (
  <Button
    variant="ghost"
    size="icon"
    onClick={() => handleDelete(doc.id)}
    className="text-muted-foreground hover:text-destructive"
    aria-label="Delete document"
  >
    <Trash2 className="h-4 w-4" />
  </Button>
)}
```

- [ ] **Step 4: Typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/sections/LibrarySection.tsx
git commit -m "fix(library): hide Delete button for non-shogun users to match API policy"
```

---

## Task 6: Remove dead `coachingMode === 'strategy'` branch

**Files:**
- Modify: `src/components/fight/FightCoachExperience.tsx:554, 1342–1395`

- [ ] **Step 1: Confirm the branch is truly dead**

```bash
rg "setCoachingMode" src
```
Expected: ONLY the `useState` declaration at line 554. No callers anywhere else.

- [ ] **Step 2: Delete the state line**

In `FightCoachExperience.tsx`, delete line 554:

```typescript
const [coachingMode, setCoachingMode] = useState<CoachingMode>('reflex')
```

Also delete `strategyLoading` and `currentStrategy` state if they are only used inside the deleted strategy branch (verify with `rg "strategyLoading|currentStrategy" src/components/fight/FightCoachExperience.tsx` — if used elsewhere, keep them).

- [ ] **Step 3: Simplify the chat send flow**

In the `sendChat` function (around lines 1342–1410), replace:

```typescript
if (coachingMode === 'strategy') {
  setStrategyLoading(true)
} else {
  setChatLoading(true)
}

const action = coachingMode === 'strategy' ? 'strategy' : 'chat'
```

with:

```typescript
setChatLoading(true)
const action = 'chat'
```

And replace:

```typescript
if (coachingMode === 'strategy') {
  const strategy = parsed as StrategyResponse
  setCurrentStrategy(strategy)
  setMessages((prev) => [...prev, {
    role: 'assistant',
    content: `Strategy generated:\nGameplan: ${strategy.gameplan}\nCounters: ${(strategy.counters || []).join(', ')}`
  }])
} else {
  const chat = parsed as { message: string }
  setMessages(/* ... existing chat append ... */)
}
```

with the unconditional chat-append branch only:

```typescript
const chat = parsed as { message: string }
setMessages(/* ... existing chat append ... */)
```

- [ ] **Step 4: Remove unused imports**

If `CoachingMode` or `StrategyResponse` types are no longer used in the file, remove them from the imports.

- [ ] **Step 5: Typecheck + lint**

```bash
pnpm exec tsc --noEmit && pnpm lint
```
Expected: both exit 0. If lint complains about unused vars (`strategyLoading`, `currentStrategy`, etc.), delete those too.

- [ ] **Step 6: Commit**

```bash
git add src/components/fight/FightCoachExperience.tsx
git commit -m "refactor(fight-coach): remove unreachable coachingMode strategy branch"
```

---

## Task 7: Create the `ComingSoonSection` reusable component

**Files:**
- Create: `src/components/sections/ComingSoonSection.tsx`

- [ ] **Step 1: Create the component**

```tsx
'use client'

import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sparkles } from 'lucide-react'

interface ComingSoonSectionProps {
  title: string
  icon: LucideIcon
  description: string
  details?: string
}

/**
 * Standardized "Preview" landing card. Rendered in place of a section
 * implementation whose backing features aren't shippable for the MVP.
 * Re-enable the underlying section by setting
 * `NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES=1` in the environment.
 */
export function ComingSoonSection({
  title,
  icon: Icon,
  description,
  details,
}: ComingSoonSectionProps) {
  return (
    <div className="container mx-auto p-4 lg:p-6">
      <Card className="border-border/60 bg-card/60 backdrop-blur-sm">
        <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/15 text-primary ring-1 ring-primary/20">
            <Icon className="h-8 w-8" />
          </div>
          <div className="space-y-2">
            <Badge variant="secondary" className="border-0 bg-primary/15 text-primary">
              <Sparkles className="mr-1 h-3 w-3" />
              Preview
            </Badge>
            <h2 className="text-2xl font-semibold">{title}</h2>
            <p className="max-w-md text-muted-foreground">{description}</p>
            {details && (
              <p className="max-w-md text-sm text-muted-foreground/80">{details}</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/sections/ComingSoonSection.tsx
git commit -m "feat(ui): add ComingSoonSection reusable Preview card"
```

---

## Task 8: Gate Marketplace, Scouting, Coaches, Messages behind `NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES`

**Files:**
- Modify: `src/components/sections/MarketplaceSection.tsx`
- Modify: `src/components/sections/ScoutingSection.tsx`
- Modify: `src/components/sections/CoachesSection.tsx`
- Modify: `src/components/sections/MessagesSection.tsx`

**Pattern:** In each of the four files, **do not touch the existing function body**. Insert two new imports at the top of the file, and at the very first line inside the default-exported function body, insert the early-return block. Everything below the early-return stays exactly as it is today.

- [ ] **Step 1: Patch `MarketplaceSection.tsx`**

Add these imports to the existing import block at the top of the file:

```tsx
import { ComingSoonSection } from './ComingSoonSection'
```

(`ShoppingBag` is already imported per the existing import list — confirm with `rg "ShoppingBag" src/components/sections/MarketplaceSection.tsx`. If missing, add it.)

At the very first line inside `export default function MarketplaceSection() {`, insert:

```tsx
  if (process.env.NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES !== '1') {
    return (
      <ComingSoonSection
        title="Marketplace"
        icon={ShoppingBag}
        description="Premium techniques and coaching products from verified fighters."
        details="Available soon. We're finishing payment integration before opening this up."
      />
    )
  }
```

- [ ] **Step 2: Patch `ScoutingSection.tsx`** (same pattern)

Add import:

```tsx
import { ComingSoonSection } from './ComingSoonSection'
```

Confirm `Target` is in the lucide imports (add if missing). Insert at the top of the function body:

```tsx
  if (process.env.NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES !== '1') {
    return (
      <ComingSoonSection
        title="Scouting"
        icon={Target}
        description="Crowdsourced opponent breakdowns from the Musashi community."
        details="Available soon. We're stabilizing the scouting workflow before opening it to everyone."
      />
    )
  }
```

- [ ] **Step 3: Patch `CoachesSection.tsx`** (same pattern)

Add import:

```tsx
import { ComingSoonSection } from './ComingSoonSection'
```

Confirm `Crown` is in the lucide imports (add if missing). Insert at the top of the function body:

```tsx
  if (process.env.NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES !== '1') {
    return (
      <ComingSoonSection
        title="Coaches"
        icon={Crown}
        description="Browse top-ranked coaches and analysts in the Musashi network."
        details="Coming soon. Coach onboarding is in progress."
      />
    )
  }
```

- [ ] **Step 4: Patch `MessagesSection.tsx`** (same pattern)

Add import:

```tsx
import { ComingSoonSection } from './ComingSoonSection'
```

`MessageSquare` is already imported per line 10 of the existing file. Insert at the top of the function body:

```tsx
  if (process.env.NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES !== '1') {
    return (
      <ComingSoonSection
        title="Messages"
        icon={MessageSquare}
        description="Direct messaging with fighters and coaches."
        details="Available soon. We're hardening real-time delivery before launch."
      />
    )
  }
```

- [ ] **Step 5: Typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 6: Smoke test in dev**

Start the dev server:

```bash
pnpm dev
```

Navigate to each gated section. Each should render the Preview card. Then stop the dev server.

- [ ] **Step 7: Commit**

```bash
git add src/components/sections/MarketplaceSection.tsx src/components/sections/ScoutingSection.tsx src/components/sections/CoachesSection.tsx src/components/sections/MessagesSection.tsx
git commit -m "feat(sections): gate Marketplace/Scouting/Coaches/Messages behind preview flag"
```

---

## Task 9: Hide nav items behind the same preview flag

**Files:**
- Modify: `src/components/layout/Navigation.tsx:34–48`

- [ ] **Step 1: Make the nav lists computed instead of constant**

In `Navigation.tsx`, replace the top-level `navItems` constant (lines 34–43) and `routedNavItems` constant (lines 46–48) with:

```typescript
const ALL_NAV_ITEMS: { section: AppSection; label: string; icon: typeof Brain; description: string; preview?: boolean }[] = [
  { section: 'coach', label: 'Fight Lab', icon: Brain, description: 'Upload clips for tactical analysis' },
  { section: 'fighters', label: 'Fighters', icon: Users, description: 'Connect with fighters' },
  { section: 'marketplace', label: 'Marketplace', icon: ShoppingBag, description: 'Techniques & coaching', preview: true },
  { section: 'scouting', label: 'Scouting', icon: Target, description: 'Opponent analysis', preview: true },
  { section: 'coaches', label: 'Coaches', icon: Crown, description: 'Top-ranked coaches', preview: true },
  { section: 'messages', label: 'Messages', icon: MessageSquare, description: 'Chat with fighters', preview: true },
  { section: 'library', label: 'Library', icon: BookOpen, description: 'Your saved content' },
  { section: 'profile', label: 'Profile', icon: User, description: 'Your account & activity' },
]

const ALL_ROUTED_NAV_ITEMS: { href: string; label: string; icon: typeof Brain; description: string; preview?: boolean }[] = [
  { href: '/marketplace', label: 'Hire Coach', icon: Briefcase, description: 'Post a bounty or hire an analyst', preview: true },
]

const PREVIEW_ENABLED = process.env.NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES === '1'

const navItems = PREVIEW_ENABLED
  ? ALL_NAV_ITEMS
  : ALL_NAV_ITEMS.filter((i) => !i.preview)

const routedNavItems = PREVIEW_ENABLED
  ? ALL_ROUTED_NAV_ITEMS
  : ALL_ROUTED_NAV_ITEMS.filter((i) => !i.preview)
```

- [ ] **Step 2: Typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Smoke test (dev server)**

Confirm that with the flag unset, Marketplace/Scouting/Coaches/Messages/Hire Coach are not in the nav bar.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Navigation.tsx
git commit -m "feat(nav): hide preview-only nav items unless preview flag is set"
```

---

## Task 10: Remove dead per-component buttons

**Files:**
- Modify: `src/components/social/FighterCard.tsx:74–78`
- Modify: `src/components/sections/MarketplaceSection.tsx:195–200` (Cart button — only when preview flag IS on)
- Modify: `src/components/sections/MessagesSection.tsx:158–166`
- Modify: `src/components/sections/ProfileSection.tsx:54–56`

- [ ] **Step 1: FighterCard — remove the dead "View Profile" button**

Replace the `<CardFooter>` block (lines 74–78) with nothing — drop the whole `<CardFooter>`. Also remove the now-unused `CardFooter` import (line 5) and the import of `Button` if it's not used elsewhere in the file. (`Button` is only used for that one button — remove it too.)

The result:

```tsx
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Check } from 'lucide-react'
```

…and the JSX no longer has a `<CardFooter>` block.

- [ ] **Step 2: MarketplaceSection — remove the Cart button from SectionHeader**

In `MarketplaceSection.tsx` around lines 195–200, replace:

```tsx
action={
  <Button variant="outline" className="gap-2 h-10">
    <ShoppingCart className="h-4 w-4" />
    Cart
  </Button>
}
```

with no `action` prop at all (delete the entire `action={...}` line).

Note: the section already early-returns the Preview card when the flag is off (Task 8), so the Cart button only matters in preview-on mode. But it's still dead in that mode, so we remove it.

- [ ] **Step 3: MessagesSection — remove phone/video/more icon buttons**

In `MessagesSection.tsx` lines 158–166, delete the three icon buttons (Phone, Video, MoreVertical) entirely. Also remove `Phone`, `Video`, and `MoreVertical` from the lucide-react import on line 10 if they aren't used elsewhere in the file.

- [ ] **Step 4: ProfileSection — remove "Edit Profile" button**

In `ProfileSection.tsx` lines 54–56, delete the entire `<Button>...Edit Profile</Button>` block.

- [ ] **Step 5: Typecheck + lint**

```bash
pnpm exec tsc --noEmit && pnpm lint
```
Expected: both exit 0. Fix any "imported but never used" errors by removing the offending imports.

- [ ] **Step 6: Commit**

```bash
git add src/components/social/FighterCard.tsx src/components/sections/MarketplaceSection.tsx src/components/sections/MessagesSection.tsx src/components/sections/ProfileSection.tsx
git commit -m "fix(ui): remove dead buttons (View Profile, Cart, message icons, Edit Profile)"
```

---

## Task 11: Offline-mode banner on Fight Lab

**Files:**
- Modify: `src/app/(app)/page.tsx`

- [ ] **Step 1: Add a banner above the Fight Lab content**

In `src/app/(app)/page.tsx`, just inside the `return (` of `HomePage`, before any other JSX, add:

```tsx
const OFFLINE = process.env.NEXT_PUBLIC_OFFLINE_MODE === '1'
```

(Place it near the top of the function body, alongside the other derived values.)

Then, near the top of the rendered JSX (above the hero card), add:

```tsx
{OFFLINE && (
  <div className="container mx-auto px-4 lg:px-6 pt-4">
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
      <strong>Offline mode active.</strong> Coaching analysis is mocked and not running on Gemini.
      Unset <code>NEXT_PUBLIC_OFFLINE_MODE</code> to use real AI.
    </div>
  </div>
)}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/(app)/page.tsx
git commit -m "feat(ui): show banner when NEXT_PUBLIC_OFFLINE_MODE is active"
```

---

## Task 12: Root `error.tsx`

**Files:**
- Create: `src/app/error.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { AlertCircle } from 'lucide-react'

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Root segment error:', error)
  }, [error])

  return (
    <html>
      <body>
        <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-background text-foreground">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-muted-foreground text-center max-w-md">
            The page failed to load. Try again, or return to the home page.
          </p>
          <div className="flex gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" onClick={() => (window.location.href = '/')}>
              Go home
            </Button>
          </div>
        </main>
      </body>
    </html>
  )
}
```

Note: root `error.tsx` must include its own `<html>` and `<body>` because it replaces the root layout when triggered.

- [ ] **Step 2: Typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/error.tsx
git commit -m "feat(app): add root error boundary route file"
```

---

## Task 13: Root `not-found.tsx`

**Files:**
- Create: `src/app/not-found.tsx`

- [ ] **Step 1: Create the file**

```tsx
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Compass } from 'lucide-react'

export default function NotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 bg-background text-foreground">
      <Compass className="h-12 w-12 text-primary" />
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="text-muted-foreground text-center max-w-md">
        We couldn&apos;t find what you&apos;re looking for. It may have moved or been removed.
      </p>
      <Button asChild>
        <Link href="/">Go home</Link>
      </Button>
    </main>
  )
}
```

- [ ] **Step 2: Typecheck + build sanity**

```bash
pnpm exec tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/app/not-found.tsx
git commit -m "feat(app): add branded 404 page"
```

---

## Task 14: `(app)/error.tsx` and `(app)/loading.tsx`

**Files:**
- Create: `src/app/(app)/error.tsx`
- Create: `src/app/(app)/loading.tsx`

- [ ] **Step 1: Create `(app)/error.tsx`**

```tsx
'use client'

import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AlertCircle } from 'lucide-react'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('App segment error:', error)
  }, [error])

  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-4 p-12 text-center">
          <AlertCircle className="h-12 w-12 text-destructive" />
          <h2 className="text-xl font-semibold">This page hit a snag</h2>
          <p className="text-muted-foreground max-w-md">
            Something went wrong loading this section. You can retry or return home.
          </p>
          <div className="flex gap-2">
            <Button onClick={reset}>Try again</Button>
            <Button variant="outline" onClick={() => (window.location.href = '/')}>
              Go home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Create `(app)/loading.tsx`**

```tsx
import { Card, CardContent } from '@/components/ui/card'

export default function AppLoading() {
  return (
    <div className="container mx-auto p-6">
      <Card>
        <CardContent className="flex flex-col items-center gap-3 p-12 text-center">
          <div
            className="h-8 w-8 rounded-full border-2 border-primary/30 border-t-primary animate-spin"
            aria-label="Loading"
          />
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 3: Typecheck**

```bash
pnpm exec tsc --noEmit
```
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/error.tsx" "src/app/(app)/loading.tsx"
git commit -m "feat(app): add per-segment error boundary and loading state"
```

---

## Task 15: Final verification gate

**Files:** none modified — this is the verification-before-completion gate.

- [ ] **Step 1: Clean install + full pipeline**

```bash
pnpm install
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
```

All five commands must exit 0. If any fail, fix and re-run before declaring done.

- [ ] **Step 2: Manual smoke test (dev server)**

Run:

```bash
pnpm dev
```

Walk through this checklist in a browser. Each item should pass:

1. Visit `/login` → log in with a test user → home page renders.
2. On home page, the nav shows ONLY: Fight Lab, Fighters, Library, Profile. Marketplace/Scouting/Coaches/Messages/Hire-Coach are NOT visible.
3. Click Fight Lab → upload a fight clip → skeleton tracking renders.
4. Click avatar → Log out → redirected to /login. (Previously broken; should now work.)
5. Log back in. Click Profile → see real email/role, no "Edit Profile" button.
6. Click Library → search returns results (or empty state) → no Delete button (assuming non-shogun user).
7. Click Fighters → directory loads → no "View Profile" button on cards.
8. Visit `/some-bad-path` → branded 404 page renders.
9. As a control, set `NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES=1` in `.env.local`, restart dev, confirm hidden sections reappear in nav and render their full implementations.
10. Unset `NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES`. Set `NEXT_PUBLIC_OFFLINE_MODE=1`. Confirm the amber "Offline mode active" banner shows above Fight Lab. Unset it.

- [ ] **Step 3: Final commit (if any cleanup needed)**

If any small fixes were needed during smoke test, commit them as `chore: smoke-test fixups` and re-run Step 1.

- [ ] **Step 4: Mark done**

The plan is complete when Steps 1 and 2 above both succeed without modification.
