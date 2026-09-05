# Store data safety & App Privacy fact sheet

**Purpose:** One source of truth for Google Play **Data safety** and Apple **App Privacy** questionnaires. Keep both stores consistent.

**Last updated:** 2026-07-09  
**Support:** support@musashi.ai  
**Privacy:** `https://<FINAL_PROD_HOST>/privacy` · **Terms:** `https://<FINAL_PROD_HOST>/terms`  
**Account deletion:** In-app — Profile → Danger Zone (`DELETE /api/auth/account`)

Replace `<FINAL_PROD_HOST>` with the same host as `mobile/capacitor.config.json` → `server.url` and `MUSASHI_APP_URL`.

---

## App identity

| Field | Value |
|-------|--------|
| App name | Musashi |
| Package / Bundle ID | `ai.musashi.app` |
| Category (suggested) | Health & Fitness or Sports |
| Architecture | Capacitor WebView → Cloudflare-hosted web app |

---

## Data collected

| Data type | Collected? | Example | Purpose |
|-----------|------------|---------|---------|
| Name | Yes (optional display name) | Profile / signup | App functionality |
| Email address | Yes | Account | App functionality, account security |
| User IDs | Yes | Internal UUID | App functionality |
| User-generated content | Yes | Training / fight videos, profiles, marketplace jobs | App functionality; optional AI improvement with consent |
| Photos or videos | Yes | Uploaded clips; camera for live pose | App functionality |
| Audio | Yes if recorded with video | Mic with training video | App functionality |
| Product interaction | Yes (usage) | Features used, analysis counts | App functionality, fraud prevention |
| Crash / diagnostics | Possibly via host/platform | Cloudflare / OS | Stability (declare if you enable extra analytics) |
| Payment info | Via Stripe (not stored as raw card on Musashi servers) | Subscription / marketplace | App functionality |
| Precise location | No | — | — |
| Contacts / SMS | No | — | — |

**Biometrics / pose:** Pose landmarks and technique metrics are derived from user video for coaching. Treat as sensitive user content; disclose under photos/videos + app functionality. Lawyer should confirm biometric labeling for your jurisdictions.

---

## Data shared with third parties (sub-processors)

| Party | What | Why | User can request deletion? |
|-------|------|-----|----------------------------|
| Google Gemini API | Video / frames + prompts for coaching | Core AI analysis | Via Musashi account deletion + Google retention on paid tier (see privacy policy) |
| Cloudflare | Hosting, D1 DB, R2 object storage, Workers | Infrastructure | Yes via account deletion |
| Stripe | Billing identifiers, Connect for coaches | Payments | Via Stripe + Musashi deletion flows |
| Modal (if cloud pose enabled) | Pose-processing payloads | Optional dense pose | Same as account/content deletion |

**Not sold:** Personal data is not sold. No third-party advertising SDK in the Capacitor shell.

---

## Security practices (declare as applicable)

- Data encrypted in transit (HTTPS)
- Data encrypted at rest (Cloudflare D1/R2)
- Account authentication required for private content
- Users can request deletion in-app

---

## Google Play — Data safety mapping tips

1. **Collected** = yes for rows above marked Yes.
2. **Shared** = yes for Google, Cloudflare, Stripe, Modal as listed (service providers).
3. **Ephemeral processing:** do not mark video as “ephemeral only” if you store uploads or analysis in D1/R2.
4. **Account deletion:** declare in-app deletion + path users take (Profile → Danger Zone).
5. **Children:** Musashi is not directed at children under 13 (confirm age rating in questionnaire).

---

## Apple App Privacy mapping tips

| Apple label category | Likely declaration |
|----------------------|--------------------|
| Contact Info (Email) | Linked to user; used for App Functionality |
| Contact Info (Name) | Linked; App Functionality |
| User Content (Photos or Videos) | Linked; App Functionality; may be used for product improvement if consent on |
| Identifiers (User ID) | Linked; App Functionality |
| Usage Data | Linked; App Functionality |
| Purchases | Linked if subscriptions/marketplace; App Functionality |
| Diagnostics | Only if you add crash reporters |

**Tracking:** Do not declare “Used to Track” unless you add ATT-covered cross-app tracking. Current shell has no ads SDK.

**IAP note:** Digital Pro subscription purchase UI is hidden inside the iOS shell; users subscribe on the web. Still declare purchase-related data if accounts can hold Pro entitlements from web checkout.

---

## Content rating (both stores)

Suggested answers for a fight-coaching / sports training app:
- No gratuitous violence as entertainment product focus; sports/training context
- User-generated video may depict combat sports sparring
- No gambling, no unrestricted web browser as primary purpose

Complete each store’s questionnaire honestly; do not copy blindly if product scope changes.

---

## Review notes snippet (Apple 4.2)

> Musashi provides interactive live camera pose tracking (on-device MediaPipe), client-side video trimming for free/Pro clip limits, AI coaching analysis, and a human review loop for coaching quality (thumbs up/down). The iOS app is a Capacitor shell over our production web app so auth, billing entitlements, and coaching stay consistent across web and mobile. Core native value: camera-based live coaching and mobile upload/trim workflows.

---

## Checklist before submitting forms

- [ ] `<FINAL_PROD_HOST>` matches live deploy and Capacitor `server.url`
- [ ] Privacy + Terms URLs open on a phone browser
- [ ] Sub-processor list matches what production actually calls (disable Modal in forms if unused)
- [ ] Lawyer reviewed `/privacy` and `/terms`
- [ ] Support inbox `support@musashi.ai` monitored
