---
name: nextjs-cloudflare-build
description: Fixes Next.js + Cloudflare Workers/Wrangler/D1 build errors (module not found path/fs, miniflare client bundle leaks). Use when compile fails with wrangler/miniflare in import trace.
---

You fix Next.js production build failures caused by Node-only Cloudflare tooling (wrangler, miniflare, esbuild, blake3-wasm) leaking into the webpack client or edge bundle.

## Symptoms

- `Module not found: Can't resolve 'path'` / `'fs'` / `'os'`
- Import trace includes `wrangler`, `miniflare`, `esbuild`, or `@cspotcode/source-map-support`
- Trace ends at `src/instrumentation.ts` or a D1 helper like `localD1Binding.ts`

## Diagnosis workflow

1. Run `pnpm build` and capture the full import trace.
2. Read these files first:
   - `src/instrumentation.ts`
   - Any local D1 / wrangler helper (`src/lib/localD1Binding.ts`, `src/lib/db/localD1.ts`)
   - `next.config.ts` / `next.config.js`
   - `package.json` (wrangler in devDependencies?)
3. Trace static imports: even `await import('wrangler')` is analyzed by webpack unless ignored.
4. Check whether `db.ts` re-exports wrangler helpers — that pulls wrangler into any module importing `@/lib/db`.

## Fix checklist (apply minimal subset)

### 1. instrumentation.ts — Node.js only

```ts
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // env validation here (safe on node)
  if (process.env.MUSASHI_D1_LOCAL === '1') {
    const { initLocalD1Binding } = await import(
      /* webpackIgnore: true */ '@/lib/localD1Binding'
    )
    await initLocalD1Binding()
  }
}
```

Never run wrangler/D1 init when `NEXT_RUNTIME === 'edge'`.

### 2. Isolate wrangler in a server-only module

- Create `src/lib/localD1Binding.ts` (or similar) with `import 'server-only'` at top.
- Dynamic-import wrangler with `/* webpackIgnore: true */`.
- Do **not** re-export `initLocalD1Binding` from shared modules like `db.ts` that many routes import.

### 3. next.config — serverExternalPackages

```ts
serverExternalPackages: ['wrangler', 'miniflare'],
```

Keeps Node-only packages external on the server graph; pair with webpackIgnore for instrumentation.

### 4. Client webpack fallbacks (already common in this repo)

For client bundles, ensure `path`, `fs`, `os`, `crypto`, `child_process` resolve to `false` in `webpack.resolve.fallback`.

### 5. Verify no client imports

Search for imports of D1 init helpers or wrangler from:
- `'use client'` components
- Shared lib files imported by client components

Use `server-only` to fail fast at build time if a client component imports the module.

## Verification

1. `pnpm build` — must complete without webpack errors.
2. Optional: `pnpm dev` or `pnpm dev:d1` — confirm instrumentation logs and D1 init when `MUSASHI_D1_LOCAL=1`.
3. Do not disable TypeScript or ESLint checks unless the user explicitly requests it.

## Musashi-specific notes

- Local D1: set `MUSASHI_D1_LOCAL=1` and run `pnpm db:migrate:local` before `pnpm dev:d1`.
- wrangler is a devDependency; production Cloudflare deploys use real D1 bindings, not getPlatformProxy.
- Prefer one D1 init module (`localD1Binding.ts`); avoid duplicate `db/localD1.ts` + re-exports.

Return: files changed, build result, and any follow-up (e.g. migrate env, wrangler.toml path).
