# Phase 1 — Production Infrastructure

Runbook for no-mock Musashi launch. Code is ready; this phase wires Cloudflare, secrets, R2, and deploy path.

Project path:

```
C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package
```

Quick status check:

```powershell
cd "C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package"
.\scripts\phase1-setup.ps1
pnpm check:launch:strict
```

**Live status doc:** `docs/STATUS.md` — automated review, env checklist, and "blocked on user" items.

---

## 1. Deploy path (Windows EPERM symlink)

**Diagnosis:** `pnpm build:cf` fails on Windows with `EPERM: operation not permitted, symlink` when Next.js copies pnpm-traced files into `.next/standalone`. Windows Developer Mode is **not** enabled on this machine; WSL is **not** installed.

**Fix options (pick one):**

| Option | Effort | Command |
|--------|--------|---------|
| **A. Enable Developer Mode** | ~2 min + reboot may be needed | Settings → System → For developers → Developer Mode ON, then `pnpm deploy` |
| **B. Install WSL** | ~10 min | `wsl --install` (reboot), then see WSL block below |
| **C. GitHub Actions / Linux CI** | Best for repeat deploys | Run `pnpm deploy` on ubuntu-latest with `CLOUDFLARE_API_TOKEN` |

### WSL deploy (after `wsl --install` + reboot)

```bash
# In WSL Ubuntu — path uses /mnt/c/ for Windows drive
cd "/mnt/c/Users/smith/Desktop/codiing/Musashi/fight app/download_package"
corepack enable
pnpm install
pnpm exec wrangler login
pnpm db:migrate:remote
pnpm deploy
```

### Windows Developer Mode deploy

```powershell
# After enabling Developer Mode in Windows Settings
cd "C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package"
pnpm deploy
```

---

## 2. Wrangler auth + D1 migrations

Wrangler is installed as a dev dependency (`pnpm exec wrangler`). Global `wrangler` is not on PATH.

```powershell
cd "C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package"
pnpm exec wrangler login          # opens browser — required once
pnpm exec wrangler whoami         # verify account
pnpm db:migrate:remote            # applies migrations/ to musashi-db (remote)
```

If `whoami` fails with `Cannot use the access token from location ... [code: 9109]`,
the active token is restricted away from this network. Run `pnpm exec wrangler login`
again from this machine, or update/create the token in the Cloudflare dashboard with
an allowed client IP/location. If D1 returns `not authorized [code: 7403]`, the token
also needs D1 edit permissions for this account.

D1 binding (already in `wrangler.toml`):

- Database name: `musashi-db`
- Database ID: `eda3460e-70ab-4eef-b273-0efc52007c82`
- Migrations: 27 files (`0001` ... `0027`)

---

## 3. Production vars (non-secret)

Already set in `wrangler.toml` `[vars]`:

```toml
MUSASHI_MARKETPLACE_PAYMENTS = "stripe"
MUSASHI_STORAGE_MODE = "r2"
NODE_ENV = "production"
```

To override via CLI instead:

```powershell
pnpm exec wrangler vars put MUSASHI_MARKETPLACE_PAYMENTS stripe
pnpm exec wrangler vars put MUSASHI_STORAGE_MODE r2
pnpm exec wrangler vars put NODE_ENV production
```

**Never** set `MUSASHI_DISABLE_AUTH=1` in production.

---

## 4. Production secrets

Set each secret interactively (prompts for value) or pipe from env:

```powershell
cd "C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package"

# Auth + app (GEMINI + STRIPE secret keys come from Secrets Store — see docs/DEPLOY_CHECKLIST.md)
pnpm exec wrangler secret put MUSASHI_SESSION_SECRET          # 64+ random chars
pnpm exec wrangler secret put MUSASHI_SHOGUN_EMAIL
pnpm exec wrangler secret put MUSASHI_SHOGUN_PASSWORD         # strong, NOT default
pnpm exec wrangler secret put MUSASHI_CRON_SECRET             # protects /api/cron/*
pnpm exec wrangler secret put MUSASHI_APP_URL                  # https://YOUR_DOMAIN

# Stripe webhook (STRIPE_SECRET_KEY is in Secrets Store binding SECRET_STRIPE)
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET

# R2 storage (after bucket + keys created — section 5)
pnpm exec wrangler secret put STORAGE_SERVICE_URL              # https://<account-id>.r2.cloudflarestorage.com
pnpm exec wrangler secret put STORAGE_ACCESS_KEY
pnpm exec wrangler secret put STORAGE_SECRET_KEY
pnpm exec wrangler secret put STORAGE_BUCKET_NAME              # musashi-uploads

# Modal pose proxy
pnpm exec wrangler secret put MUSASHI_POSE_CLOUD_GPU_URL
pnpm exec wrangler secret put MUSASHI_POSE_CLOUD_CPU_URL
pnpm exec wrangler secret put MUSASHI_POSE_CLOUD_TOKEN         # same value as Modal POSE_API_TOKEN
```

Optional:

```powershell
pnpm exec wrangler secret put MUSASHI_STRIPE_PRICE_ID_PRO
pnpm exec wrangler secret put MUSASHI_SHOGUN_PASSWORD_HASH     # prefer over raw password
pnpm exec wrangler secret put MUSASHI_AI_KILL_SWITCH             # emergency spend stop (=1)
```

Generate random secrets (PowerShell):

```powershell
# 64-char hex session/cron secrets
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

Verify before deploy:

```powershell
pnpm check:launch:strict
```

Note: strict check reads `.env.local` locally. For Cloudflare-only secrets, also run `pnpm exec wrangler secret list` after login.

---

## 5. R2 bucket + scoped keys

Requires `wrangler login` first.

### Create bucket

```powershell
pnpm exec wrangler r2 bucket create musashi-uploads
pnpm exec wrangler r2 bucket list
```

### S3-compatible API keys (dashboard — no full CLI for scoped keys)

1. Cloudflare dashboard → **R2** → **Manage R2 API Tokens**
2. Create token scoped to bucket `musashi-uploads` with **Object Read & Write**
3. Copy **Access Key ID**, **Secret Access Key**, and note your **Account ID**

Set secrets:

```powershell
pnpm exec wrangler secret put STORAGE_SERVICE_URL
# Value: https://<ACCOUNT_ID>.r2.cloudflarestorage.com

pnpm exec wrangler secret put STORAGE_ACCESS_KEY
pnpm exec wrangler secret put STORAGE_SECRET_KEY
pnpm exec wrangler secret put STORAGE_BUCKET_NAME
# Value: musashi-uploads
```

### Optional lifecycle rule (raw video TTL)

Dashboard → R2 → `musashi-uploads` → **Settings** → **Lifecycle rules** → delete objects under prefix `uploads/` after 7–30 days.

---

## 6. Custom domain + MUSASHI_APP_URL

Worker name in `wrangler.toml`: `app`. Default URL after deploy: `https://app.<subdomain>.workers.dev`

### Attach custom domain

**Dashboard (recommended):**

1. Workers & Pages → **app** → **Settings** → **Domains & Routes**
2. **Add Custom Domain** → e.g. `app.musashi.ai`
3. Confirm DNS (Cloudflare-managed zone auto-configures)

**Or wrangler.toml** (if zone is on Cloudflare):

```toml
routes = [
  { pattern = "app.musashi.ai", custom_domain = true }
]
```

Then set the secret to match:

```powershell
pnpm exec wrangler secret put MUSASHI_APP_URL
# Value: https://app.musashi.ai
```

Used for Stripe Connect return URLs and auth email links.

---

## 7. Stripe webhook (post-deploy)

1. Stripe Dashboard → **Developers** → **Webhooks** → **Add endpoint**
2. URL: `https://YOUR_DOMAIN/api/billing/webhook`
3. Events: `checkout.session.completed`, `account.updated`, subscription events
4. Copy signing secret → `pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET`

---

## 8. CI deploy (non-interactive)

Create API token at https://dash.cloudflare.com/profile/api-tokens with:

- Account: Workers Scripts Edit, D1 Edit, R2 Edit, Account Settings Read

```yaml
# .github/workflows/deploy.yml (example)
env:
  CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
run: pnpm deploy
```

---

## Phase 1 completion checklist

- [ ] Wrangler logged in (`pnpm exec wrangler whoami`)
- [ ] Remote D1 migrated (`pnpm db:migrate:remote`)
- [ ] All secrets set (`pnpm exec wrangler secret list`)
- [ ] Vars confirmed in wrangler.toml or dashboard
- [ ] R2 bucket `musashi-uploads` + scoped keys
- [ ] Custom domain attached; `MUSASHI_APP_URL` matches
- [ ] Build succeeds (WSL, Developer Mode, or CI)
- [ ] `pnpm deploy` green
- [ ] Stripe webhook pointed at `/api/billing/webhook`
- [ ] `pnpm check:launch:strict` passes with production env

See also: `docs/MARKETPLACE_LAUNCH.md`, `docs/CLOUD_API_CHECKLIST.md`
