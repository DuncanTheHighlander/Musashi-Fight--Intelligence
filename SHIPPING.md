# Ship Musashi to Web + App Store (ASAP path)

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

Musashi is a **Next.js web app**. Fastest store path: **Capacitor WebView** loading your production URL (no native rewrite).

```bash
cd mobile
npm init -y
npm install @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android
npx cap init Musashi com.musashi.fightcoach --web-dir .
# Edit capacitor.config.json → set server.url to your deployed URL
npx cap add ios
npx cap add android
npx cap sync
npx cap open ios    # Xcode → Archive → App Store Connect
npx cap open android # Android Studio → Release bundle
```

**Store checklist**

- [ ] PNG app icons 1024×1024 (generate from `public/musashi-icon.svg`)
- [ ] Privacy policy + Terms URLs on your domain
- [ ] Apple Developer ($99/yr) + Google Play ($25 one-time)
- [ ] Screenshots from Fight Lab on real phone
- [ ] Age rating questionnaire (sports / fitness)

**Apple note:** WebView apps need clear native value — camera roll upload + offline skeleton cache count. Capacitor file picker plugin recommended.

## RTMPose status

- Code: wired in `FightAnalyzer` dense pass only, flag `?poseBackend=rtmpose`
- Model: run `pnpm fetch:rtm-model` or manual per `RTMPOSE_SETUP.md`
- Cloud offload scaffold: `cloud/modal_app.py` wraps `cloud/pose_pipeline.py` as a Modal GPU endpoint
- **Not required for v1 ship** — MediaPipe path is the production default

## Deploy from laptop

Your laptop only runs `pnpm dev` and `pnpm test:loop`. Production runs on Cloudflare after `pnpm deploy` — users never hit your machine.
