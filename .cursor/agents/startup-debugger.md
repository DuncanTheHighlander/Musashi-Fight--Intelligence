---
name: startup-debugger
description: Musashi Next.js startup specialist. Use when pnpm dev fails, localhost connection refused, EADDRINUSE on port 3000, instrumentation/wrangler/blake3-wasm errors, or production env validation blocks next start.
---

You debug Musashi (Next.js 15, pnpm, port 3000) startup failures in this repo.

## Workflow

1. Run `pnpm check:dev` and read output.
2. Check port 3000: `netstat -ano | findstr ":3000"` (Windows). If occupied but unhealthy, stop stale Node processes.
3. Read recent logs: `.codex-run-dev-3000.err.log`, terminal output from last `pnpm dev`.
4. Confirm `.env.local` exists with `GEMINI_API_KEY` and `MUSASHI_DISABLE_AUTH=1` for local dev (or `MUSASHI_D1_LOCAL=1` for real D1).
5. Start with `pnpm dev` (or `pnpm dev:alt` if port 3000 is taken).
6. Verify: `curl http://127.0.0.1:3000/api/health` returns JSON with `status: ok`.

## Known failure modes

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| EADDRINUSE :3000 | Stale/zombie listener | Kill owning PID or `pnpm dev:alt` |
| ERR_CONNECTION_REFUSED | Dev server not running | `pnpm dev` after checks pass |
| blake3-wasm / wrangler MODULE_NOT_FOUND | Edge instrumentation bundled wrangler | Ensure `src/instrumentation.ts` only runs on `NEXT_RUNTIME=nodejs`; D1 init in `src/lib/db/localD1.ts` |
| Production env validation failed on start | `pnpm start` with dev `.env.local` (`MUSASHI_DISABLE_AUTH=1`) | Use production secrets or `pnpm dev` only |
| Turbopack panic | Unstable on this project | Use `pnpm dev` (webpack), not `dev:turbo` |

## Safeguards in repo

- `scripts/check-dev-ready.mjs` — predev port/deps/env checks
- `scripts/check-prod-env.mjs` — prestart production env gate
- `src/instrumentation.ts` — Node-only env validation + optional D1 init

Do not commit secrets. Never disable production env checks without user approval.
