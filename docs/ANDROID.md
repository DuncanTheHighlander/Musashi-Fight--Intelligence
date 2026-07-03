# Android distribution (Capacitor WebView)

Musashi ships to Google Play as a **Capacitor WebView shell** that loads the production web app. This avoids maintaining a separate native codebase while still listing on the Play Store.

## Architecture

```
┌─────────────────────┐     HTTPS      ┌──────────────────────────┐
│  Android APK/AAB    │  ───────────►  │  Musashi on Cloudflare   │
│  (Capacitor shell)  │   WebView      │  Workers + OpenNext      │
└─────────────────────┘                └──────────────────────────┘
                                              │
                                              ▼
                                       API keys / Stripe /
                                       D1 / R2 (server-side)
```

**API keys stay on the server.** The Android app contains no Gemini, Stripe, or Cloudflare secrets. Authentication and billing use the same server routes as the browser.

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Node.js 18+ | For Capacitor CLI in `mobile/` |
| Android Studio | Latest stable; includes SDK Manager |
| JDK 17+ | Usually bundled with Android Studio |
| Google Play developer account | $25 one-time fee |
| Deployed web app | `pnpm deploy` from repo root |

## Capacitor workflow

### Initial setup

```bash
cd mobile
npm install
npx cap add android    # if android/ not present
```

### Every release

1. **Deploy web** — from repo root:
   ```bash
   pnpm deploy
   ```
2. **Set URL** — edit `mobile/capacitor.config.json`:
   ```json
   "server": {
     "url": "https://app.<subdomain>.workers.dev",
     "cleartext": false,
     "androidScheme": "https"
   }
   ```
   After custom domain: `https://app.musashi.ai` (match `MUSASHI_APP_URL` in `wrangler.toml`).
3. **Sync** — `pnpm mobile:sync`
4. **Build** — `pnpm mobile:android` → Android Studio → signed release AAB
5. **Upload** — Play Console → Production or internal testing track

See [`mobile/README.md`](../mobile/README.md) for emulator / LAN dev URLs.

## What URL to set

| Environment | Example `server.url` |
|-------------|----------------------|
| Default Workers subdomain | `https://app.<account>.workers.dev` |
| Custom domain (recommended) | `https://app.musashi.ai` |
| Staging / preview | Your preview Workers URL |
| Local emulator (dev only) | `http://10.0.2.2:3000` with `cleartext: true` |

**Never ship cleartext HTTP to Play Store.** Revert dev settings before release builds.

## Play Store checklist

### Required before submission

- [ ] Web app live at production URL (smoke-test in Chrome on Android)
- [ ] `server.url` in `mobile/capacitor.config.json` matches live URL
- [ ] Signed release AAB built in Android Studio
- [ ] Package name: `ai.musashi.app` (matches Capacitor `appId`)
- [ ] App name: **Musashi**
- [ ] Privacy policy URL — `/privacy` on your domain
- [ ] Terms URL — `/terms` on your domain
- [ ] 512×512 store icon (generate from `public/musashi-icon.svg` or use `public/musashi-icon-512.png`)
- [ ] Feature graphic + phone screenshots (Fight Lab, marketplace, etc.)
- [ ] Short + full description
- [ ] Content rating questionnaire (sports / fitness)
- [ ] Data safety form (camera, video upload, account data — align with privacy policy)
- [x] In-app account deletion (Play policy requirement — done in code: Profile → Danger Zone; also declare the deletion URL/path in the data safety form)

### Recommended

- [ ] Internal testing track with real devices before production
- [ ] Deep link / custom URL scheme (future — not required for v1 WebView)
- [ ] In-app update notes tied to web deploys (shell rarely changes)

## PWA (browser install)

Users can also install Musashi from Chrome without the Play Store:

- `public/manifest.json` — name, icons 192/512, theme color
- Add to Home Screen from deployed URL

The Capacitor shell and PWA share the same web codebase; Play Store is optional distribution.

## Security notes

- WebView loads only your configured HTTPS origin
- Session cookies / auth tokens behave like mobile Safari/Chrome
- Rotate secrets via `wrangler secret put` — no app store resubmit needed for API key rotation
- Do not embed `.env` values in the Android project

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| White screen on launch | Wrong `server.url` or web not deployed |
| Login works on web, not app | Cookie `SameSite` / domain mismatch — ensure app URL matches auth cookie domain |
| Camera denied | Grant permission in Android Settings → Apps → Musashi |
| Old UI after deploy | Web cache — bump deploy; shell caches like browser (rare) |

## Related docs

- [`IOS.md`](IOS.md) — iOS/App Store equivalent
- [`mobile/README.md`](../mobile/README.md) — step-by-step build commands
- [`SHIPPING.md`](../SHIPPING.md) — overall launch timeline
- [`docs/MARKETPLACE_LAUNCH.md`](MARKETPLACE_LAUNCH.md) — production env vars
- [`docs/PHASE1_INFRASTRUCTURE.md`](PHASE1_INFRASTRUCTURE.md) — Cloudflare deploy + custom domain
