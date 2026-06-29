# Launch-Critical API Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire production-ready Stripe Connect marketplace money movement, R2 upload tickets, and email verification/password reset APIs for Musashi.

**Architecture:** Keep the existing marketplace ledger and route state machine as the source of truth. Add focused provider clients and domain services that are called by existing routes after local DB mutations succeed. Keep development safe with mock/dry-run modes and explicit 501 responses when a required provider is missing.

**Tech Stack:** Next.js route handlers, TypeScript, Vitest, Cloudflare D1-compatible SQL, Stripe REST API, Cloudflare R2 S3-compatible request signing, Resend-style email API.

---

## File Structure

- Create `migrations/0021_launch_critical_api_wiring.sql`
- Adds `marketplace_assets`, `auth_email_tokens`, user email hardening columns, and indexes.
- Create `src/lib/stripe/stripeClient.ts`
  - Shared Stripe REST helper with API version, idempotency, form encoding, and sanitized errors.
- Create `src/lib/stripe/stripeClient.test.ts`
  - Tests request shape, idempotency, and error sanitization.
- Create `src/lib/marketplace/connect.ts`
  - Creates connected accounts, onboarding links, and refreshes payout status.
- Create `src/lib/marketplace/moneyMovement.ts`
  - Executes transfers/refunds from ledger rows.
- Modify `src/lib/marketplace/ledger.ts`
  - Add transaction failure marking and transaction lookup helpers.
- Modify `src/lib/marketplace/jobs.ts`
  - Return ledger idempotency keys from release/refund operations so provider calls can reconcile them.
- Create `src/lib/marketplace/__tests__/moneyMovement.test.ts`
  - Tests transfer/refund behavior without calling Stripe.
- Create `src/lib/storage/assets.ts`
  - DB ownership and lifecycle helpers for uploaded assets.
- Create `src/lib/storage/r2.ts`
  - S3-compatible signed URL creation.
- Create `src/lib/storage/__tests__/assets.test.ts`
  - Tests validation, ownership, and missing storage config.
- Create `src/app/api/uploads/route.ts`
  - Issues upload tickets.
- Create `src/app/api/uploads/[id]/route.ts`
  - Returns metadata and signed read URLs.
- Create `src/app/api/uploads/[id]/complete/route.ts`
  - Completes uploads.
- Create `src/lib/email/emailClient.ts`
  - Sends provider emails or returns dry-run links.
- Create `src/lib/auth/emailTokens.ts`
  - Creates, hashes, and consumes single-use email tokens.
- Create `src/lib/auth/emailTokens.test.ts`
  - Tests token expiry, purpose checks, and single-use behavior.
- Modify `src/lib/musashiAuth.ts`
  - Include email verification and password update fields, session invalidation, and helpers.
- Create `src/app/api/auth/email/verify/send/route.ts`
  - Sends verification links.
- Create `src/app/api/auth/email/verify/confirm/route.ts`
  - Confirms email verification.
- Create `src/app/api/auth/password/reset/request/route.ts`
  - Requests reset links without account enumeration.
- Create `src/app/api/auth/password/reset/confirm/route.ts`
  - Resets password using token.
- Modify `src/app/api/social/analyst/profile/route.ts`
  - Gate direct hire behind Stripe payout readiness in Stripe mode.
- Create `src/app/api/social/analyst/connect/onboard/route.ts`
  - Starts Connect onboarding.
- Create `src/app/api/social/analyst/connect/refresh/route.ts`
  - Refreshes payout status.
- Modify `src/app/api/social/jobs/route.ts`
  - Accept uploaded asset IDs in compatibility with video URLs.
- Modify `src/app/api/social/jobs/[id]/submit/route.ts`
  - Accept deliverable asset IDs.
- Modify `src/app/api/social/disputes/[id]/evidence/route.ts`
  - Accept evidence asset IDs.
- Modify `src/app/api/social/jobs/[id]/approve/route.ts`
  - Execute transfer after release ledger rows in Stripe mode.
- Modify `src/app/api/social/jobs/[id]/cancel/route.ts`
  - Execute refund after refund ledger rows in Stripe mode.
- Modify `src/app/api/social/disputes/[id]/resolve/route.ts`
  - Execute refund/transfer/split money movement in Stripe mode.
- Modify `src/app/api/billing/webhook/route.ts`
  - Handle `account.updated` payout readiness updates.
- Modify `scripts/check-prod-env.mjs`
  - Report Stripe/R2/email launch-critical env gaps.
- Modify `.env.example`
  - Add `MUSASHI_APP_URL` and `EMAIL_DRY_RUN`.

---

### Task 1: Migration And Types

**Files:**
- Create: `migrations/0021_launch_critical_api_wiring.sql`
- Modify: `src/lib/marketplace/types.ts`

- [ ] **Step 1: Write the migration**

```sql
-- Migration 0021: Launch-critical API wiring

ALTER TABLE musashi_users ADD COLUMN email_verified_at TEXT;
ALTER TABLE musashi_users ADD COLUMN password_updated_at TEXT;

CREATE TABLE IF NOT EXISTS auth_email_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify_email', 'password_reset')),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES musashi_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_user
  ON auth_email_tokens(user_id, purpose, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_hash
  ON auth_email_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_auth_email_tokens_expires
  ON auth_email_tokens(expires_at, used_at);

CREATE TABLE IF NOT EXISTS marketplace_assets (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  job_id TEXT,
  dispute_id TEXT,
  purpose TEXT NOT NULL CHECK (purpose IN ('job_video','deliverable','dispute_evidence','profile_media')),
  bucket TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  original_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  status TEXT NOT NULL DEFAULT 'pending_upload'
    CHECK (status IN ('pending_upload','uploaded','failed','deleted')),
  created_at TEXT NOT NULL,
  uploaded_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES marketplace_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (dispute_id) REFERENCES marketplace_disputes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_marketplace_assets_owner
  ON marketplace_assets(owner_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_marketplace_assets_job
  ON marketplace_assets(job_id, purpose, status);
CREATE INDEX IF NOT EXISTS idx_marketplace_assets_dispute
  ON marketplace_assets(dispute_id, purpose, status);
```

- [ ] **Step 2: Make migration idempotent for SQLite ALTER limitations**

If `ALTER TABLE ... ADD COLUMN` fails when a column already exists in the in-memory migration runner, split this migration into separate guarded statements in the mock migration loader or use `CREATE TABLE`-only additions plus app-level `SELECT` fallbacks. The expected behavior is that running `node scripts/test-migrations.mjs` succeeds more than once.

- [ ] **Step 3: Add TypeScript row types**

```ts
export type MarketplaceAssetPurpose = 'job_video' | 'deliverable' | 'dispute_evidence' | 'profile_media'
export type MarketplaceAssetStatus = 'pending_upload' | 'uploaded' | 'failed' | 'deleted'

export interface MarketplaceAssetRow {
  id: string
  owner_user_id: string
  job_id: string | null
  dispute_id: string | null
  purpose: MarketplaceAssetPurpose
  bucket: string
  object_key: string
  original_name: string
  content_type: string
  size_bytes: number
  sha256: string | null
  status: MarketplaceAssetStatus
  created_at: string
  uploaded_at: string | null
  updated_at: string
}
```

- [ ] **Step 4: Run migration smoke test**

Run: `node scripts/test-migrations.mjs`

Expected: command exits 0.

---

### Task 2: Stripe REST Client

**Files:**
- Create: `src/lib/stripe/stripeClient.test.ts`
- Create: `src/lib/stripe/stripeClient.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import { stripeFormRequest } from './stripeClient'

describe('stripeFormRequest', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('sends form encoded Stripe request with API version and idempotency', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_url)).toBe('https://api.stripe.com/v1/transfers')
      expect(init?.method).toBe('POST')
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer sk_test_123')
      expect(headers['Stripe-Version']).toBe('2026-02-25.clover')
      expect(headers['Idempotency-Key']).toBe('job_1_payout')
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
      expect(String(init?.body)).toContain('amount=1200')
      return new Response(JSON.stringify({ id: 'tr_123' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(stripeFormRequest('/v1/transfers', {
      body: { amount: '1200' },
      idempotencyKey: 'job_1_payout',
    })).resolves.toEqual({ id: 'tr_123' })
  })

  test('throws configured error without leaking secret key', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '')
    await expect(stripeFormRequest('/v1/transfers', { body: {} }))
      .rejects.toThrow('STRIPE_NOT_CONFIGURED')
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx.cmd vitest run src/lib/stripe/stripeClient.test.ts`

Expected: FAIL because `src/lib/stripe/stripeClient.ts` does not exist.

- [ ] **Step 3: Add Stripe client code**

```ts
export const STRIPE_API_VERSION = '2026-02-25.clover'

type StripeBody = Record<string, string | number | boolean | null | undefined>

export function encodeStripeForm(body: StripeBody): URLSearchParams {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue
    form.set(key, String(value))
  }
  return form
}

export async function stripeFormRequest<T = any>(
  path: string,
  args: { method?: string; body?: StripeBody; idempotencyKey?: string } = {},
): Promise<T> {
  const secretKey = process.env.STRIPE_SECRET_KEY
  if (!secretKey) throw new Error('STRIPE_NOT_CONFIGURED')
  const headers: Record<string, string> = {
    Authorization: `Bearer ${secretKey}`,
    'Stripe-Version': STRIPE_API_VERSION,
  }
  const method = args.method || 'POST'
  let body: string | undefined
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded'
    body = encodeStripeForm(args.body || {}).toString()
  }
  if (args.idempotencyKey) headers['Idempotency-Key'] = args.idempotencyKey

  const resp = await fetch(`https://api.stripe.com${path}`, { method, headers, body })
  const data: any = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const message = typeof data?.error?.message === 'string' ? data.error.message : 'Stripe request failed'
    throw new Error(message)
  }
  return data as T
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npx.cmd vitest run src/lib/stripe/stripeClient.test.ts`

Expected: PASS.

---

### Task 3: Ledger Helpers For Provider Reconciliation

**Files:**
- Modify: `src/lib/marketplace/ledger.ts`
- Modify: `src/lib/marketplace/__tests__/jobs.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/lib/marketplace/__tests__/jobs.test.ts`:

```ts
import { fetchTransactionByIdempotencyKey, markTransactionFailed } from '../ledger'

describe('marketplace transaction reconciliation helpers', () => {
  test('marks pending transaction failed with sanitized reason', async () => {
    const db = createMockD1()
    const job = await createJob(db, {
      fighterId: 'dev',
      jobType: 'open_bounty',
      title: 'Failed refund',
      brief: '',
      amountCents: 1200,
      clientRequestId: 'test_failed_refund',
    })
    await fundJob(db, { jobId: job.id, actorUserId: 'dev' })

    await markTransactionFailed(db, `job_${job.id}_hold`, 'card secret sk_test_123 failed')
    const txn = await fetchTransactionByIdempotencyKey(db, `job_${job.id}_hold`)

    expect(txn?.status).toBe('failed')
    expect(txn?.failure_reason).not.toContain('sk_test_123')
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx.cmd vitest run src/lib/marketplace/__tests__/jobs.test.ts`

Expected: FAIL because helpers are missing.

- [ ] **Step 3: Add ledger helper code**

```ts
export async function fetchTransactionByIdempotencyKey(
  db: D1Database,
  idempotencyKey: string,
): Promise<MarketplaceTransactionRow | null> {
  return db
    .prepare('SELECT * FROM marketplace_transactions WHERE idempotency_key = ?')
    .bind(idempotencyKey)
    .first<MarketplaceTransactionRow>()
}

const sanitizeProviderFailure = (reason: string): string =>
  String(reason || 'Provider request failed')
    .replace(/sk_(test|live)_[A-Za-z0-9_]+/g, 'sk_***')
    .slice(0, 500)

export async function markTransactionFailed(
  db: D1Database,
  idempotencyKey: string,
  reason: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE marketplace_transactions
          SET status = 'failed', failure_reason = ?, updated_at = ?
        WHERE idempotency_key = ?`,
    )
    .bind(sanitizeProviderFailure(reason), new Date().toISOString(), idempotencyKey)
    .run()
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npx.cmd vitest run src/lib/marketplace/__tests__/jobs.test.ts`

Expected: PASS.

---

### Task 4: Stripe Connect Onboarding

**Files:**
- Create: `src/lib/marketplace/connect.ts`
- Create: `src/lib/marketplace/__tests__/connect.test.ts`
- Create: `src/app/api/social/analyst/connect/onboard/route.ts`
- Create: `src/app/api/social/analyst/connect/refresh/route.ts`
- Modify: `src/app/api/social/analyst/profile/route.ts`

- [ ] **Step 1: Write failing service tests**

```ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMockD1 } from './mockD1'
import { ensureAnalystProfile } from './jobs'
import { createOrRefreshConnectAccount, refreshConnectPayoutStatus } from './connect'

describe('Connect onboarding', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('creates account and stores onboarding link', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    vi.stubEnv('MUSASHI_APP_URL', 'https://musashi.test')
    const db = createMockD1()
    await ensureAnalystProfile(db, 'dev')
    vi.stubGlobal('fetch', vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/v2/core/accounts')) {
        return Response.json({ id: 'acct_123', capabilities: { transfers: 'inactive' } })
      }
      return Response.json({ url: 'https://connect.stripe.test/onboard' })
    }))

    const result = await createOrRefreshConnectAccount(db, {
      userId: 'dev',
      email: 'dev@example.test',
      returnUrl: 'https://musashi.test/marketplace/settings?connect=return',
      refreshUrl: 'https://musashi.test/marketplace/settings?connect=refresh',
    })

    expect(result.onboardingUrl).toBe('https://connect.stripe.test/onboard')
    const row = await db.prepare('SELECT stripe_connect_id FROM analyst_profiles WHERE user_id = ?').bind('dev').first<{ stripe_connect_id: string }>()
    expect(row?.stripe_connect_id).toBe('acct_123')
  })

  test('refresh marks payouts enabled when transfers capability is active', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    const db = createMockD1()
    await ensureAnalystProfile(db, 'dev')
    await db.prepare('UPDATE analyst_profiles SET stripe_connect_id = ? WHERE user_id = ?').bind('acct_123', 'dev').run()
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'acct_123', capabilities: { transfers: 'active' } })))

    const result = await refreshConnectPayoutStatus(db, 'dev')

    expect(result.stripePayoutsEnabled).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx.cmd vitest run src/lib/marketplace/__tests__/connect.test.ts`

Expected: FAIL because `connect.ts` does not exist.

- [ ] **Step 3: Add Connect service code**

Add `src/lib/marketplace/connect.ts` with these exports:

```ts
import type { D1Database } from './types'
import { ensureAnalystProfile } from './jobs'
import { stripeFormRequest } from '@/lib/stripe/stripeClient'

export type ConnectOnboardingResult = {
  accountId: string
  onboardingUrl: string
  stripePayoutsEnabled: boolean
}

export type ConnectRefreshResult = {
  accountId: string
  stripePayoutsEnabled: boolean
  stripeOnboardingCompletedAt: string | null
}

const transfersActive = (account: any): boolean =>
  String(account?.capabilities?.transfers || '').toLowerCase() === 'active'

export async function createOrRefreshConnectAccount(
  db: D1Database,
  args: { userId: string; email: string; returnUrl: string; refreshUrl: string },
): Promise<ConnectOnboardingResult> {
  const profile = await ensureAnalystProfile(db, args.userId)
  let accountId = profile.stripe_connect_id
  if (!accountId) {
    const account = await stripeFormRequest<any>('/v2/core/accounts', {
      body: {
        'contact_email': args.email,
        'dashboard': 'express',
        'configuration[recipient][capabilities][transfers][requested]': 'true',
      },
      idempotencyKey: `connect_account_${args.userId}`,
    })
    accountId = String(account.id || '')
    if (!accountId) throw new Error('Stripe did not return an account id')
    await db.prepare(
      'UPDATE analyst_profiles SET stripe_connect_id = ?, updated_at = ? WHERE user_id = ?',
    ).bind(accountId, new Date().toISOString(), args.userId).run()
  }

  const link = await stripeFormRequest<any>('/v1/account_links', {
    body: {
      account: accountId,
      type: 'account_onboarding',
      return_url: args.returnUrl,
      refresh_url: args.refreshUrl,
    },
    idempotencyKey: `connect_onboarding_${args.userId}_${Date.now()}`,
  })
  const onboardingUrl = String(link.url || '')
  if (!onboardingUrl) throw new Error('Stripe did not return an onboarding URL')
  return { accountId, onboardingUrl, stripePayoutsEnabled: Boolean(profile.stripe_payouts_enabled) }
}

export async function refreshConnectPayoutStatus(
  db: D1Database,
  userId: string,
): Promise<ConnectRefreshResult> {
  const profile = await ensureAnalystProfile(db, userId)
  const accountId = profile.stripe_connect_id
  if (!accountId) throw new Error('CONNECT_ACCOUNT_MISSING')
  const account = await stripeFormRequest<any>(`/v2/core/accounts/${accountId}`, { method: 'GET' })
  const enabled = transfersActive(account)
  const now = new Date().toISOString()
  const completedAt = enabled ? profile.stripe_onboarding_completed_at || now : profile.stripe_onboarding_completed_at
  await db.prepare(
    `UPDATE analyst_profiles
        SET stripe_payouts_enabled = ?,
            stripe_onboarding_completed_at = ?,
            updated_at = ?
      WHERE user_id = ?`,
  ).bind(enabled ? 1 : 0, completedAt, now, userId).run()
  return { accountId, stripePayoutsEnabled: enabled, stripeOnboardingCompletedAt: completedAt }
}
```

- [ ] **Step 4: Add Connect route handlers**

`onboard/route.ts` uses `enforceUsage(req, 'chat')`, builds default return/refresh URLs from `MUSASHI_APP_URL` or request origin, and returns `{ onboardingUrl, accountId }`.

`refresh/route.ts` uses `enforceUsage(req, 'chat')`, refreshes status, and returns `{ stripePayoutsEnabled, stripeOnboardingCompletedAt }`.

- [ ] **Step 5: Gate direct hire**

In `PATCH /api/social/analyst/profile`, before setting `direct_hire_enabled = 1`, reject when:

```ts
if (
  body.directHireEnabled &&
  resolveMarketplacePaymentMode() === 'stripe' &&
  !profile.stripe_payouts_enabled
) {
  return NextResponse.json(
    { error: 'Complete Stripe Connect onboarding before enabling direct hire' },
    { status: 400 },
  )
}
```

- [ ] **Step 6: Run focused tests**

Run: `npx.cmd vitest run src/lib/marketplace/__tests__/connect.test.ts src/lib/marketplace/__tests__/jobs.test.ts`

Expected: PASS.

---

### Task 5: Real Money Movement From Ledger Rows

**Files:**
- Create: `src/lib/marketplace/moneyMovement.ts`
- Create: `src/lib/marketplace/__tests__/moneyMovement.test.ts`
- Modify: `src/lib/marketplace/jobs.ts`
- Modify: `src/app/api/social/jobs/[id]/approve/route.ts`
- Modify: `src/app/api/social/jobs/[id]/cancel/route.ts`
- Modify: `src/app/api/social/disputes/[id]/resolve/route.ts`

- [ ] **Step 1: Write failing money movement tests**

```ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createJob, ensureAnalystProfile, fundJob, releaseJob } from '../jobs'
import { createMockD1 } from '../mockD1'
import { executeJobReleaseMoneyMovement } from '../moneyMovement'

describe('marketplace money movement', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  test('transfers analyst payout to connected account and marks payout succeeded', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_123')
    vi.stubEnv('MUSASHI_MARKETPLACE_PAYMENTS', 'stripe')
    const db = createMockD1()
    const analyst = await ensureAnalystProfile(db, 'analyst_1')
    await db.prepare('UPDATE analyst_profiles SET stripe_connect_id = ?, stripe_payouts_enabled = 1 WHERE user_id = ?').bind('acct_123', analyst.user_id).run()
    const job = await createJob(db, {
      fighterId: 'dev',
      analystId: 'analyst_1',
      jobType: 'direct_hire',
      title: 'Release payout',
      brief: '',
      amountCents: 2000,
      clientRequestId: 'money_release',
    })
    const funded = await fundJob(db, { jobId: job.id, actorUserId: 'dev', transactionStatus: 'succeeded', stripePaymentIntentId: 'pi_123' })
    await releaseJob(db, { jobId: funded.id, actorUserId: 'dev' })
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: 'tr_123' })))

    await executeJobReleaseMoneyMovement(db, funded.id)

    const payout = await db.prepare('SELECT status, stripe_transfer_id FROM marketplace_transactions WHERE idempotency_key = ?').bind(`job_${funded.id}_payout`).first<{ status: string; stripe_transfer_id: string }>()
    expect(payout?.status).toBe('succeeded')
    expect(payout?.stripe_transfer_id).toBe('tr_123')
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx.cmd vitest run src/lib/marketplace/__tests__/moneyMovement.test.ts`

Expected: FAIL because `moneyMovement.ts` does not exist.

- [ ] **Step 3: Add release, refund, and split executor code**

Add `src/lib/marketplace/moneyMovement.ts` with these exports and behavior:

```ts
export async function executeJobReleaseMoneyMovement(db: D1Database, jobId: string): Promise<void>
export async function executeJobRefundMoneyMovement(db: D1Database, jobId: string): Promise<void>
export async function executeJobSplitMoneyMovement(db: D1Database, jobId: string): Promise<void>
```

Each function:

- Returns immediately unless `resolveMarketplacePaymentMode() === 'stripe'`.
- Reads the job, analyst profile, and relevant pending ledger rows.
- Calls Stripe `/v1/transfers` or `/v1/refunds`.
- Marks rows succeeded with provider IDs.
- Marks rows failed with sanitized failure reason when Stripe rejects.

Use this transfer request shape:

```ts
await stripeFormRequest<{ id: string }>('/v1/transfers', {
  body: {
    amount: Math.abs(payout.amount_cents),
    currency: payout.currency.toLowerCase(),
    destination: analyst.stripe_connect_id,
    metadata: { musashi_marketplace_job_id: job.id },
  },
  idempotencyKey: payout.idempotency_key,
})
```

Use this refund request shape:

```ts
await stripeFormRequest<{ id: string }>('/v1/refunds', {
  body: {
    payment_intent: hold.stripe_payment_intent_id,
    amount: Math.abs(refund.amount_cents),
    metadata: { musashi_marketplace_job_id: job.id },
  },
  idempotencyKey: refund.idempotency_key,
})
```

- [ ] **Step 4: Wire routes**

After `releaseJob`, call `executeJobReleaseMoneyMovement`.

After `cancelJob`, call `executeJobRefundMoneyMovement`.

After dispute `refund`, `release`, `split`, or `dismiss`, call the matching executor.

- [ ] **Step 5: Run focused marketplace tests**

Run: `npx.cmd vitest run src/lib/marketplace/__tests__/moneyMovement.test.ts src/lib/marketplace/__tests__/jobs.test.ts`

Expected: PASS.

---

### Task 6: Upload Asset Service And R2 Signing

**Files:**
- Create: `src/lib/storage/assets.ts`
- Create: `src/lib/storage/r2.ts`
- Create: `src/lib/storage/__tests__/assets.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createMockD1 } from '@/lib/marketplace/mockD1'
import { createUploadTicket } from '../assets'

describe('upload assets', () => {
  afterEach(() => vi.unstubAllEnvs())

  test('fails closed when R2 is not configured', async () => {
    const db = createMockD1()
    await expect(createUploadTicket(db, {
      userId: 'dev',
      purpose: 'job_video',
      originalName: 'clip.mp4',
      contentType: 'video/mp4',
      sizeBytes: 1024,
    })).rejects.toThrow('STORAGE_NOT_CONFIGURED')
  })

  test('rejects invalid content type for job video', async () => {
    vi.stubEnv('STORAGE_SERVICE_URL', 'https://example.r2.cloudflarestorage.com')
    vi.stubEnv('STORAGE_ACCESS_KEY', 'access')
    vi.stubEnv('STORAGE_SECRET_KEY', 'secret')
    vi.stubEnv('STORAGE_BUCKET_NAME', 'musashi-uploads')
    const db = createMockD1()
    await expect(createUploadTicket(db, {
      userId: 'dev',
      purpose: 'job_video',
      originalName: 'clip.txt',
      contentType: 'text/plain',
      sizeBytes: 100,
    })).rejects.toThrow('Unsupported content type')
  })
})
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx.cmd vitest run src/lib/storage/__tests__/assets.test.ts`

Expected: FAIL because storage modules do not exist.

- [ ] **Step 3: Add storage module code**

`assets.ts` exports:

```ts
export async function createUploadTicket(db: D1Database, input: CreateUploadTicketInput): Promise<UploadTicket>
export async function completeUpload(db: D1Database, input: CompleteUploadInput): Promise<MarketplaceAssetRow>
export async function getReadableAsset(db: D1Database, input: GetAssetInput): Promise<{ asset: MarketplaceAssetRow; readUrl: string }>
```

`createUploadTicket` validates:

- `job_video`: `video/mp4`, `video/quicktime`, `video/webm`, max 500 MB.
- `deliverable`: `application/pdf`, `text/plain`, `text/markdown`, `video/mp4`, max 500 MB.
- `dispute_evidence`: images, PDFs, text, and videos, max 500 MB.
- `profile_media`: images only, max 10 MB.

`r2.ts` exports:

```ts
export function assertStorageConfigured(): StorageConfig
export async function createSignedUploadUrl(args: { key: string; contentType: string; expiresSeconds?: number }): Promise<SignedR2Url>
export async function createSignedReadUrl(args: { key: string; expiresSeconds?: number }): Promise<string>
```

`createSignedUploadUrl` returns a presigned PUT URL valid for 15 minutes and `createSignedReadUrl` returns a presigned GET URL valid for 10 minutes using AWS Signature V4.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npx.cmd vitest run src/lib/storage/__tests__/assets.test.ts`

Expected: PASS.

---

### Task 7: Upload API Routes And Marketplace Compatibility

**Files:**
- Create: `src/app/api/uploads/route.ts`
- Create: `src/app/api/uploads/[id]/route.ts`
- Create: `src/app/api/uploads/[id]/complete/route.ts`
- Modify: `src/app/api/social/jobs/route.ts`
- Modify: `src/app/api/social/jobs/[id]/submit/route.ts`
- Modify: `src/app/api/social/disputes/[id]/evidence/route.ts`

- [ ] **Step 1: Add upload route code**

`POST /api/uploads` reads:

```ts
{
  purpose: 'job_video' | 'deliverable' | 'dispute_evidence' | 'profile_media',
  originalName: string,
  contentType: string,
  sizeBytes: number,
  jobId?: string,
  disputeId?: string
}
```

Returns:

```ts
{
  asset: { id: string, objectKey: string, status: 'pending_upload' },
  upload: { method: 'PUT', url: string, headers: Record<string, string>, expiresAt: string }
}
```

- [ ] **Step 2: Add completion route**

`POST /api/uploads/[id]/complete` reads `{ sizeBytes?: number, sha256?: string }` and returns `{ asset }`.

- [ ] **Step 3: Add read route**

`GET /api/uploads/[id]` returns `{ asset, readUrl }` for owner or linked participant.

- [ ] **Step 4: Add marketplace compatibility inputs**

In `POST /api/social/jobs`, merge `assetIds` into the `videos` JSON as `asset:<id>` strings.

In `POST /api/social/jobs/[id]/submit`, allow `deliverableAssetId` and convert it to `asset:<id>` for existing `deliverable_url`.

In `POST /api/social/disputes/[id]/evidence`, merge `evidenceAssetIds` into evidence arrays as `asset:<id>`.

- [ ] **Step 5: Run storage and marketplace tests**

Run: `npx.cmd vitest run src/lib/storage/__tests__/assets.test.ts src/lib/marketplace/__tests__/jobs.test.ts`

Expected: PASS.

---

### Task 8: Email Tokens And Mail Client

**Files:**
- Create: `src/lib/email/emailClient.ts`
- Create: `src/lib/auth/emailTokens.ts`
- Create: `src/lib/auth/emailTokens.test.ts`

- [ ] **Step 1: Write failing token tests**

```ts
import { describe, expect, test } from 'vitest'
import { createMockD1 } from '@/lib/marketplace/mockD1'
import { createEmailToken, consumeEmailToken } from './emailTokens'

describe('email tokens', () => {
  test('consumes token only once for matching purpose', async () => {
    const db = createMockD1()
    const created = await createEmailToken(db, {
      userId: 'dev',
      email: 'dev@example.test',
      purpose: 'verify_email',
      ttlMs: 60_000,
    })

    await expect(consumeEmailToken(db, created.token, 'verify_email'))
      .resolves.toMatchObject({ userId: 'dev', email: 'dev@example.test' })
    await expect(consumeEmailToken(db, created.token, 'verify_email'))
      .rejects.toThrow('TOKEN_INVALID')
  })
})
```

- [ ] **Step 2: Run test and verify RED**

Run: `npx.cmd vitest run src/lib/auth/emailTokens.test.ts`

Expected: FAIL because `emailTokens.ts` does not exist.

- [ ] **Step 3: Add email token code**

Use 32 random bytes, base64url token encoding, SHA-256 token hashing, `auth_email_tokens`, expiry, and `used_at`.

- [ ] **Step 4: Add mail client code**

`sendTransactionalEmail` posts to `${EMAIL_SERVICE_URL}/emails` with:

```ts
{
  from: process.env.EMAIL_FROM_ADDRESS,
  to: [recipient],
  subject,
  html,
  text
}
```

When `EMAIL_DRY_RUN=1` or `NODE_ENV !== 'production'` and `EMAIL_API_KEY` is missing, return `{ dryRun: true }` with the generated URL.

- [ ] **Step 5: Run token tests**

Run: `npx.cmd vitest run src/lib/auth/emailTokens.test.ts`

Expected: PASS.

---

### Task 9: Auth Route Wiring

**Files:**
- Modify: `src/lib/musashiAuth.ts`
- Create: `src/app/api/auth/email/verify/send/route.ts`
- Create: `src/app/api/auth/email/verify/confirm/route.ts`
- Create: `src/app/api/auth/password/reset/request/route.ts`
- Create: `src/app/api/auth/password/reset/confirm/route.ts`

- [ ] **Step 1: Add auth helper code**

Add fields to `MusashiUser`:

```ts
emailVerifiedAt: string | null
passwordUpdatedAt: string | null
```

Modify `verifySessionCookie` to join session and user:

```sql
SELECT s.id, s.user_id, s.expires_at, s.revoked_at, s.created_at, u.password_updated_at
FROM musashi_sessions s
JOIN musashi_users u ON u.id = s.user_id
WHERE s.id = ?
```

Reject when `password_updated_at` is later than session `created_at`.

- [ ] **Step 2: Add verification send route**

Requires `requireUser`. Creates token with purpose `verify_email`, sends email to current user, and returns dry-run URL in non-production dry-run mode.

- [ ] **Step 3: Add verification confirm route**

Consumes token, updates `musashi_users.email_verified_at`, and returns `{ ok: true }`.

- [ ] **Step 4: Add password reset request route**

Always returns `{ ok: true }`. If user exists, creates `password_reset` token and sends reset email.

- [ ] **Step 5: Add password reset confirm route**

Consumes token, validates password with the existing password policy, writes `password_hash` and `password_updated_at`, and revokes existing sessions for that user.

- [ ] **Step 6: Run auth token tests**

Run: `npx.cmd vitest run src/lib/auth/emailTokens.test.ts`

Expected: PASS.

---

### Task 10: Webhook And Env Checks

**Files:**
- Modify: `src/app/api/billing/webhook/route.ts`
- Modify: `scripts/check-prod-env.mjs`
- Modify: `.env.example`

- [ ] **Step 1: Handle Connect account updates**

In billing webhook:

```ts
if (type === 'account.updated') {
  const accountId = String(obj?.id || '').trim()
  const transfers = String(obj?.capabilities?.transfers || '')
  const enabled = transfers === 'active' ? 1 : 0
  await db.prepare(
    `UPDATE analyst_profiles
        SET stripe_payouts_enabled = ?,
            stripe_onboarding_completed_at = CASE WHEN ? = 1 THEN COALESCE(stripe_onboarding_completed_at, ?) ELSE stripe_onboarding_completed_at END,
            updated_at = ?
      WHERE stripe_connect_id = ?`,
  ).bind(enabled, enabled, new Date().toISOString(), new Date().toISOString(), accountId).run()
}
```

- [ ] **Step 2: Update env checker**

Add production checks for:

```js
MUSASHI_APP_URL
EMAIL_SERVICE_URL
EMAIL_API_KEY
EMAIL_FROM_ADDRESS
STORAGE_SERVICE_URL
STORAGE_ACCESS_KEY
STORAGE_SECRET_KEY
STORAGE_BUCKET_NAME
MUSASHI_MARKETPLACE_PAYMENTS === 'stripe'
```

- [ ] **Step 3: Update `.env.example`**

Add:

```bash
MUSASHI_APP_URL=http://localhost:3000
EMAIL_DRY_RUN=1
```

- [ ] **Step 4: Run env check in local mode**

Run: `node scripts/check-prod-env.mjs --production`

Expected: may report missing real secrets locally, but it must not crash.

---

### Task 11: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
npx.cmd vitest run src/lib/stripe/stripeClient.test.ts src/lib/marketplace/__tests__/connect.test.ts src/lib/marketplace/__tests__/moneyMovement.test.ts src/lib/storage/__tests__/assets.test.ts src/lib/auth/emailTokens.test.ts src/lib/marketplace/__tests__/jobs.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run migration smoke**

Run:

```powershell
node scripts/test-migrations.mjs
```

Expected: PASS.

- [ ] **Step 3: Run type check**

Run:

```powershell
npx.cmd tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run existing QA loop if focused tests pass**

Run:

```powershell
pnpm test:loop
```

Expected: PASS.

- [ ] **Step 5: Commit implementation**

```bash
git add migrations/0021_launch_critical_api_wiring.sql src scripts .env.example
git commit -m "feat: wire launch-critical APIs"
```
