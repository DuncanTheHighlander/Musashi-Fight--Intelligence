# Musashi Android shell (Capacitor)

Native Android wrapper that loads the **deployed Musashi web app** in a WebView. No web assets are bundled into the APK — the app points at your production (or staging) URL.

## Prerequisites

- Node.js 18+
- [Android Studio](https://developer.android.com/studio) (includes Android SDK)
- JDK 17+ (bundled with recent Android Studio)
- Musashi web app deployed to Cloudflare Workers (see repo root `pnpm deploy`)

Full Play Store checklist: [`docs/ANDROID.md`](../docs/ANDROID.md).

## One-time setup

```bash
cd mobile
npm install
npx cap add android   # only if android/ is missing
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

### 3. Open Android Studio

From repo root:

```bash
pnpm mobile:android
```

Or:

```bash
npm run android:open
```

## Build release AAB (Play Store)

In Android Studio:

1. **Build → Generate Signed Bundle / APK**
2. Choose **Android App Bundle (AAB)**
3. Create or select a keystore (store securely — required for all future updates)
4. Select **release** variant
5. Upload the `.aab` from `android/app/release/` to [Google Play Console](https://play.google.com/console)

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
| `pnpm mobile:sync` | Sync web placeholder + plugins into `android/` |
| `pnpm mobile:android` | Open project in Android Studio |

## API keys

Secrets (Stripe, Gemini, etc.) live on **Cloudflare Workers**, not in this Android project. The WebView calls the same APIs as the browser; nothing sensitive belongs in the APK.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Blank WebView | Check `server.url`, deploy web app, run `pnpm mobile:sync` |
| SSL / cleartext errors | Use `https` + `cleartext: false` for production |
| Gradle sync fails | Open Android Studio → SDK Manager → install latest SDK + build tools |
| Wrong app ID on Play | `appId` in config is `ai.musashi.app` — must match Play Console package name |
