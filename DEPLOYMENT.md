# Musashi — Cloudflare Production Deploy

Short checklist with exact commands. Full detail: `docs/DEPLOY_CHECKLIST.md`.

All commands from the repo root:

```powershell
cd "C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package"
```

## 0. One-time: authenticate

```powershell
pnpm exec wrangler login
pnpm exec wrangler whoami
```

## 1. Account-level Secrets Store (verify only)

`STRIPE_SECRET_KEY` and `GEMINI_API_KEY` come from Cloudflare Secrets Store bindings
(`SECRET_STRIPE`, `SECRET_AI`) — **not** `wrangler secret put`. Verify they exist:

```powershell
pnpm exec wrangler secrets-store secret list 3a6ee7307f0b482ab4b3f3dd6794168c --remote
```

The `Stripe` store secret must be the **live** key (`sk_live_...`).

## 2. Per-Worker secrets (`wrangler secret put`)

Each command prompts for the value. Never commit these.

```powershell
pnpm exec wrangler secret put MUSASHI_SESSION_SECRET    # random 64+ chars
pnpm exec wrangler secret put MUSASHI_SHOGUN_EMAIL      # admin login email
pnpm exec wrangler secret put MUSASHI_SHOGUN_PASSWORD   # strong, NOT the default
pnpm exec wrangler secret put MUSASHI_CRON_SECRET       # random 64 chars
pnpm exec wrangler secret put MUSASHI_APP_URL           # https://your-live-domain
pnpm exec wrangler secret put EMAIL_API_KEY             # Resend key (re_...)
pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET     # whsec_... (step 6)
pnpm exec wrangler secret put STORAGE_SERVICE_URL       # https://<ACCOUNT_ID>.r2.cloudflarestorage.com
pnpm exec wrangler secret put STORAGE_ACCESS_KEY        # R2 S3 API token key
pnpm exec wrangler secret put STORAGE_SECRET_KEY        # R2 S3 API token secret
pnpm exec wrangler secret put STORAGE_BUCKET_NAME       # musashi-uploads
```

Generate a random secret value (PowerShell):

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

Optional (billing subscriptions / pose cloud):

```powershell
pnpm exec wrangler secret put MUSASHI_STRIPE_PRICE_ID_PRO
pnpm exec wrangler secret put MUSASHI_STRIPE_PRICE_ID_PRO_6MO
pnpm exec wrangler secret put MUSASHI_STRIPE_PRICE_ID_PRO_YEARLY
pnpm exec wrangler secret put MUSASHI_POSE_CLOUD_GPU_URL
pnpm exec wrangler secret put MUSASHI_POSE_CLOUD_CPU_URL
pnpm exec wrangler secret put MUSASHI_POSE_CLOUD_TOKEN
```

Verify: `pnpm exec wrangler secret list`

## 3. Plain vars (already committed)

`wrangler.toml` / `wrangler.bundle.toml` `[vars]` already set:
`MUSASHI_MARKETPLACE_PAYMENTS=stripe`, `MUSASHI_STORAGE_MODE=r2`,
`NODE_ENV=production`, `EMAIL_SERVICE_URL`, `EMAIL_FROM_ADDRESS`.
The `EMAIL_FROM_ADDRESS` domain (`musashi.ai`) must be verified in Resend.

## 4. R2 buckets

Bindings expect buckets `musashi` and `musashi-uploads`. Presigned uploads use the
`STORAGE_*` secrets scoped to `musashi-uploads` (dashboard → R2 → Manage R2 API Tokens).

```powershell
pnpm exec wrangler r2 bucket list
```

## 5. D1 migrations

Database `musashi-db` (`c567e219-abc3-4ebb-868a-6c3b4cc4e5ae`):

```powershell
pnpm db:migrate:remote
```

## 6. Deploy

```powershell
pnpm check:cf-env    # config gate
pnpm predeploy       # env check + unit tests
pnpm deploy          # build:cf + wrangler deploy --config wrangler.bundle.toml
```

Windows note: `build:cf` needs Developer Mode ON (symlinks) — or deploy from WSL/CI.

## 7. Stripe webhook (after first deploy)

1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://YOUR_DOMAIN/api/billing/webhook`
3. Events: `checkout.session.completed`, `account.updated`,
   `customer.subscription.created`, `customer.subscription.updated`,
   `customer.subscription.deleted`
4. Copy the signing secret → `pnpm exec wrangler secret put STRIPE_WEBHOOK_SECRET`
5. Redeploy is NOT needed — secrets apply immediately.

## 8. Smoke test

- `/signup` → onboarding → Fight Lab upload
- `/marketplace/jobs/new` → fund with Stripe Checkout (real card / live mode)
- Cron: `curl -H "X-Cron-Secret: <value>" https://YOUR_DOMAIN/api/cron/marketplace`
- Password reset email arrives (Resend)

Never set `MUSASHI_DISABLE_AUTH` in production — startup validation refuses to boot.

## 9. Mobile store shells (after web is live)

```powershell
pnpm check:mobile-release   # appId, https URL, allowBackup, iOS usage strings
pnpm mobile:sync
pnpm mobile:android         # Play AAB via Android Studio
# on a Mac: pnpm mobile:ios
```

- Gap inventory: `docs/superpowers/specs/2026-07-09-mobile-store-gaps.md`
- Data safety / App Privacy: `docs/STORE_DATA_SAFETY.md`
- Device QA (welcome, 10s/30s trimmer, thumbs-down): `docs/MOBILE_STORE_QA.md`

`MUSASHI_APP_URL` and `mobile/capacitor.config.json` → `server.url` must be the same host.
