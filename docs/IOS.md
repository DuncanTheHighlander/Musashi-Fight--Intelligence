# iOS distribution (Capacitor WebView)

Musashi ships to the App Store as a **Capacitor WebView shell** that loads the production web app — same architecture as Android (see [`ANDROID.md`](ANDROID.md)).

**Gap spec:** [`docs/superpowers/specs/2026-07-09-mobile-store-gaps.md`](./superpowers/specs/2026-07-09-mobile-store-gaps.md)  
**App Privacy answers:** [`docs/STORE_DATA_SAFETY.md`](./STORE_DATA_SAFETY.md) · **Device QA:** [`docs/MOBILE_STORE_QA.md`](./MOBILE_STORE_QA.md)  
**Release gate:** `pnpm check:mobile-release` (also runs before `pnpm mobile:ios`)

## What is already done (works from Windows)

- `mobile/ios/` Xcode project scaffolded (`npx cap add ios`, Capacitor 8 + Swift Package Manager — no CocoaPods)
- `Info.plist` camera / microphone / photo-library usage descriptions (required for live pose tracking and video upload)
- App icons + splash screens generated into `Assets.xcassets` from `mobile/resources/`
- Splash screen + status bar plugins synced
- **In-app account deletion** (Apple 5.1.1(v)): Profile → Danger Zone, `DELETE /api/auth/account` with password confirmation, escrow guard, Stripe cancel
- **IAP compliance (3.1.1)**: subscription purchase/portal UI is hidden inside the iOS shell (`src/lib/nativePlatform.ts` detects the Capacitor bridge); marketplace coach payments unaffected

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
- **Implemented (option 2, Netflix-style):** the pricing page hides the Stripe purchase and billing-portal buttons inside the iOS shell and shows a neutral "not available for purchase in this app" notice, with no link out to external checkout. Users subscribe on the web; Pro entitlements apply everywhere since auth is shared.
- `wrangler.toml` also provisions RevenueCat secrets (`SECRET_REVCAT1/2`) if you later want native IAP purchases (higher conversion, Apple's cut) instead of the hidden-purchase approach.

### 3. Camera in WKWebView

`getUserMedia` works in WKWebView on iOS 14.3+. Usage descriptions are already in `Info.plist`. Test live mode on a real device early — simulators have no camera.

## App Store checklist

- [ ] Web app live at production URL; `server.url` set in `mobile/capacitor.config.json`
- [ ] `pnpm check:mobile-release` green
- [ ] Apple Developer account + App Store Connect app created (bundle ID `ai.musashi.app`)
- [ ] Signed archive uploaded via Xcode
- [x] IAP compliance — purchase UI hidden in the iOS shell (done in code)
- [x] In-app account deletion (done in code — Profile → Danger Zone)
- [ ] Privacy policy URL (`/privacy`) + terms (`/terms`)
- [ ] App Privacy questionnaire — fill from [`STORE_DATA_SAFETY.md`](./STORE_DATA_SAFETY.md)
- [ ] Screenshots: 6.7" and 6.5" iPhone required; iPad if you keep iPad support (v1: prefer iPhone-only)
- [ ] TestFlight internal test on a real device — [`MOBILE_STORE_QA.md`](./MOBILE_STORE_QA.md)
- [ ] Review notes explaining live pose tracking (helps with 4.2) — paste from STORE_DATA_SAFETY.md

### Suggested App Review notes (Guideline 4.2)

Paste into App Store Connect → App Review Information → Notes (edit host if needed):

> Musashi provides interactive live camera pose tracking (on-device MediaPipe), client-side video trimming for free (10s) / Pro (30s) clip limits, AI coaching analysis, and a coaching quality feedback loop (thumbs up/down for admin review). The iOS app is a Capacitor shell over our production web app so auth and entitlements stay consistent across web and mobile. Please exercise: sign-in at /welcome → upload a long clip → trim → run analysis → rate coaching. Live camera pose is available from Fight Lab on a physical device.

## PWA alternative (no Mac, no store, no IAP cut)

iPhone users can install Musashi today from Safari → Share → **Add to Home Screen**. `public/manifest.json`, icons, and standalone display mode are already configured. This is the fastest path to iPhone users while the App Store build is pending.

## Related docs

- [`ANDROID.md`](ANDROID.md) — Android/Play Store equivalent
- [`mobile/README.md`](../mobile/README.md) — build commands for both platforms
