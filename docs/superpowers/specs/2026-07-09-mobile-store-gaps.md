# Spec — Everything Missing for iOS & Android Store Deployment

**Status:** ACTIVE (engineering + ops checklist)  
**Date:** 2026-07-09  
**Canonical repo:** this tree (`mobile/`, `docs/ANDROID.md`, `docs/IOS.md`)  
**Do not use:** any sibling `download_package/mobile` copy with `com.musashi.fightcoach` or placeholder `YOUR_PRODUCTION_URL`

**Related:** [`docs/ANDROID.md`](../../ANDROID.md) · [`docs/IOS.md`](../../IOS.md) · [`docs/STORE_DATA_SAFETY.md`](../../STORE_DATA_SAFETY.md) · [`docs/MOBILE_STORE_QA.md`](../../MOBILE_STORE_QA.md) · [`SHIPPING.md`](../../../SHIPPING.md) · [`docs/PRIVACY_CONSENT_SPEC.md`](../../PRIVACY_CONSENT_SPEC.md) · [`DEPLOYMENT.md`](../../../DEPLOYMENT.md)

**Release gate:** `pnpm check:mobile-release` (fails on cleartext / placeholder URL / wrong appId / allowBackup=true)

---

## 0. Scope & non-goals

### In scope
Ship Musashi to **Google Play** and **Apple App Store** as Capacitor WebView shells loading the production Cloudflare web app, plus store-blocking web/legal/security gaps.

### Explicitly out of scope (already done — do not rebuild)

| Feature | Status | Evidence |
|---------|--------|----------|
| Auth-first entry (`/welcome`) | Done | Middleware redirects unauthenticated users to `/welcome` |
| Video trimmer Free 10s / Pro 30s | Done | `VideoTrimmer` + `FREE_MAX_VIDEO_SEC` / `PRO_MAX_VIDEO_SEC` |
| Thumbs up/down → admin tracking | Done | `POST /api/fight/coaching-feedback` → `/review` (shogun) |
| Capacitor Android + iOS scaffolds | Done | `mobile/android`, `mobile/ios`, `appId: ai.musashi.app` |
| iOS IAP hide for Stripe Pro | Done | `isIosNativeApp()` on pricing page |
| In-app account deletion | Done | Profile → Danger Zone |
| Camera/mic/photo usage strings (iOS) | Done | `Info.plist` |
| Camera/mic permissions (Android) | Done | `AndroidManifest.xml` |
| Android `allowBackup=false` | Done (this work) | Release hardening |

### Architecture constraint

```
[Play/App Store binary]  --HTTPS WebView-->  [Cloudflare Workers web app]
         │                                         │
    no API keys                              Gemini / Stripe / D1 / R2
```

---

## 1. Current verified state

### Product (web)
- Unauthenticated `/` → redirect `/welcome?redirect=…`
- Public paths: `/welcome`, auth recovery, `/terms`, `/privacy`, health, billing webhook, auth APIs
- Trimmer gates uploads over tier max; client re-encodes selected window
- Ratings require login + `ledgerId`; admin ledger APIs require `role: 'shogun'`

### Mobile shell (`mobile/capacitor.config.json`)
- `appId`: `ai.musashi.app`
- `server.url`: must match final prod host (currently Workers URL — freeze before store screenshots)
- Plugins: SplashScreen, StatusBar only (no Camera/Push/Filesystem native plugins — WebView APIs)

---

## 2. Gap inventory

Severity: **P0** blocks store submit · **P1** likely reject / break prod · **P2** should-fix · **P3** polish

### 2.1 Android / Google Play

| ID | Gap | Sev | Status |
|----|-----|-----|--------|
| A1 | Release signing keystore + Play App Signing | P0 | Ops — manual |
| A2 | Signed release AAB upload | P0 | Ops — manual |
| A3 | Play listing assets (icon, feature graphic, screenshots, copy) | P0 | Ops/Design |
| A4 | Data safety form | P0 | Use [`STORE_DATA_SAFETY.md`](../../STORE_DATA_SAFETY.md) |
| A5 | Content rating questionnaire | P0 | Ops |
| A6 | Privacy + Terms on final domain | P0 | Ops |
| A7 | Support contact | P1 | `support@musashi.ai` on legal pages |
| A8 | `allowBackup` | P1 | **Fixed** → `false` |
| A9 | Android 13+ media picker device QA | P1 | Manifest perms added; **device QA** still required |
| A10 | FCM / push | P2 | Post-v1 |
| A11 | Package ID drift | P0 | Gate enforces `ai.musashi.app` |
| A12 | Internal testing track | P0 | Ops/QA |
| A13 | targetSdk vs Play requirement | P1 | Verify in Android Studio each release |
| A14 | App Links | P3 | Intent-filter hosts added; assetlinks.json still ops |

### 2.2 iOS / App Store

| ID | Gap | Sev | Status |
|----|-----|-----|--------|
| I1 | Mac + Xcode for archive | P0 | Ops |
| I2 | Apple Developer + ASC app `ai.musashi.app` | P0 | Ops |
| I3 | Signing / provisioning | P0 | Ops |
| I4 | TestFlight upload | P0 | Ops |
| I5 | Guideline 4.2 review notes | P0 | Template in IOS.md |
| I6 | No native IAP (Netflix-style) | P1 | Code done — keep compliant |
| I7 | App Privacy questionnaire | P0 | Use STORE_DATA_SAFETY.md |
| I8 | Screenshots 6.7" + 6.5" | P0 | Design |
| I9 | PrivacyInfo.xcprivacy | P1 | Add if Xcode warns |
| I10 | Real-device QA | P0 | MOBILE_STORE_QA |
| I11 | Universal Links | P2 | Post-v1 |
| I12 | Push | P2 | Post-v1 |
| I13 | Export compliance answers | P1 | Ops |
| I14 | iPad strategy | P2 | Recommend iPhone-only v1 |

### 2.3 Cross-platform / web

| ID | Gap | Sev | Status |
|----|-----|-----|--------|
| W1 | Freeze FINAL_PROD_HOST | P0 | Ops |
| W2 | Cloudflare secrets complete | P0 | DEPLOYMENT.md |
| W3 | Stripe Pro price IDs | P1 | Ops |
| W4 | Email verify for AI | P2 | **Done** — `assertEmailVerified` in aiGuard; Profile resend |
| W5 | Trimmer on mid-range phones | P0 | QA |
| W6 | Cookie domain = shell origin | P0 | Ops + gate |
| W7 | Offline UX | P3 | Post-v1 |
| W8 | Stale mobile trees | P0 | Quarantine README |

### 2.4 Legal / security

| ID | Gap | Sev | Status |
|----|-----|-----|--------|
| L1 | Lawyer review privacy/terms | P0 | Ops |
| L2–L3 | Consent AI training | P1 | **Done** in onboarding + Profile |
| L4 | UGC report/block | P2 | **Done** — report API + job UI + `/admin/reports` |
| L5–L6 | Biometrics / form consistency | P1–P2 | Lawyer + STORE_DATA_SAFETY |
| S1 | cleartext / placeholder URL | P0 | **Gate** `check:mobile-release` |
| S2 | Auth bypass in prod | P0 | env validator |
| S3 | Backup | P1 | **Fixed** |
| S4–S8 | Pinning, rate limits, secrets in binary | P2–P0 | Documented; email gate done |

---

## 3. Requirements (done = measurable)

### R-ANDROID
1. `appId` / applicationId exactly `ai.musashi.app`
2. Release `server.url` HTTPS final host; `cleartext: false`
3. `pnpm check:mobile-release` exits 0 before sync/open
4. Signed AAB + Play App Signing
5. Listing + Data safety + content rating complete
6. QA T1–T11 pass on 2 physical devices ([MOBILE_STORE_QA.md](../../MOBILE_STORE_QA.md))

### R-IOS
1. Bundle ID `ai.musashi.app`
2. Mac archive → TestFlight
3. 4.2 review notes attached (template in IOS.md)
4. Stripe Pro CTA hidden in shell (already coded)
5. App Privacy + screenshots
6. QA T1–T11 on real iPhone (camera not simulator)

### R-WEB
1. `MUSASHI_APP_URL` == Capacitor `server.url` host
2. `/privacy` + `/terms` 200 on that host
3. `pnpm predeploy` green

---

## 4. Work packages

| Phase | What | Who |
|-------|------|-----|
| 0 | Spec, gate script, allowBackup, quarantine stale mobile, fact sheet, QA doc | Eng — **this PR** |
| 1 | Freeze domain, secrets, web smoke | Ops |
| 2 | Android keystore, AAB, Play internal track | Ops + QA |
| 3 | iOS ASC, TestFlight, screenshots, submit | Ops (Mac) + QA |
| 4 | Push, Universal Links, native IAP, email enforce | Eng post-v1 |

---

## 5. Decisions (defaults)

| Decision | Default for v1 |
|----------|----------------|
| Final domain | Prefer custom domain before store screenshots; Workers URL OK for internal testing |
| iPad | iPhone-only until screenshots ready |
| iOS Pro billing | Netflix-style (subscribe on web) |
| Push before iOS submit | No — add if 4.2 rejected |
| AI training consent | Follow PRIVACY_CONSENT_SPEC (opt-in preferred) |

---

## 6. Non-deliverables (v1)

Full native rewrite · on-device Gemini · offline coaching · push · Apple IAP purchase flow · cert pinning
