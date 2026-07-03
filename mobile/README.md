# Musashi mobile shells (Capacitor — Android + iOS)

Native wrappers that load the **deployed Musashi web app** in a WebView. No web assets are bundled into the binaries — the apps point at your production (or staging) URL.

## Prerequisites

- Node.js 18+
- Musashi web app deployed to Cloudflare Workers (see repo root `pnpm deploy`)
- **Android:** [Android Studio](https://developer.android.com/studio) + JDK 17+ (bundled)
- **iOS:** Mac with Xcode 15+ (project is scaffolded and synced here; building requires macOS)

Store checklists: [`docs/ANDROID.md`](../docs/ANDROID.md) · [`docs/IOS.md`](../docs/IOS.md)

## One-time setup

```bash
cd mobile
npm install
npx cap add android   # only if android/ is missing
npx cap add ios       # only if ios/ is missing
```

## Before every native build

### 1. Set production URL

Edit `capacitor.config.json` and replace the placeholder:

```json
"server": {
  "url": "https://app.<your-subdomain>.workers.dev",
  "cleartext": false,
  "androidScheme": "https"
}
```

Use your live URL from `wrangler.toml` / `MUSASHI_APP_URL` (e.g. `https://app.musashi.ai` after custom domain).

**Important:** Deploy the web app first (`pnpm deploy` from repo root). The Android shell does not embed the Next.js build.

### 2. Sync native project

From repo root:

```bash
pnpm mobile:sync
```

Or from this folder:

```bash
npm run sync
```

### 3. Open the native IDE

From repo root:

```bash
pnpm mobile:android   # Android Studio
pnpm mobile:ios       # Xcode (Mac only)
```

Or from this folder: `npm run android:open` / `npm run ios:open`.

## Build release AAB (Play Store)

In Android Studio:

1. **Build → Generate Signed Bundle / APK**
2. Choose **Android App Bundle (AAB)**
3. Create or select a keystore (store securely — required for all future updates)
4. Select **release** variant
5. Upload the `.aab` from `android/app/release/` to [Google Play Console](https://play.google.com/console)

## Build release IPA (App Store)

Requires a Mac — the `ios/` project here is ready to open in Xcode (icons, splash, and camera permission strings are already in place). Full walkthrough incl. App Store review risks: [`docs/IOS.md`](../docs/IOS.md).

## Local dev against your machine (optional)

For testing against `pnpm dev` on your LAN or emulator:

```json
"server": {
  "url": "http://10.0.2.2:3000",
  "cleartext": true,
  "androidScheme": "http"
}
```

- `10.0.2.2` = host machine from Android emulator
- Physical device: use your PC's LAN IP, e.g. `http://192.168.1.x:3000`
- Revert to HTTPS production URL before store builds

Also add `android:usesCleartextTraffic="true"` is handled automatically by Capacitor when `cleartext: true`.

## Root convenience scripts

| Script | Action |
|--------|--------|
| `pnpm mobile:sync` | Sync web placeholder + plugins into `android/` + `ios/` |
| `pnpm mobile:android` | Open project in Android Studio |
| `pnpm mobile:ios` | Open project in Xcode (Mac only) |

## API keys

Secrets (Stripe, Gemini, etc.) live on **Cloudflare Workers**, not in this Android project. The WebView calls the same APIs as the browser; nothing sensitive belongs in the APK.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Blank WebView | Check `server.url`, deploy web app, run `pnpm mobile:sync` |
| SSL / cleartext errors | Use `https` + `cleartext: false` for production |
| Gradle sync fails | Open Android Studio → SDK Manager → install latest SDK + build tools |
| Wrong app ID on Play | `appId` in config is `ai.musashi.app` — must match Play Console package name |
