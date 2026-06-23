# Musashi API Keys And Launch Checklist

This is the working list of accounts, keys, secrets, and app work needed to move
Musashi from local dev to a real web launch. Do not paste real secret values in
this file; keep them in `.env.local` for local dev and Cloudflare Worker secrets
for production.

## Launch-Critical Keys

### 1. Google Gemini

Purpose: AI fight analysis, burst analysis, strategy, chat coaching, embeddings,
and retrieval.

Required env:

```bash
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.1-pro-preview
GEMINI_FLASH_MODEL=gemini-3-flash-preview
GEMINI_REFLEX_MODEL=gemini-3-flash-preview
GEMINI_TRACK_MODEL=gemini-3-flash-preview
GEMINI_BURST_MODEL=gemini-3.1-pro-preview
GEMINI_STRATEGY_MODEL=gemini-3.1-pro-preview
GEMINI_EMBED_MODEL=gemini-embedding-2-preview
```

Get it from Google AI Studio. Keep `MUSASHI_AI_KILL_SWITCH=1` available as an
emergency production secret if spend spikes.

### 2. Cloudflare

Purpose: production hosting, D1 database, scheduled marketplace cron, optional
Vectorize, optional Workers AI, and optional R2 storage.

Required account/setup:

```bash
wrangler login
pnpm db:migrate:remote
pnpm deploy
```

For CI or non-interactive deploys:

```bash
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
```

The token needs Workers deploy, D1, Vectorize, and R2 permissions once upload
storage is enabled.

Already configured in `wrangler.toml`:

```bash
DB=musashi-db
VECTORIZE=musashi-knowledge
AI=<Cloudflare AI binding>
```

Production secrets to set in Cloudflare:

```bash
GEMINI_API_KEY=
MUSASHI_SESSION_SECRET=
MUSASHI_SHOGUN_EMAIL=
MUSASHI_SHOGUN_PASSWORD=
MUSASHI_CRON_SECRET=
```

Do not set `MUSASHI_DISABLE_AUTH=1` in production.

### 3. Auth And Admin Secrets

Purpose: real signup/login sessions and admin access.

Required env:

```bash
MUSASHI_SESSION_SECRET=
MUSASHI_SHOGUN_EMAIL=
MUSASHI_SHOGUN_PASSWORD=
```

Optional env:

```bash
MUSASHI_SHOGUN_INVITE_CODE=
MUSASHI_SHOGUN_PASSWORD_HASH=
```

Use a fresh random session secret and a non-default shogun password before any
public deploy. Prefer `MUSASHI_SHOGUN_PASSWORD_HASH` over a raw password once
the production admin account is finalized.

### 4. Stripe Billing

Purpose: Pro subscription checkout, customer portal, and subscription webhooks.
This exists separately from marketplace escrow.

Required env:

```bash
STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=
MUSASHI_STRIPE_PRICE_ID_PRO=
MUSASHI_MARKETPLACE_PAYMENTS=mock
```

Optional hardening:

```bash
MUSASHI_STRIPE_ALLOWED_PRICE_IDS=
```

Current status: subscription checkout and webhooks exist. Marketplace funding
can run in no-key mock mode today; when `MUSASHI_MARKETPLACE_PAYMENTS=stripe`,
the bounty flow creates a Stripe Checkout session and the signed Stripe webhook
marks the job funded after `checkout.session.completed`.

## Needed For A Real Marketplace

### 5. Stripe Connect

Purpose: coach onboarding, payout accounts, transfers, refunds, and dispute
reconciliation for marketplace jobs.

Needed product work:

- Add Connect onboarding flow for analysts.
- Store `stripe_connect_id`, `stripe_payouts_enabled`, and onboarding timestamp.
- Keep hosted Checkout funding enabled for bounties.
- Create Connect transfers on release and refunds on cancel/dispute.

Current status: bounty funding has a Stripe Checkout scaffold; coach payout,
refund, and dispute money movement still need Connect wiring.

### 6. Cloudflare R2

Purpose: uploaded fight videos, marketplace deliverables, and analysis assets.
Do not put raw videos in D1.

Required env when upload storage is wired:

```bash
STORAGE_SERVICE_URL=https://<account-id>.r2.cloudflarestorage.com
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_BUCKET_NAME=musashi-uploads
```

Recommended setup:

- Create an R2 bucket scoped to Musashi uploads.
- Use S3-compatible access keys scoped to the bucket.
- Add a 7-30 day lifecycle rule for raw videos.
- Keep generated reports and ledger data longer than raw video.

Current status: env/client scaffolding exists, but marketplace job posting still
uses pasted video URLs.

## Optional / Later Keys

### 7. Modal Cloud Pose

Purpose: optional RTMPose GPU offload for heavy uploaded clips. MediaPipe still
runs on-device and should remain the default v1 path.

Required after Modal deploy:

```bash
MUSASHI_POSE_CLOUD_GPU_URL=
MUSASHI_POSE_CLOUD_CPU_URL=
MUSASHI_POSE_CLOUD_TOKEN=
MUSASHI_POSE_PROXY_MAX_BYTES=268435456
MUSASHI_POSE_PROXY_TIMEOUT_MS=290000
```

Local deploy shape:

```powershell
$env:POSE_API_TOKEN="<same value as MUSASHI_POSE_CLOUD_TOKEN>"
modal deploy cloud\modal_app.py
modal deploy cloud\modal_cpu_app.py
```

Current status: Next proxy and Modal app scaffolds exist.

### 8. fal.ai

Purpose: optional SAM 3 segmentation.

Env:

```bash
FAL_KEY=
FAL_DRY_RUN=1
```

Current status: optional. Not required for marketplace launch.

### 9. OpenAI

Purpose: optional fallback/premium LLM provider for frame analysis and coaching.

Env:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_REFLEX_MODEL=
OPENAI_TRACK_MODEL=
FIGHT_LLM_PROVIDER=openai
```

Current status: optional fallback. Gemini is the primary path.

### 10. Email Provider

Purpose: future transactional email, verification, password reset, and receipts.

Env:

```bash
EMAIL_SERVICE_URL=https://api.resend.com
EMAIL_API_KEY=
EMAIL_FROM_ADDRESS=noreply@musashi.ai
```

Current status: env/client scaffolding exists, but auth currently has no email
verification or password reset flow.

### 11. Twilio

Purpose: optional SMS notifications or phone verification.

Env:

```bash
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
```

Current status: not required for launch.

### 12. Google Maps

Purpose: optional location search/display for gyms, coaches, or events.

Env:

```bash
GOOGLE_MAPS_API_KEY=
```

Current status: not required for launch.

## Zero-Spend / Safety Toggles

Use these locally or during demos to avoid paid calls:

```bash
OFFLINE_MODE=1
GEMINI_DRY_RUN=1
NEXT_PUBLIC_GEMINI_DRY_RUN=1
FAL_DRY_RUN=1
NEXT_PUBLIC_OFFLINE_MODE=1
```

Use this in production if spend needs to stop immediately:

```bash
MUSASHI_AI_KILL_SWITCH=1
```

## What Still Needs Building

### P0: Cloudflare Production Package Check

Current status: `next build` is green after a clean `.next` rebuild. The prior
`Cannot find module for page: /_document` failure was a stale build manifest.

`opennextjs-cloudflare build` now resolves the app config correctly, but on this
Windows machine it fails when Next copies pnpm-traced files into
`.next/standalone` because Windows refuses symlink creation with `EPERM`.

Needed:

- Run `opennextjs-cloudflare build` in WSL/Linux, Windows Developer Mode, or an
  elevated shell that can create symlinks.
- Deploy once against real Cloudflare bindings.
- Smoke test the deployed app with auth enabled.

### P0: Production Env Cleanup

Needed:

- Remove `MUSASHI_DISABLE_AUTH=1` from production.
- Replace default shogun password.
- Rotate any local secrets that were ever shared or zipped.
- Keep `.env.local` ignored.

### P0: Real D1 Smoke Test

Needed:

- Apply remote migrations.
- Deploy to Cloudflare.
- Create a real account through `/signup`.
- Complete `/onboarding`.
- Confirm `/marketplace` has no seeded fake people.
- Post a test bounty.

### P1: Marketplace Payments

Needed:

- Stripe PaymentIntent on job funding.
- Stripe Connect onboarding for coaches.
- Webhook reconciliation into the existing marketplace ledger.
- Real release/refund/transfer behavior.

### P1: Uploads Instead Of URL Paste

Needed:

- R2 direct upload or server-mediated upload.
- Store asset records with owner/job links.
- Replace pasted URLs in bounty posting and deliverables.

### P1: Account Front Door Polish

Needed:

- Redirect already-onboarded users past `/onboarding`.
- Add password reset and email verification.
- Add "complete profile" nudges for empty fighter/coach profiles.

### P2: Marketplace Trust And Operations

Needed:

- Analyst public profile polish.
- Coach rank review queue UI for Black+ promotions.
- Better dispute evidence uploads.
- Admin tools for hiding abusive reviews and refund notes.

## Quick Local Checks

```powershell
node scripts\check-prod-env.mjs --production
node scripts\test-migrations.mjs
.\node_modules\.bin\vitest.cmd run src/lib/marketplace/__tests__
node scripts\check-cloud-pose-ready.mjs
```
