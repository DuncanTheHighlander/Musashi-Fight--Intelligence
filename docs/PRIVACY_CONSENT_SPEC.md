# Spec — Data-Use Consent, Privacy Disclosure & Store Readiness

Status: **DRAFT / planning** · Owner: Duncan · Not legal advice — this scopes the
work so a lawyer review is fast and cheap.

## 1. Goal

Let Musashi truthfully and safely tell users *"your footage and its analysis may
be used to improve our AI coaching,"* capture real consent for it, and disclose
the data flows the app already performs — enough to pass a lawyer review and the
Apple/Google data forms.

## 2. Current state (verified in code)

- `/privacy` and `/terms` pages exist. Privacy §2 says data is used to
  "provide and improve the Service" (vague), §3 says Cloudflare storage +
  "encrypted in transit", §6 covers deletion.
- In-app account + data deletion exists (Profile → Danger Zone).
- Onboarding (`/onboarding`) collects a path (train/coach/both) + profile. **No
  data-use consent step today.**
- The app uploads user **video to Google Gemini** (Files API) for analysis and
  may call Modal (pose) — **neither is named in the privacy policy.**
- No stored record of consent (no column/table).

## 3. Gap analysis

| # | Gap | Severity | Blocks |
|---|-----|----------|--------|
| G1 | Privacy policy never names Google/Gemini (video sent to a third-party AI processor) | High | Web + stores |
| G2 | No explicit "we use your footage to improve/train AI" clause | High | The disclaimer claim |
| G3 | No onboarding consent + no stored consent record | High | The disclaimer claim |
| G4 | Gemini tier (paid vs free) unconfirmed — determines if Google trains on the data | High | Truthfulness of claim |
| G5 | Apple Privacy Label + Google Data Safety forms not completed | High | Store submission |
| G6 | No user-facing report/block for shared UGC (clips in marketplace/messages) | Medium | Store submission |
| G7 | Biometric/third-party-likeness exposure (pose data; opponents in footage never consented) | High (legal) | Lawyer sign-off |
| G8 | Privacy §3 says "encrypted in transit" only (R2/D1 are also encrypted at rest) | Low | — |

## 4. Requirements & design

### R1 — Strengthen the privacy policy (`src/app/privacy/page.tsx`)
Add/edit these sections (draft language — **lawyer must review**):

- **§2 (How We Use Your Information)** add:
  > "We may use your uploaded footage and the pose, technique, and analysis data
  > derived from it to develop, evaluate, and improve Musashi's AI coaching
  > models. Where required by law we will obtain your consent, which you can
  > withdraw at any time by contacting us or deleting your content."

- **New §: Third-Party AI & Sub-processors** —
  > "To analyze your footage we send it to Google's Gemini API. Google processes
  > this content to return analysis to us and, on our paid API tier, does not use
  > it to train Google's own models. We also use [Modal] for pose processing,
  > [Cloudflare] for hosting, and [Stripe] for payments. A current list of
  > sub-processors is available on request."

- **§3** change "encrypted in transit" → "encrypted in transit and at rest."

- **Biometric acknowledgment** (if lawyer confirms applicability) — a short
  clause on pose/skeletal data and the legal basis (consent).

- Add a visible **"Last updated"** bump + a **policy version constant** (see R3).

### R2 — Onboarding consent step (`src/app/(app)/onboarding/page.tsx`)
- Add a consent gate as the **first** onboarding step (before path pick) OR a
  required checkbox on the existing first screen:
  - Checkbox (unchecked by default): *"I agree that my footage and its analysis
    may be used to improve Musashi's AI coaching."* + link to `/privacy`.
  - A second, separate line for the ToS acceptance if not already captured.
- Cannot proceed until checked. Record on submit (R3).
- **Design decision needed:** is AI-improvement use *opt-in* (separate, can
  decline and still use the app) or *a condition of use*? Opt-in is safer for
  biometric/GDPR; condition-of-use is simpler. **Recommend opt-in with a
  sensible default of "on," clearly toggleable in Profile later.**

### R3 — Consent record (new migration `0029_user_consent.sql`)
- Add to `musashi_users` (or a `musashi_user_consents` table for history):
  - `consent_ai_training INTEGER DEFAULT 0`
  - `consent_tos_version TEXT`, `consent_privacy_version TEXT`
  - `consent_at TEXT` (ISO timestamp)
- A `POLICY_VERSION` constant in code; when it changes, re-prompt users.
- Endpoint: `POST /api/auth/consent { aiTraining, policyVersion }` (auth'd),
  writes the record. Onboarding calls it.
- Profile page: a toggle to view/withdraw AI-improvement consent (writes same).

### R4 — Store data-disclosure content (doc, not code)
Prepare the exact answers for submission:
- **Apple Privacy Nutrition Label** — declare: User Content (video/photos),
  Contact Info (email, name), Identifiers, Usage Data, Purchases. Linked to
  identity: yes. Used for tracking: no (assuming no cross-app tracking).
- **Google Play Data Safety** — collected: video/user content, email, app
  activity; shared with Google (Gemini) for processing; encrypted in transit:
  yes; deletion available: yes (in-app + request).

### R5 — UGC report/block (for stores; verify what exists first)
- If not present: add "Report" + "Block user" to messages and to any shared
  clip surface, a `musashi_reports` table, and route reports to the shogun
  admin queue. Scope in a separate spec if the audit shows it's missing.

### R6 — Confirm Gemini paid tier (ops, not code)
- Verify billing is enabled on the Gemini key so Google does not train on user
  data; record the answer in this doc. (Earlier evidence: Pro models return 200,
  which implies paid tier — confirm explicitly.)

## 5. Data-flow map (for the policy + store forms)

```
User video ──► Musashi (Cloudflare Worker)
                 ├─► Cloudflare R2 (stored, encrypted at rest)
                 ├─► Cloudflare D1 (analysis/ledger metadata)
                 ├─► Google Gemini API (analysis)   ← THIRD PARTY, must disclose
                 └─► Modal (pose, if enabled)        ← THIRD PARTY, must disclose
Payments ──► Stripe (marketplace + Pro)              ← disclosed
```

## 6. Legal review checklist (hand to counsel)
- Biometric law (Illinois BIPA, Texas CUBI, GDPR Art. 9) — does pose/skeletal
  data from video count, and is consent the right lawful basis?
- Third parties in footage (opponents/sparring partners) who did not consent —
  liability of using their likeness to "improve AI."
- Minors — is there an age gate? Fighters under 18 change the consent rules.
- GDPR/CCPA lawful basis + withdrawal mechanics.
- Data-retention periods for training data vs. account data.

## 7. Phasing
- **Phase A (web launch):** R1 (policy) + R2 (onboarding consent) + R3 (record) +
  R6 (confirm tier). Small, mostly copy + one migration + one endpoint.
- **Phase B (store submission):** R4 (forms) + R5 (report/block) + lawyer
  sign-off (§6) + IAP billing (separate — see mobile spec).

## 8. Acceptance criteria
- New user cannot finish onboarding without an explicit consent decision, and
  the decision (+ policy version + timestamp) is persisted.
- Privacy policy names Google/Gemini + all sub-processors and the AI-improvement
  use; "encrypted in transit and at rest."
- Profile lets a user view and withdraw AI-improvement consent.
- A documented answer sheet exists for the Apple + Google data forms.
- Lawyer has signed off on §6 items.

## 9. Out of scope
- Actually building a training pipeline on user data (this spec is about the
  right to, and disclosure of, such use — not the ML work).
- Full DSAR/export tooling (email-based handling is acceptable for launch).
