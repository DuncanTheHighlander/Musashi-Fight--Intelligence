# iOS distribution (Capacitor WebView)

Musashi ships to the App Store as a **Capacitor WebView shell** that loads the production web app — same architecture as Android (see [`ANDROID.md`](ANDROID.md)).

## What is already done (works from Windows)

- `mobile/ios/` Xcode project scaffolded (`npx cap add ios`, Capacitor 8 + Swift Package Manager — no CocoaPods)
- `Info.plist` camera / microphone / photo-library usage descriptions (required for live pose tracking and video upload)
- App icons + splash screens generated into `Assets.xcassets` from `mobile/resources/`
- Splash screen + status bar plugins synced

## What requires a Mac

Building, running, and submitting iOS apps requires **Xcode on macOS**. There is no workaround.

| Requirement | Notes |
|-------------|-------|
| Mac with Xcode 15+ | Or a cloud Mac (MacStadium, GitHub Actions `macos` runners, Codemagic) |
| Apple Developer Program | $99/year — needed for TestFlight and App Store |
| Deployed web app | `pnpm deploy` from repo root; set URL in `mobile/capacitor.config.json` |

## Build workflow (on the Mac)

```bash
cd mobile
npm install
npx cap sync ios
npx cap open ios        # or: pnpm mobile:ios from repo root
```

In Xcode:

1. Select the **App** target → Signing & Capabilities → set your Team
2. Bundle identifier is `ai.musashi.app` (must match your App Store Connect app)
3. Product → Archive → Distribute App → TestFlight / App Store

## App Store risks — read before submitting

### 1. Guideline 4.2 (minimum functionality)

Apple rejects apps that are "just a website in a wrapper" far more aggressively than Google. Mitigations, roughly in order of value:

- Camera-based live pose tracking is a genuinely app-like capability — demo it in the review notes
- Add push notifications (`@capacitor/push-notifications`) before or shortly after v1
- Keep the splash/status-bar native feel (already configured)
- If rejected, the fallback is the **PWA** — installable from Safari with no store review

### 2. Guideline 3.1.1 (in-app purchase)

- **AI subscription tiers are digital content** — on iOS they must be sold through Apple IAP (Apple takes ~15–30%). You cannot show Stripe checkout for them inside the iOS app.
- **Marketplace coach services are person-to-person real-world services** — these may use Stripe (Guideline 3.1.5(e) territory, like fiverr/Uber).
- `wrangler.toml` already provisions RevenueCat secrets (`SECRET_REVCAT1/2`) for this. The web app does **not** yet integrate RevenueCat — before iOS launch you must either:
  1. Integrate RevenueCat IAP for subscription purchases when running inside the iOS shell, or
  2. Hide all subscription purchase UI when the iOS app is detected (Netflix-style), letting users subscribe on the web separately — allowed as long as the app never links out to external purchase.

Detect the shell via Capacitor: `window.Capacitor?.getPlatform() === 'ios'`.

### 3. Camera in WKWebView

`getUserMedia` works in WKWebView on iOS 14.3+. Usage descriptions are already in `Info.plist`. Test live mode on a real device early — simulators have no camera.

## App Store checklist

- [ ] Web app live at production URL; `server.url` set in `mobile/capacitor.config.json`
- [ ] Apple Developer account + App Store Connect app created (bundle ID `ai.musashi.app`)
- [ ] Signed archive uploaded via Xcode
- [ ] IAP decision made (RevenueCat integration or hidden purchase UI) — **blocking for review**
- [ ] Privacy policy URL (`/privacy`) + terms (`/terms`)
- [ ] App Privacy questionnaire (camera, video uploads, account data)
- [ ] Screenshots: 6.7" and 6.5" iPhone required; iPad if you keep iPad support
- [ ] TestFlight internal test on a real device (camera + upload + checkout flows)
- [ ] Review notes explaining live pose tracking (helps with 4.2)

## PWA alternative (no Mac, no store, no IAP cut)

iPhone users can install Musashi today from Safari → Share → **Add to Home Screen**. `public/manifest.json`, icons, and standalone display mode are already configured. This is the fastest path to iPhone users while the App Store build is pending.

## Related docs

- [`ANDROID.md`](ANDROID.md) — Android/Play Store equivalent
- [`mobile/README.md`](../mobile/README.md) — build commands for both platforms
