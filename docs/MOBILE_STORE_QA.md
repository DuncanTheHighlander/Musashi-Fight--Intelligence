# Mobile store QA checklist (Android + iOS)

Run before Play internal promotion and before App Store review.  
Canonical shell: `mobile/` · Gate: `pnpm check:mobile-release`  
Full gap spec: [`docs/superpowers/specs/2026-07-09-mobile-store-gaps.md`](./superpowers/specs/2026-07-09-mobile-store-gaps.md)

## Preflight

- [ ] `pnpm check:mobile-release` passes
- [ ] Web deployed; phone browser can open `server.url`
- [ ] Cold open in browser hits **`/welcome`** when logged out
- [ ] Shogun credentials available for admin thumbs-down check (`/review`)

## Matrix

| # | Case | Free | Pro | Shogun | Android | iOS |
|---|------|------|-----|--------|---------|-----|
| T1 | Cold start → sign-in (`/welcome`) | ✓ | | | ☐ | ☐ |
| T2 | Signup → onboarding → Fight Lab | ✓ | ✓ | ✓ | ☐ | ☐ |
| T3 | Upload ~45s clip as free → trimmer max **10s** → analyze | ✓ | | | ☐ | ☐ |
| T4 | Upload ~45s clip as Pro → trimmer max **30s** → analyze | | ✓ | | ☐ | ☐ |
| T5 | Coaching UI completes (no fake JSON dump) | ✓ | ✓ | ✓ | ☐ | ☐ |
| T6 | Thumbs **down** saves; shogun sees feedback on `/review` | ✓ | ✓ | verify | ☐ | ☐ |
| T7 | Live camera pose (if enabled in build) | | | | ☐ | ☐ device |
| T8 | Kill app, reopen, session still valid | ✓ | ✓ | ✓ | ☐ | ☐ |
| T9 | Pricing: Stripe Pro CTA OK on Android/web; **hidden** in iOS shell | | | | ☐ | ☐ |
| T10 | Account deletion on throwaway account | ✓ | | | ☐ | ☐ |
| T11 | Airplane mode → no white-screen crash | ✓ | | | ☐ | ☐ |

## Platform notes

### Android
- Test API 29+ and a current API 34 device if possible
- Confirm file picker for gallery video on Android 13/14
- Confirm `cleartext` was **false** for the build under test

### iOS
- Camera tests require a **physical iPhone** (simulator has no camera)
- Confirm cookie persistence after force-quit
- Confirm pricing does not deep-link to external Stripe checkout

## Sign-off

| Role | Name | Date | Build / version |
|------|------|------|-----------------|
| QA | | | |
| Eng | | | |

**Pass criterion:** All applicable ☐ checked for the platform you are submitting.
