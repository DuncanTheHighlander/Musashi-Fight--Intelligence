# Musashi Cloudflare Deploy Checklist

Project path:

```
C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package
```

Use this as the single step-by-step for production deploy with **Secrets Store** + **Worker secrets**.

---

## Pre-flight (automated — already done)

| Check | Status |
|-------|--------|
| `pnpm exec tsc --noEmit` | Must pass |
| `wrangler.toml` Secrets Store bindings (6) | Configured |
| `wrangler.toml` `[vars]` stripe / r2 / production | Configured |
| Stripe code uses `SECRET_STRIPE` helpers | Done |
| `.dev.vars.example` + `.dev.vars` scaffold | Created (placeholders only) |
| `pnpm check:cf-env` | Validates wrangler.toml (not `.env.local`) |

---

## 1. Authenticate Wrangler (~2 min, **you**)

```powershell
cd "C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package"
pnpm exec wrangler login          # browser OAuth — required once
pnpm exec wrangler whoami         # must show your account
```

If `whoami` fails with `Cannot use the access token from location ... [code: 9109]`,
the token is IP/location restricted. Re-authenticate with `pnpm exec wrangler login`
from this machine, or edit/create the API token in the Cloudflare dashboard so this
current network is allowed.

**CI / non-interactive:** create an API token at https://dash.cloudflare.com/profile/api-tokens with Workers Scripts Edit, D1 Edit, R2 Edit, Secrets Store Read. Then:

```powershell
$env:CLOUDFLARE_API_TOKEN = "<your-token>"
$env:CLOUDFLARE_ACCOUNT_ID = "<your-account-id>"   # optional but recommended for CI
pnpm exec wrangler whoami
```

---

## 2. Secrets Store (account-level — **already bound**, verify only)

These six secrets are **not** set via `wrangler secret put`. They live in Cloudflare Secrets Store and are read at runtime via `env.SECRET_*.get()`.

| Binding | Store secret name | Maps to env alias |
|---------|-------------------|-------------------|
| `SECRET_AI` | `Ai` | `GEMINI_API_KEY` |
| `SECRET_MODAL` | `Modal` | `MODAL_API_KEY` |
| `SECRET_REVCAT1` | `revcat1` | `REVENUECAT_API_KEY` |
| `SECRET_REVCAT2` | `revcat2` | `REVENUECAT_API_KEY_SECONDARY` |
| `SECRET_STRIPE` | `Stripe` | `STRIPE_SECRET_KEY` |
| `SECRET_SUPABASE` | `Supabase` | `SUPABASE_SERVICE_ROLE_KEY` |

Store ID: `3a6ee7307f0b482ab4b3f3dd6794168c`

```powershell
pnpm exec wrangler secrets-store secret list 3a6ee7307f0b482ab4b3f3dd6794168c --remote
```

If any secret is missing, add it in the Cloudflare dashboard (Secrets Store) or:

```powershell
pnpm exec wrangler secrets-store secret create 3a6ee7307f0b482ab4b3f3dd6794168c --name Stripe --value "<sk_live_...>"
```

See `docs/CLOUDFLARE_SECRETS_STORE.md` for details.

---

## 3. Per-Worker secrets (`wrangler secret put`) (~15 min, **you**)

These are listed in `wrangler.toml` `[secrets].required`. Set each interactively (prompts for value):

```powershell
cd "C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package"

# Auth + app
pnpm exec wrangler secret put MUSASHI_SESSION_SECRET
pnpm exec wrangler secret put MUSASHI_SHOGUN_EMAIL
pnpm exec wrangler secret put MUSASHI_SHOGUN_PASSWORD
pnpm exec wrangler secret put MUSASHI_CRON_SECRET
pnpm exec wrangler secret put MUSASHI_APP_URL

# Stripe webhook (Stripe secret key comes from Secrets Store, NOT here)
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET

# R2 storage
pnpm exec wrangler secret put STORAGE_SERVICE_URL
pnpm exec wrangler secret put STORAGE_ACCESS_KEY
pnpm exec wrangler secret put STORAGE_SECRET_KEY
pnpm exec wrangler secret put STORAGE_BUCKET_NAME

# Modal pose proxy
pnpm exec wrangler secret put MUSASHI_POSE_CLOUD_GPU_URL
pnpm exec wrangler secret put MUSASHI_POSE_CLOUD_CPU_URL
pnpm exec wrangler secret put MUSASHI_POSE_CLOUD_TOKEN
```

**Generate random secrets (PowerShell):**

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

**Optional:**

```powershell
pnpm exec wrangler secret put MUSASHI_SHOGUN_PASSWORD_HASH
pnpm exec wrangler secret put MUSASHI_STRIPE_PRICE_ID_PRO
pnpm exec wrangler secret put STRIPE_PUBLISHABLE_KEY
```

Verify:

```powershell
pnpm exec wrangler secret list
```

---

## 4. R2 bucket (~10 min, **you**)

```powershell
pnpm exec wrangler r2 bucket create musashi-uploads
pnpm exec wrangler r2 bucket list
```

Create scoped S3 API keys in dashboard → R2 → Manage R2 API Tokens → scope to `musashi-uploads`.

Set the four `STORAGE_*` worker secrets (step 3) with:

- `STORAGE_SERVICE_URL` = `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`
- `STORAGE_BUCKET_NAME` = `musashi-uploads`

---

## 5. D1 migrations (~2 min, **you**)

```powershell
pnpm db:migrate:remote
```

Database: `musashi-db` (`eda3460e-70ab-4eef-b273-0efc52007c82`)

Required launch migrations currently include `migrations/0025_gyms_and_credits.sql`,
`migrations/0026_clip_question_limits.sql`, and
`migrations/0027_assets_analysis_clip_purpose.sql`.

---

## 6. Build + deploy (~10–20 min, **you**)

**Windows blocker:** `pnpm build:cf` fails with `EPERM symlink` unless Developer Mode or WSL is enabled.

| Option | Steps |
|--------|-------|
| **A. Developer Mode** | Settings → System → For developers → Developer Mode ON → `pnpm deploy` |
| **B. WSL** | `wsl --install`, reboot, deploy from `/mnt/c/.../download_package` |
| **C. GitHub Actions** | `ubuntu-latest` + `CLOUDFLARE_API_TOKEN` → `pnpm deploy` |

```powershell
pnpm check:cf-env              # wrangler.toml gate (no .env.local needed)
pnpm predeploy                 # check:cf-env + unit tests
pnpm deploy                    # opennext build + wrangler deploy
```

Default URL: `https://app.<subdomain>.workers.dev`

Set `MUSASHI_APP_URL` secret to match your live domain after first deploy.

---

## 7. Stripe webhook (post-deploy, ~5 min, **you**)

1. Stripe Dashboard → Webhooks → Add endpoint
2. URL: `https://YOUR_DOMAIN/api/billing/webhook`
3. Events: `checkout.session.completed`, `account.updated`, subscription events
4. Copy signing secret → `pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET`

---

## 8. Local dev files (reference)

| File | Purpose | Commit? |
|------|---------|---------|
| `.env.local` | `next dev` — your keys (35 vars currently set) | No |
| `.dev.vars` | Wrangler local preview — placeholder scaffold created | No |
| `.dev.vars.example` | Template for Secrets Store aliases + worker secrets | Yes |

**Note:** `.env.local` has `MUSASHI_DISABLE_AUTH=1` and mock payment/storage — fine for local dev. Production uses `wrangler.toml` `[vars]` + Worker secrets, not `.env.local`.

Fill `.dev.vars` with **test** credentials (not production) when running:

```powershell
pnpm preview    # OpenNext + Wrangler local
```

---

## 9. Smoke test (~15 min, **you**)

1. `/signup` → `/onboarding`
2. `/marketplace/jobs/new` — upload video
3. Fund bounty (Stripe Checkout)
4. Analyst claims → submit deliverable
5. Fighter approves → ledger payout
6. `/marketplace/settings` — Stripe Connect onboarding

Full list: `docs/MARKETPLACE_LAUNCH.md`

---

## Quick reference: where each secret goes

```
Secrets Store (account)          wrangler secret put (per Worker)
─────────────────────────        ────────────────────────────────
SECRET_AI / Ai                   MUSASHI_SESSION_SECRET
SECRET_STRIPE / Stripe           MUSASHI_SHOGUN_EMAIL
SECRET_MODAL / Modal             MUSASHI_SHOGUN_PASSWORD
SECRET_REVCAT1 / revcat1         MUSASHI_CRON_SECRET
SECRET_REVCAT2 / revcat2         MUSASHI_APP_URL
SECRET_SUPABASE / Supabase       STRIPE_WEBHOOK_SECRET
                                 STORAGE_SERVICE_URL
                                 STORAGE_ACCESS_KEY
                                 STORAGE_SECRET_KEY
                                 STORAGE_BUCKET_NAME
                                 MUSASHI_POSE_CLOUD_GPU_URL
                                 MUSASHI_POSE_CLOUD_CPU_URL
                                 MUSASHI_POSE_CLOUD_TOKEN

wrangler.toml [vars] (plain text, already set):
  MUSASHI_MARKETPLACE_PAYMENTS=stripe
  MUSASHI_STORAGE_MODE=r2
  NODE_ENV=production
```

---

## Related docs

- `docs/CLOUDFLARE_SECRETS_STORE.md` — binding access patterns
- `docs/MARKETPLACE_LAUNCH.md` — marketplace smoke test
- `docs/PHASE1_INFRASTRUCTURE.md` — R2, custom domain, CI
