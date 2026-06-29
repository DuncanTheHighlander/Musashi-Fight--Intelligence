# Musashi Launch Status

Last automated review: 2026-06-23

**Bottom line:** Application code is ~90% ready for a no-mock production launch. What remains is almost entirely **accounts, secrets, and one-time browser logins** — plus a **Windows build path** (Developer Mode, WSL, or CI) because `pnpm build:cf` fails with symlink `EPERM` on this machine.

Run preflight anytime:

```powershell
cd "C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package"
.\scripts\phase1-setup.ps1
pnpm check:launch:strict
```

---

## Automated checks (latest)

| Check | Result |
|-------|--------|
| `phase1-setup.ps1` | Ran — see blockers below |
| `wrangler whoami` | **Not authenticated** |
| WSL | **Not installed** |
| Windows Developer Mode | **Off** — symlinks blocked |
| `pnpm build:cf` | **Failed** — EPERM symlink (expected on this Windows setup) |
| Marketplace unit tests | **53/53 passed** |
| D1 migrations (local chain) | **22/22 OK** |
| TypeScript | **Clean** |
| Local dev server | **Running** — `/api/health` 200 |
| Key routes smoke test | `/`, `/login`, `/signup`, `/marketplace`, `/onboarding` → 200 |

---

## Local env status (names only — no values)

**`.env.local` exists.** **`.env` does not.**

| Variable | Status |
|----------|--------|
| `GEMINI_API_KEY` | Set |
| `MUSASHI_SESSION_SECRET` | Set |
| `MUSASHI_SHOGUN_EMAIL` | Set |
| `MUSASHI_SHOGUN_PASSWORD` | Set — **still default placeholder (change before launch)** |
| `FAL_KEY` | Set |
| `MUSASHI_POSE_CLOUD_*` | Set (Modal endpoints configured) |
| `MUSASHI_DISABLE_AUTH` | Set to `1` — **dev only, remove for production** |
| `MUSASHI_CRON_SECRET` | Set (added during automated setup) |
| `MUSASHI_APP_URL` | Set to `http://localhost:3000` (change to production URL before deploy) |
| `STRIPE_*` | **Missing** (mock payments OK for dev) |
| `STORAGE_*` | **Missing** (mock storage OK for dev) |
| `EMAIL_API_KEY` | **Missing** (dry-run email in dev) |
| `CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` | **Missing** (CI only) |

Production vars in `wrangler.toml` are already set: `MUSASHI_MARKETPLACE_PAYMENTS=stripe`, `MUSASHI_STORAGE_MODE=r2`, `NODE_ENV=production`.

---

## Blocked on user / helper (cannot automate)

### Required for launch

1. **Cloudflare account + `wrangler login`** — https://dash.cloudflare.com/sign-up  
   - One browser OAuth. Free Workers tier covers early traffic.  
   - Then: `pnpm db:migrate:remote`, set secrets, `pnpm deploy` (from WSL/CI/Dev Mode).

2. **Build/deploy path** — pick one:  
   - Enable **Windows Developer Mode** (Settings → System → For developers), or  
   - `wsl --install` + reboot + deploy from WSL, or  
   - GitHub Actions on `ubuntu-latest` with `CLOUDFLARE_API_TOKEN`.

3. **Production secrets** (via `pnpm exec wrangler secret put NAME` after login):  
   `GEMINI_API_KEY`, `MUSASHI_SESSION_SECRET`, `MUSASHI_SHOGUN_EMAIL`, `MUSASHI_SHOGUN_PASSWORD` (non-default), `MUSASHI_CRON_SECRET`, `MUSASHI_APP_URL`, `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STORAGE_SERVICE_URL`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_BUCKET_NAME`.

4. **Stripe** — https://dashboard.stripe.com/register  
   - Test mode free; live ~2.9% + 30¢ per charge. Connect needed for marketplace payouts.

5. **R2 bucket** — after wrangler login: `pnpm exec wrangler r2 bucket create musashi-uploads`  
   - Scoped API keys via dashboard (R2 → Manage R2 API Tokens). ~$0.015/GB-month.

6. **Custom domain + `MUSASHI_APP_URL`** — Cloudflare dashboard → Workers → app → Domains.

7. **Stripe webhook** — post-deploy: `https://YOUR_DOMAIN/api/billing/webhook`.

### Recommended

- **Resend email** — https://resend.com — `EMAIL_API_KEY` for verify/reset emails (free tier ~100/day).
- **Rotate default shogun password** and any secrets that were ever shared.
- **Remove `MUSASHI_DISABLE_AUTH=1`** from production env.

### Optional

- `MUSASHI_STRIPE_PRICE_ID_PRO` — Pro subscription billing.
- Modal cloud pose (already configured locally).
- Twilio, Google Maps, OpenAI fallback.

---

## Code readiness (~90% to no-mock launch)

**Working (real code):**

- Fight Lab: MediaPipe pose, Gemini coaching, burst/strategy, cost guards.
- Marketplace: jobs, escrow, Connect, uploads (mock/R2), 53 unit tests green.
- Auth: signup, login, onboarding, email token APIs.
- D1: 22 migrations, schema complete.

**Incomplete / mocked in dev:**

- Payments: `MUSASHI_MARKETPLACE_PAYMENTS=mock` locally.
- Storage: `MUSASHI_STORAGE_MODE=mock` locally.
- Auth bypass: `MUSASHI_DISABLE_AUTH=1` locally.
- Email: dry-run without `EMAIL_API_KEY`.
- UI placeholders: Coaches section “Coming soon”, Profile “Account Settings (Coming soon)”.
- Terms/privacy: placeholder support email TODO.

**Fixed this session:**

- Added `/verify-email`, `/reset-password`, `/forgot-password` pages (APIs existed; UI was missing).
- Login page: “Forgot password?” link.

---

## 30-minute helper script

Someone with browser access should:

1. Create/log into Cloudflare → run `pnpm exec wrangler login` (OAuth popup).
2. Create Stripe account → copy test/live API keys.
3. Get Gemini key from https://aistudio.google.com/app/apikey (if not reusing existing).
4. Enable Developer Mode **or** install WSL **or** set up GitHub Actions deploy.
5. Paste keys to you (or run `wrangler secret put` commands from `docs/PHASE1_INFRASTRUCTURE.md`).
6. Create R2 bucket + scoped token in Cloudflare dashboard.
7. After deploy: add Stripe webhook URL.

You cannot fully deploy without **at least one** human completing browser OAuth once.

---

See also: `docs/PHASE1_INFRASTRUCTURE.md`, `docs/MARKETPLACE_LAUNCH.md`, `docs/CLOUD_API_CHECKLIST.md`.
