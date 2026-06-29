# Ship Musashi to Web + App Store (ASAP path)

## Customer MVP — Fight Lab only (fastest path to paying users)

Ship **upload → skeleton → AI coaching** first. Marketplace, Stripe, and R2 can wait.

### Before deploy (one-time)

```bash
cd "C:\Users\smith\Desktop\codiing\Musashi\fight app\download_package"
pnpm install
pnpm icons                    # PWA PNG icons (192 + 512)
pnpm check:launch             # see what's set vs missing
```

Set these in **Cloudflare Worker secrets** (`wrangler secret put NAME`):

| Secret | Purpose |
|--------|---------|
| `GEMINI_API_KEY` | AI coaching |
| `MUSASHI_SESSION_SECRET` | Login sessions (random 32+ chars) |
| `MUSASHI_SHOGUN_EMAIL` | Admin account |
| `MUSASHI_SHOGUN_PASSWORD` | Strong admin password |
| `MUSASHI_CRON_SECRET` | Marketplace cron (random string) |

Set in **wrangler.toml `[vars]`** or Cloudflare dashboard:

| Var | MVP value |
|-----|-----------|
| `MUSASHI_APP_URL` | Your public URL, e.g. `https://app.yourdomain.com` |
| `MUSASHI_MARKETPLACE_PAYMENTS` | `mock` (default in wrangler.toml) |
| `MUSASHI_STORAGE_MODE` | `mock` (Fight Lab does not need R2) |

**Do NOT** set `MUSASHI_DISABLE_AUTH=1` in production.

### Deploy

```bash
pnpm db:migrate:remote
pnpm predeploy          # prod env check + 226 unit tests
pnpm deploy
```

### First customer test (Android)

1. Open your deployed URL in **Chrome on Android**
2. Sign up at `/signup` → onboarding → home **Fight Lab**
3. Upload a short clip → confirm skeleton + coaching appear
4. Chrome menu → **Add to Home screen** (PWA)

### Optional: Android app icon (Capacitor)

Edit `mobile/capacitor.config.json` → set `server.url` to your deployed URL, then follow the Capacitor section below.

---

## What runs where (cheapest)

| Work | Where | Cost |
|------|--------|------|
| Pose tracking (MediaPipe) | User's phone browser | **$0** to you |
| Dense boot pass | User's device | **$0** |
| AI coaching (Gemini) | Cloudflare Workers API | Pay per use + cache |
| Video storage (optional) | Cloudflare R2 | ~$0.015/GB/mo |
| RTMPose dense pass (optional) | Modal GPU API once deployed | Pay-per-use GPU |

**Do not** move MediaPipe to cloud GPU for v1 — it adds cost and latency. Ship with client-side pose for instant preview; use the cloud RTMPose path only for uploaded clips that need the heavier analysis pass.

## QA loop (run before every ship)

```bash
pnpm test:loop              # ~30s — tsc, unit tests, 3-clip replay baselines
pnpm test:loop --e2e        # slow — browser dense pass on all 3 clips (dev server must be running)
```

Manual browser loop (auto-cycles clip1 → clip2 → clip3):

```
http://localhost:3000/?qaLoop=1
```

RTM A/B (after model download):

```bash
pnpm fetch:rtm-model
http://localhost:3000/?qaLoop=1&poseBackend=rtmpose
```

## Test clips (in `public/test-videos/`)

| ID | File | Role |
|----|------|------|
| clip1 | `test-video-for-app.mp4` | Portrait demo |
| clip2 | `clip2-overlap.mp4` | Overlap / busy |
| clip3 | `slowmo-slip.mp4` | Hard slow-mo |

Manifest: `public/test-videos/clips.manifest.json`  
Regression gates: `tracking-eval-2026-06-11/baselines.json`

## Web launch (this week)

1. `pnpm check:prod-env` — set `GEMINI_API_KEY`, disable `MUSASHI_DISABLE_AUTH` in prod
2. `pnpm deploy` — Cloudflare Workers
3. Custom domain + privacy policy URL
4. PWA: users can Add to Home Screen (`public/manifest.json` already exists)

## Deployed marketplace smoke test

Run this on the Cloudflare-backed environment when you want the real flow, not
the local in-memory mock.

```bash
pnpm db:migrate:remote
pnpm deploy
```

Before deploy, production should have `MUSASHI_DISABLE_AUTH` unset/false,
`GEMINI_API_KEY` set, and `MUSASHI_CRON_SECRET` set if you want to call the cron
endpoint manually.

Smoke path:

1. Visit `/signup` on the deployed URL and create a new account.
2. Confirm signup redirects to `/onboarding`.
3. Choose `Both`, save a fighter profile, then save a coach profile.
4. Open `/marketplace/settings` and confirm the coach profile is enabled.
5. Open `/coaches` and confirm the new coach appears at the starting rank.
6. Open `/marketplace` and confirm the old fake profiles are gone: Sarah Chen,
   Alex Rodriguez, Mike Johnson, and Lena Kobayashi should not appear.
7. Create a test bounty at `/marketplace/jobs/new`. The Stripe path is still
   stubbed, so ledger rows stay `pending_stripe`; no real money moves yet.

Optional cron check:

```bash
curl -H "X-Cron-Secret: $MUSASHI_CRON_SECRET" https://YOUR_DOMAIN/api/cron/marketplace
```

## App Store / Play Store (2–3 weeks)

Musashi is a **Next.js web app**. Store path: existing **Capacitor WebView shell** in `mobile/` loading your production URL (no native rewrite).

**Google Play:** full step-by-step → [`docs/ANDROID.md`](docs/ANDROID.md) and [`mobile/README.md`](mobile/README.md).

Quick path after web deploy:

```bash
pnpm icons                    # 192 + 512 PNG from public/musashi-icon.svg
# Edit mobile/capacitor.config.json → server.url = your live HTTPS URL
pnpm mobile:sync
pnpm mobile:android           # Android Studio → Generate Signed Bundle (AAB)
```

Package name for Play Console: **`ai.musashi.app`** (must match `appId` in `mobile/capacitor.config.json`).

**Store checklist**

- [ ] Web deployed; `server.url` matches live URL (`cleartext: false`)
- [ ] `pnpm icons` — Play listing icon 512×512 from `public/musashi-icon-512.png`
- [ ] Privacy policy + Terms at `https://YOUR_DOMAIN/privacy` and `/terms`
- [ ] Google Play developer account ($25 one-time)
- [ ] Signed release AAB + Play Console listing (screenshots, data safety, content rating)
- [ ] Apple Developer ($99/yr) if shipping iOS later

**Apple note:** WebView apps need clear native value — camera roll upload + offline skeleton cache count. Capacitor file picker plugin recommended.

## RTMPose status

- Code: wired in `FightAnalyzer` dense pass only, flag `?poseBackend=rtmpose`
- Model: run `pnpm fetch:rtm-model` or manual per `RTMPOSE_SETUP.md`
- Cloud offload scaffold: `cloud/modal_app.py` wraps `cloud/pose_pipeline.py` as a Modal GPU endpoint
- **Not required for v1 ship** — MediaPipe path is the production default

## Deploy from laptop

Your laptop only runs `pnpm dev` and `pnpm test:loop`. Production runs on Cloudflare after `pnpm deploy` — users never hit your machine.
