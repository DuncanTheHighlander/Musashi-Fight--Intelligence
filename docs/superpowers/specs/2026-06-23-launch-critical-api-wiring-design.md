# Launch-Critical API Wiring Design

## Goal

Wire the remaining production APIs needed for Musashi's marketplace and account launch: Stripe Connect money movement, Cloudflare R2 asset uploads, and email-backed account verification/reset flows.

## Current State

Musashi already has a broad Next.js API surface:

- Fight analysis, burst analysis, strategy, kinematics, ledgers, cloud pose proxy, and health routes.
- Auth routes for register, login, logout, and current user.
- Billing Checkout and Stripe webhook routes for subscriptions.
- Marketplace jobs, claims, submissions, approvals, disputes, reviews, coach ranks, and ledger rows.
- A Stripe Checkout scaffold for marketplace job funding. In `MUSASHI_MARKETPLACE_PAYMENTS=stripe` mode, `/api/social/jobs/[id]/fund` creates a hosted Checkout Session and `/api/billing/webhook` completes funding from `checkout.session.completed`.

The launch blockers are narrower than a full backend rebuild:

- Marketplace funding can complete through Checkout, but release, refund, split, and payout rows are still ledger-only.
- Analyst profiles already have nullable Stripe Connect columns, but no onboarding API updates them.
- Marketplace jobs, deliverables, and dispute evidence still accept pasted URLs instead of first-party uploaded assets.
- Email env scaffolding exists, but auth has no email verification or password reset flow.

## Approach

Use first-class Musashi APIs instead of the generic `/api/external/...` proxy for launch-critical flows. Payments, uploads, and account recovery need app-aware authorization, ownership checks, idempotency keys, audit rows, and provider-specific reconciliation. The generic proxy can remain for low-risk experiments, but it should not become the path for escrow, payout, upload ownership, or password reset.

## Stripe Connect And Marketplace Money

Keep hosted Stripe Checkout for fighter funding because it is already wired and is the right low-PCI surface for one-time bounty payments. Add Connect APIs for analyst payout onboarding and platform-controlled release/refund operations.

New server modules:

- `src/lib/stripe/stripeClient.ts`
  - Shared Stripe REST wrapper with `STRIPE_SECRET_KEY`, API version headers, sanitized errors, and idempotency support.
- `src/lib/marketplace/connect.ts`
  - Creates or reuses an analyst connected account.
  - Creates onboarding links.
  - Refreshes payout capability state.
- `src/lib/marketplace/moneyMovement.ts`
  - Reads marketplace ledger rows and calls Stripe transfers or refunds.
  - Marks ledger rows succeeded or failed with provider IDs.
  - Uses existing idempotency keys such as `job_<id>_payout`, `job_<id>_refund`, and split variants.

New or changed APIs:

- `POST /api/social/analyst/connect/onboard`
  - Requires logged-in user.
  - Ensures analyst profile exists.
  - Creates a Stripe connected account if missing.
  - Returns an onboarding URL.
- `POST /api/social/analyst/connect/refresh`
  - Requires logged-in user.
  - Fetches connected account/capability state.
  - Updates `stripe_payouts_enabled` and `stripe_onboarding_completed_at`.
- `PATCH /api/social/analyst/profile`
  - Continue allowing normal profile edits.
  - Require `stripe_payouts_enabled=1` before enabling `directHireEnabled`.
- `POST /api/social/jobs/[id]/approve`
  - Existing approve/release sequence remains.
  - After ledger release rows are created, call real transfer when marketplace payments are in Stripe mode.
- `POST /api/social/jobs/[id]/cancel`
  - Existing cancel/refund ledger behavior remains.
  - After refund row is created, call real Stripe refund when Stripe mode is active.
- `POST /api/social/disputes/[id]/resolve`
  - Existing refund/release/split ledger behavior remains.
  - Execute the matching Stripe refund/transfer calls after the ledger rows exist.
- `POST /api/billing/webhook`
  - Keep current subscription and marketplace Checkout handling.
  - Handle `account.updated` for connected accounts already stored on analyst profiles.
  - The refresh endpoint remains the primary user-triggered source of payout readiness.

Stripe behavior:

- Funding remains a platform Checkout payment.
- Release creates a Connect transfer to the analyst connected account for the analyst payout amount.
- Refunds use the original PaymentIntent/charge captured in the HOLD ledger row.
- Split resolutions perform partial refund plus analyst transfer.
- Platform fee rows remain internal accounting unless later tax/accounting requirements need separate provider actions.
- Stripe requests use the latest supported API version from the Stripe guidance read for this work: `2026-02-25.clover`.

Failure behavior:

- Ledger rows are written before provider calls.
- Provider calls are idempotent.
- Success writes `stripe_transfer_id` or `stripe_refund_id` and `status='succeeded'`.
- Failure writes `status='failed'` and `failure_reason`, while job state remains auditable. Admin can retry failed money movements from a follow-up reconciliation endpoint or CLI script.

## R2 Upload Assets

Add owned asset records and upload APIs so first-party files replace pasted URLs for job videos, analyst deliverables, and dispute evidence.

New migration:

- `marketplace_assets`
  - `id`
  - `owner_user_id`
  - `job_id`
  - `dispute_id`
  - `purpose`: `job_video`, `deliverable`, `dispute_evidence`, `profile_media`
  - `bucket`
  - `object_key`
  - `original_name`
  - `content_type`
  - `size_bytes`
  - `sha256`
  - `status`: `pending_upload`, `uploaded`, `failed`, `deleted`
  - `created_at`, `uploaded_at`, `updated_at`

New server module:

- `src/lib/storage/r2.ts`
  - Creates signed upload URLs using S3-compatible R2 request signing from `STORAGE_SERVICE_URL`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, and `STORAGE_BUCKET_NAME`.
  - Creates signed read URLs for uploaded private assets.
  - Validates content type and maximum size by purpose.

New APIs:

- `POST /api/uploads`
  - Requires logged-in user.
  - Body includes purpose, filename, content type, size, and optional job/dispute ID.
  - Checks ownership or participant access for linked job/dispute.
  - Creates `marketplace_assets` row with `pending_upload`.
  - Returns upload URL, method, headers, asset ID, and public/signed read hint.
- `POST /api/uploads/[id]/complete`
  - Requires owner or allowed participant.
  - Marks asset uploaded after client upload completes.
  - Stores final size/hash if supplied.
- `GET /api/uploads/[id]`
  - Requires owner or linked participant.
  - Returns metadata and a signed read URL when the asset is private.

Changed marketplace APIs:

- `POST /api/social/jobs`
  - Accept `assetIds` in addition to legacy `videos`.
  - Persist asset IDs or URLs in the existing `videos` JSON during the compatibility phase.
- `POST /api/social/jobs/[id]/submit`
  - Accept `deliverableAssetId` as preferred input.
  - Keep `deliverableUrl` as a compatibility fallback.
- `POST /api/social/disputes/[id]/evidence`
  - Accept `evidenceAssetIds` as preferred input.
  - Keep `evidenceUrls` as a compatibility fallback.

Failure behavior:

- If R2 env is missing in development, the API returns a clear `501 Storage not configured` response.
- Existing pasted URL flows remain available during the rollout so local testing and old data do not break.
- Production checks should fail if storage is required but R2 env is missing.

## Email Verification And Password Reset

Add token-backed account email flows through a dedicated mail module. Use Resend-style API shape by default because existing env names point there, but keep the provider isolated.

New migration:

- `auth_email_tokens`
  - `id`
  - `user_id`
  - `email`
  - `purpose`: `verify_email`, `password_reset`
  - `token_hash`
  - `expires_at`
  - `used_at`
  - `created_at`

Required user table changes:

- `email_verified_at`
- `password_updated_at`

New server modules:

- `src/lib/email/emailClient.ts`
  - Sends verification and reset emails.
  - Supports `EMAIL_DRY_RUN=1` or development fallback that returns the URL in the API response without sending.
- `src/lib/auth/emailTokens.ts`
  - Creates cryptographically random tokens.
  - Stores only token hashes.
  - Consumes tokens once.
  - Enforces expiry and purpose.

New APIs:

- `POST /api/auth/email/verify/send`
  - Requires logged-in user.
  - Creates a verification token for the user's email.
  - Sends verification email or dry-run URL.
- `POST /api/auth/email/verify/confirm`
  - Body includes token.
  - Marks the user's email verified and consumes token.
- `POST /api/auth/password/reset/request`
  - Body includes email.
  - Always returns a neutral success response to avoid account enumeration.
  - Sends reset link if the user exists.
- `POST /api/auth/password/reset/confirm`
  - Body includes token and new password.
  - Validates password policy, updates password hash, consumes token, and updates `password_updated_at`.
  - Session validation rejects sessions created before `password_updated_at`.

Changed auth behavior:

- Registration can still create an account immediately.
- Production requires verified email before analyst Connect onboarding, marketplace funding, marketplace upload tickets, job approval/release, and password reset completion.
- Local development can use dry-run links to avoid requiring an email provider.

Failure behavior:

- Mail provider errors produce sanitized messages.
- Password reset request remains neutral even when the email is unknown.
- Tokens are single-use and stored hashed.

## Env And Configuration

Required production env for this package:

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `MUSASHI_MARKETPLACE_PAYMENTS=stripe`
- `STORAGE_SERVICE_URL`
- `STORAGE_ACCESS_KEY`
- `STORAGE_SECRET_KEY`
- `STORAGE_BUCKET_NAME`
- `EMAIL_SERVICE_URL`
- `EMAIL_API_KEY`
- `EMAIL_FROM_ADDRESS`
- `MUSASHI_APP_URL`

Development toggles:

- `MUSASHI_MARKETPLACE_PAYMENTS=mock` keeps ledger-only money behavior.
- `EMAIL_DRY_RUN=1` returns verification/reset links without sending email.
- Existing pasted URL fallbacks keep upload-dependent forms usable before R2 is configured.

## Testing Strategy

Unit tests:

- Stripe client request shaping, idempotency headers, and sanitized errors.
- Connect onboarding/account refresh state mapping.
- Marketplace money movement from ledger rows to transfer/refund requests.
- R2 upload ticket validation, ownership checks, and missing-env behavior.
- Email token creation, hashing, expiry, single-use consumption, and neutral reset request behavior.

Route tests:

- Analyst onboarding requires auth and returns an onboarding URL.
- Direct hire cannot be enabled until payouts are enabled.
- Approve/cancel/dispute resolution call real money movement in Stripe mode and remain ledger-only in mock mode.
- Upload creation rejects unauthorized job/dispute links and accepts participant-owned links.
- Password reset request does not reveal whether an email exists.

Integration smoke checks:

- Existing marketplace job tests continue passing.
- `pnpm test:loop` remains the pre-ship local gate.
- Production env checker reports missing Stripe/R2/email launch-critical settings.

## Rollout

1. Add migrations and low-level clients with tests.
2. Add Stripe Connect onboarding and payout readiness gating.
3. Add R2 upload assets and compatibility inputs to marketplace APIs.
4. Add email verification and password reset.
5. Wire UI calls for onboarding/upload/reset after the backend APIs are stable.
6. Run marketplace route tests, env checks, and the existing QA loop.

## Non-Goals

- Replacing hosted Stripe Checkout with custom card collection.
- Reworking the entire auth/session model.
- Removing legacy pasted URL support immediately.
- Moving client-side MediaPipe pose tracking to cloud.
- Implementing Twilio, Google Maps, or OpenAI provider switching in this package.
