# Marketplace launch — plug in APIs only

The marketplace **code is done**. Local dev works with mock payment + mock storage.
Production is: set secrets → migrate D1 → deploy → point Stripe webhook.

Project path:

```
C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package
```

## Verify before deploy

```powershell
cd "C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package"
pnpm test:marketplace:full          # 53 tests + next build
pnpm check:cf-env                   # wrangler.toml production gate
node scripts/marketplace-plug-in-check.mjs   # shows missing keys (dev OK)
node scripts/marketplace-plug-in-check.mjs --strict   # fails if keys missing
```

**Full deploy runbook:** `docs/DEPLOY_CHECKLIST.md`

## Production secrets

### Account-level (Cloudflare Secrets Store)

Already bound in `wrangler.toml` — verify with `wrangler secrets-store secret list`. **Do not** duplicate via `wrangler secret put`:

| Binding | Store name | Purpose |
|---------|------------|---------|
| `SECRET_AI` | `Ai` | Gemini AI |
| `SECRET_STRIPE` | `Stripe` | Stripe secret key |
| `SECRET_MODAL` | `Modal` | Modal API |
| `SECRET_REVCAT1` / `SECRET_REVCAT2` | `revcat1` / `revcat2` | RevenueCat |
| `SECRET_SUPABASE` | `Supabase` | Supabase service role |

See `docs/CLOUDFLARE_SECRETS_STORE.md`.

### Per-Worker (`wrangler secret put`)

Set via `wrangler secret put KEY` or Cloudflare dashboard:

| Secret | Purpose |
|--------|---------|
| `MUSASHI_SESSION_SECRET` | Auth sessions (64+ random chars) |
| `MUSASHI_SHOGUN_EMAIL` | Admin login |
| `MUSASHI_SHOGUN_PASSWORD` | Admin password (strong, not default) |
| `MUSASHI_CRON_SECRET` | Protects `/api/cron/marketplace` |
| `MUSASHI_APP_URL` | e.g. `https://app.musashi.ai` (Connect return URLs) |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature |
| `STORAGE_SERVICE_URL` | R2 S3 endpoint |
| `STORAGE_ACCESS_KEY` | R2 key |
| `STORAGE_SECRET_KEY` | R2 secret |
| `STORAGE_BUCKET_NAME` | e.g. `musashi-uploads` |

Also set **vars** (not secrets) in `wrangler.toml` or dashboard:

```bash
MUSASHI_MARKETPLACE_PAYMENTS=stripe
MUSASHI_STORAGE_MODE=r2
NODE_ENV=production
```

**Never** set `MUSASHI_DISABLE_AUTH=1` in production.

## Deploy steps

1. **Migrate remote D1**
   ```powershell
   wrangler login
   pnpm db:migrate:remote
   ```

2. **Build + deploy** (use WSL/Linux or CI — Windows symlinks can block OpenNext)
   ```bash
   pnpm deploy
   ```

3. **Stripe webhook**
   - URL: `https://YOUR_DOMAIN/api/billing/webhook`
   - Events: `checkout.session.completed`, `account.updated`, subscription events

4. **R2 bucket**
   - Create bucket, enable S3 API, scoped keys
   - Optional: 7–30 day lifecycle on raw video prefix

## Post-deploy smoke (15 min)

1. `/signup` → `/onboarding` → choose train/coach/both
2. **Auth recovery (logged out):** `/login` → Forgot password → `/forgot-password` → email link → `/reset-password?token=…` → sign in with new password
3. **Email verify (if Resend configured):** trigger verify email → `/verify-email?token=…` confirms account
4. `/marketplace/jobs/new` — upload a video file (not URL paste)
5. Fund bounty (Stripe Checkout in stripe mode, instant in mock mode)
6. Second account: analyst claims → submit deliverable upload
7. Fighter approves → check ledger payout row
8. `/marketplace/settings` — Connect onboarding for analyst payouts

## Dev without any paid keys

```bash
MUSASHI_MARKETPLACE_PAYMENTS=mock
MUSASHI_STORAGE_MODE=mock
MUSASHI_DISABLE_AUTH=1   # local only
pnpm dev
```

Full checklist: `docs/CLOUD_API_CHECKLIST.md`

Phase 1 infrastructure runbook: `docs/PHASE1_INFRASTRUCTURE.md` (preflight: `.\scripts\phase1-setup.ps1`)
