# Auth-first entry + free trial + trimmer

Date: 2026-07-09  
Status: approved for implementation (Option A)

## Objective

Make the first screen of Musashi **Sign in / Create account**. New users complete onboarding before Fight Lab. Free accounts need **no credit card** and get **2 lifetime AI clip analyses** (10s max). Longer uploads open the existing **VideoTrimmer**.

## Decisions

| Topic | Choice |
|-------|--------|
| Card at signup | **No** (Option A) |
| Free lifetime analyses | **2** (was 3) |
| Free max duration | **10s** |
| Pro max duration | **30s** |
| Over-limit upload | **VideoTrimmer** (user picks window; not auto first-N-seconds) |
| Logged-out `/` | Redirect to `/welcome` |
| Incomplete onboarding | Redirect to `/onboarding` |

## Routing

1. Logged out → any protected page (including `/`) → `/welcome` (optional `?redirect=`).
2. Logged in, onboarding incomplete → `/onboarding` (except `/onboarding` itself and auth recovery pages).
3. Logged in, onboarded → `/welcome` / `/login` / `/signup` → `/`.
4. Public: `/welcome`, `/login`, `/signup`, password/email recovery, `/terms`, `/privacy`, health, billing webhook, auth APIs.

## Trial / billing

- Free: 2 lifetime AI video analyses, 10s, 3 questions/clip, no card.
- Exhausted free quota → block analyze with upgrade CTA to `/pricing`.
- Pro: Stripe checkout; 10/week, 30s.

## Trimmer

Keep `VideoTrimmer` on home upload: if `duration > maxSec` for tier, require trim before Fight Lab. Server still enforces duration + quota.

## Out of scope

Email-verify hard gate, Fight Lab redesign, iOS IAP changes, Pro price changes.
