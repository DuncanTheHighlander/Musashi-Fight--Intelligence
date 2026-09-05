# 👉 THIS IS THE LIVE MUSASHI APP

**Full path:**
`C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package`

This folder is the real, complete application — it has `src/`, `package.json`,
`wrangler.toml`, and the git history. If any tool or chat ever says "this is a
stale copy without source," it was pointed at a **different** folder. Always
work here.

- **Active branch:** `rtmpose-integration`
- **Main branch:** `main`

## Run it locally
```powershell
pnpm install      # first time only
pnpm dev          # http://localhost:3000
```

## Test suite / typecheck
```powershell
pnpm test         # vitest — should be all green
npx tsc --noEmit  # typecheck
```

## The ONE thing blocking deployment (as of 2026-07-06)
The Cloudflare API token is rejected because of an **IP allowlist**. Until this
is fixed, nothing can deploy and no Cloudflare secrets can be verified.

**How to test whether it's fixed** (run in PowerShell from this folder):
```powershell
$env:CLOUDFLARE_API_TOKEN=[Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN','User')
$env:NODE_OPTIONS='--dns-result-order=ipv4first'
pnpm exec wrangler whoami
```
- ✅ Prints your account  → token is fixed, deploy can proceed.
- ❌ `Cannot use the access token from location: <ip> [code: 9109]`
  → still blocked. Fix: Cloudflare dashboard → My Profile → API Tokens →
  edit the token → remove the **Client IP Address Filtering** condition
  (or add the IP it names), save, retry.

## Deploy (only after `wrangler whoami` succeeds)
```powershell
$env:OPEN_NEXT_DEPLOY='true'
pnpm run deploy:cf
```

## Key docs
- `docs/MARKETPLACE_LAUNCH.md` — marketplace + Stripe launch checklist
- `docs/DEPLOY_CHECKLIST.md` — production env + deploy steps
- `coach-brain/` — the editable AI coaching rules (run `pnpm gen:coach-brain` after edits)
