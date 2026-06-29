# Musashi - AI Fight Coach

AI-powered combat sports coaching platform with real-time pose analysis, video breakdown, and strategic insights.

## Features

- **AI Video Analysis**: Upload fight videos for detailed technical breakdown
- **Real-Time Pose Tracking**: MediaPipe-powered skeleton overlay with 2-fighter detection
- **Live Kinematics**: Hand speed, range, power index, and tempo tracking
- **Burst Analysis**: Frame-by-frame technique analysis with AI coaching
- **Strategy Mode**: Round-by-round gameplan generation
- **Smart Track**: AI-powered object tracking for specific targets
- **Social Features**: Fighter profiles, marketplace, opponent scouting (backend ready)

## Tech Stack

- **Frontend**: Next.js 15, React 19, TypeScript, Tailwind CSS
- **AI**: Google Gemini 3.1 Pro (analyze/burst/strategy) + Gemini 2.5 Flash (reflex/track/embed)
- **Motion Capture**: MediaPipe Pose Landmarker
- **Database**: Cloudflare D1 (SQLite)
- **Deployment**: Cloudflare Workers

## Prerequisites

- Node.js 18+
- pnpm 10+ (recommended) or npm
- Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env.local` and add your API keys. The minimum required for development:

```bash
GEMINI_API_KEY=your-gemini-api-key-here
MUSASHI_DISABLE_AUTH=1    # dev only — skips login
```

See `.env.example` for the full list (Stripe, fal.ai, R2 storage, etc.).

### 3. Run Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) — **Musashi is always on port 3000**. If you also run a Streamlit project locally (default port 8501), the two will never collide.

### 4. Database Setup (Cloudflare D1)

For local development with Cloudflare Workers:

```bash
npm install -g wrangler
wrangler d1 create musashi-db
wrangler d1 execute musashi-db --local --file=./src/lib/database.sql
```

In pure-Next dev (no Wrangler), set `MUSASHI_DISABLE_AUTH=1` and the social endpoints will return safe empty payloads.

## Cost Protection (Plug in an API key without bleeding budget)

Musashi has four layers of cost guards that all activate automatically as soon as `GEMINI_API_KEY` is set:

1. **Global kill switch** — set `MUSASHI_AI_KILL_SWITCH=1` to disable ALL AI endpoints instantly with a 503. Flip it back off when you want.
2. **Per-user quotas** — daily + per-minute caps in `src/lib/musashiUsage.ts`, enforced at every AI route via `aiGuard()`. Free tier defaults are conservative; paid tier is configurable in the `musashi_users` table.
3. **Server-side cache + in-flight dedup** — identical coaching prompts hit a TTL'd LRU cache instead of re-calling Gemini. Configurable via `MUSASHI_COACHING_CACHE_TTL_MS` and `MUSASHI_COACHING_CACHE_SIZE`.
4. **Client-side dedup** — concurrent identical requests share one promise (`src/lib/ai/clientInflight.ts`).

When you hit a quota, the UI shows a polished card (auth required / rate-limited / quota exhausted / kill switch active) instead of crashing.

## Usage

### Video Analysis

1. Click "Upload a Clip" or drag & drop a fight video into the Fight Lab
2. Video validates automatically (max 500MB, 10 minutes)
3. Skeleton overlay turns on by default; toggle off if you want a clean view
4. Use Blue/Red corner focus toggle to lock the coaching on one fighter
5. Click "Burst Analysis" for frame-by-frame technique breakdown
6. Click "Round Strategy" for gameplan generation

### Feature Limits

- **Video Size**: 500MB max
- **Video Duration**: 10 minutes max
- **Supported Formats**: MP4, MOV, WebM
- **Frame Rate**: Processes at 5 FPS for analysis

### Labeling workflow (detector tuning loop)

Human corrections from FightLang compile into a labeled dataset used to tune heuristic detectors (not Gemini fine-tuning).

1. **Analyze** — Run a clip in Fight Lab; the compile saves a ledger automatically (requires D1: `pnpm dev:d1` or deployed Workers).
2. **Review** — Open [`/review`](http://localhost:3000/review); confirm, reject, or relabel each event/fault/pattern.
3. **Export** — Click **Export dataset** (or `GET /api/fight/ledgers/export`) to download `musashi-corrections-YYYY-MM-DD.jsonl`.
4. **Analyze corrections** — Run the tuning helper on the export:

```bash
pnpm analyze:corrections path/to/musashi-corrections-2026-06-23.jsonl
# machine-readable summary:
pnpm analyze:corrections --json path/to/export.jsonl
# smoke test on bundled sample data:
pnpm analyze:corrections:fixture
```

The report summarizes confirm/reject/relabel rates, top misclassification pairs, and suggests concrete edits in `src/lib/fightlang/fightlang.defaults.ts`, `src/lib/compiler/detectors/strikes.ts`, and related compiler gates.

**Database:** Ledger tables ship in migration `migrations/0018_ledger_corrections.sql`. Apply with the normal chain: `pnpm db:migrate:local` (local D1) or `pnpm db:migrate:remote` (production). Verify the full chain with `node scripts/test-migrations.mjs`.

## Project Structure

```
src/
├── app/
│   ├── (app)/           # Main app routes (home, marketplace, profile, etc.)
│   ├── (auth)/          # Login / signup
│   ├── api/             # API endpoints
│   │   ├── fight/       # Fight analysis APIs (with aiGuard)
│   │   ├── auth/        # Authentication
│   │   ├── billing/     # Stripe integration (Stripe key not required for dev)
│   │   ├── social/      # Social features (profiles, marketplace, scouting)
│   │   └── health/      # No-auth health endpoint for monitoring
│   └── layout.tsx
├── components/
│   ├── ui/              # shadcn/ui + section-header (the unified design system)
│   ├── fight/           # Fight Lab UI
│   ├── feedback/        # CoachingPanel + quota state cards
│   ├── sections/        # Top-level section pages (marketplace, profiles, etc.)
│   └── social/          # Marketplace cards, fighter cards, etc.
├── lib/
│   ├── ai/
│   │   ├── aiGuard.ts        # Quota / kill switch / 401-402-429-503 enforcement
│   │   ├── coachingCache.ts  # LRU cache + in-flight dedupe
│   │   └── clientInflight.ts # Client-side request dedupe
│   ├── kinematics.ts        # Pose processing utilities
│   ├── database.sql         # D1 schema
│   └── musashiAuth.ts       # Authentication logic
└── services/
    ├── motionScore.ts        # Event detection
    └── captureBurst.ts       # Frame capture utilities
```

## Deployment

### Cloudflare Workers (Recommended)

Requires [Wrangler login](https://developers.cloudflare.com/workers/wrangler/commands/#login) and remote D1 migrations applied once:

```bash
pnpm db:migrate:remote
pnpm deploy
```

Local preview in the Workers runtime (after copying `.dev.vars.example` → `.dev.vars`):

```bash
pnpm preview
```

Build only (produces `.open-next/`):

```bash
pnpm build:cf
```

### Environment Variables (Production)

Set these in Cloudflare Dashboard → Workers → Settings → Variables:

- `GEMINI_API_KEY` (Secret)
- `STRIPE_SECRET_KEY` (Secret, when you wire up billing)
- `MUSASHI_SESSION_SECRET` (Secret, random 64-char string)
- All other vars from `.env.local`

## Development

```bash
pnpm check:dev              # pre-flight: deps, .env.local, port 3000
pnpm dev                    # runs check:dev automatically (predev)
pnpm test                   # vitest
pnpm lint                   # next lint
npx tsc --noEmit            # type check
```

### Startup troubleshooting

| Symptom | Fix |
|---------|-----|
| `EADDRINUSE` on port 3000 | Stop stale Node: `Get-NetTCPConnection -LocalPort 3000` → kill `OwningProcess`, or use `pnpm dev:alt` (port 3001) |
| `ERR_CONNECTION_REFUSED` | Dev server not running — run `pnpm dev` or `.\start-musashi.ps1` |
| Stuck on "Starting..." | Clear cache: `pnpm dev:clean` |
| `wrangler` / `blake3-wasm` module errors | Do not use Turbopack for dev; use `pnpm dev`. For local D1, set `MUSASHI_D1_LOCAL=1` only when using `pnpm dev:d1` |
| `pnpm start` fails env check | Production cannot use `MUSASHI_DISABLE_AUTH=1` — use Cloudflare/production secrets |

Project subagent: `.cursor/agents/startup-debugger.md` for automated diagnosis in Cursor.

## License

Proprietary - All Rights Reserved
