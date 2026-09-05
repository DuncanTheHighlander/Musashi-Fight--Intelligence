# Musashi mobile shells (Capacitor — Android + iOS)

Native wrappers that load the **deployed Musashi web app** in a WebView. No web assets are bundled into the binaries — the apps point at your production (or staging) URL.

**Package / bundle ID:** `ai.musashi.app` (must match Play Console + App Store Connect)

## Docs

| Doc | Purpose |
|-----|---------|
| [`docs/ANDROID.md`](../docs/ANDROID.md) | Play Store workflow |
| [`docs/IOS.md`](../docs/IOS.md) | App Store / TestFlight + 4.2 notes |
| [`docs/STORE_DATA_SAFETY.md`](../docs/STORE_DATA_SAFETY.md) | Data safety / App Privacy answers |
| [`docs/MOBILE_STORE_QA.md`](../docs/MOBILE_STORE_QA.md) | Device QA matrix (trimmer, thumbs-down, welcome) |
| [`docs/superpowers/specs/2026-07-09-mobile-store-gaps.md`](../docs/superpowers/specs/2026-07-09-mobile-store-gaps.md) | Full gap inventory |

## Prerequisites

- Node.js 18+
- Musashi web app deployed to Cloudflare Workers (see repo root `pnpm deploy`)
- **Android:** [Android Studio](https://developer.android.com/studio) + JDK 17+ (bundled)
- **iOS:** Mac with Xcode 15+ (project is scaffolded here; building requires macOS)

## Release gate (required)

From repo root, before every store-bound sync/open:

```bash
pnpm check:mobile-release
```

This fails if:

- `appId` ≠ `ai.musashi.app`
- `server.url` is missing, `http://`, localhost, or a `YOUR_` placeholder
- `server.cleartext` is `true` (use `--allow-dev-cleartext` only for LAN testing)
- Android `allowBackup="true"`
- iOS camera/mic/photo usage strings missing

`pnpm mobile:sync`, `pnpm mobile:android`, and `pnpm mobile:ios` run this gate automatically.

## One-time setup

```bash
cd mobile
npm install
npx cap add android   # only if android/ is missing
npx cap add ios       # only if ios/ is missing
```

## Before every native build

### 1. Set production URL

Edit `capacitor.config.json`:

```json
"server": {
  "url": "https://YOUR_FINAL_HOST",
  "cleartext": false,
  "androidScheme": "https"
}
```

`YOUR_FINAL_HOST` must match `MUSASHI_APP_URL` and the host used for `/privacy` + `/terms` in the store consoles.

**Important:** Deploy the web app first (`pnpm deploy` from repo root). The shell does not embed the Next.js build.

### 2. Sync native project

```bash
pnpm mobile:sync
```

### 3. Open the native IDE

```bash
pnpm mobile:android   # Android Studio
pnpm mobile:ios       # Xcode (Mac only)
```

## Build release AAB (Play Store)

In Android Studio:

1. **Build → Generate Signed Bundle / APK**
2. Choose **Android App Bundle (AAB)**
3. Create or select a keystore (store securely — required for all future updates)
4. Select **release** variant
5. Upload the `.aab` to [Google Play Console](https://play.google.com/console)
6. Fill Data safety from [`STORE_DATA_SAFETY.md`](../docs/STORE_DATA_SAFETY.md)
7. Run [`MOBILE_STORE_QA.md`](../docs/MOBILE_STORE_QA.md) on internal track devices

## Build release IPA (App Store)

Requires a Mac — see [`docs/IOS.md`](../docs/IOS.md) for TestFlight, 4.2 review notes, and IAP (Netflix-style) rules.

## Local dev against your machine (optional)

```json
"server": {
  "url": "http://10.0.2.2:3000",
  "cleartext": true,
  "androidScheme": "http"
}
```

Then: `node ../scripts/check-mobile-release.mjs --allow-dev-cleartext` before syncing manually.

- `10.0.2.2` = host machine from Android emulator
- Physical device: use your PC's LAN IP
- **Revert to HTTPS production URL before store builds**

## Product flows already on the web (shell inherits them)

- First screen when logged out: **`/welcome`** (sign-in / sign-up)
- Clip trimmer: Free **10s** / Pro **30s**
- Thumbs up/down on coaching → admin **`/review`** (shogun)

## API keys

Secrets (Stripe, Gemini, etc.) live on **Cloudflare Workers**, not in this project. Nothing sensitive belongs in the APK/IPA.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `check:mobile-release` fails | Fix `capacitor.config.json` / manifest; see error text |
| Blank WebView | Check `server.url`, deploy web app, run `pnpm mobile:sync` |
| Login works on web, not app | Cookie domain must match `server.url` host |
| Wrong app ID on Play | Must be `ai.musashi.app` |
| Camera denied | OS Settings → Musashi → Camera |
