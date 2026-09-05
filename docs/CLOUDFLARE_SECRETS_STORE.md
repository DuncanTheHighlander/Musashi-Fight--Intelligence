# Cloudflare Secrets Store integration

This project reads account-level secrets from **Cloudflare Secrets Store** via Worker bindings configured in `wrangler.toml`. The store ID identifies *which store* to use; it is **not** an API key.

## Store configuration

| Store field | Value |
|-------------|-------|
| Store ID | `3a6ee7307f0b482ab4b3f3dd6794168c` |
| Secret names | `Ai`, `Modal`, `revcat1`, `revcat2`, `Stripe`, `Supabase`, `ResendEmail` |
| Scopes | Workers, AI Gateway (set in dashboard) |

## Wrangler bindings (`wrangler.toml`)

Each secret is bound by **binding name** + **store_id** + **secret_name**:

```toml
[[secrets_store_secrets]]
binding = "SECRET_STRIPE"
store_id = "3a6ee7307f0b482ab4b3f3dd6794168c"
secret_name = "Stripe"
```

## Access in Worker / Next.js API routes

Secrets Store bindings are **async** — call `.get()` on the binding:

```typescript
import { getCloudflareContext } from '@opennextjs/cloudflare'

export async function GET() {
  const { env } = await getCloudflareContext({ async: true })
  const stripeKey = await env.SECRET_STRIPE.get()
  // use stripeKey server-side only
}
```

Prefer the shared helpers in `src/lib/cloudflare/secrets.ts`:

```typescript
import { getSecretsStoreValue } from '@/lib/cloudflare/secrets'
import { requireStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'
import { getSupabaseServerConfig } from '@/lib/supabase/server'

const aiKey = await getSecretsStoreValue('SECRET_AI')
const stripeKey = await requireStripeSecretKey()
const supabase = await getSupabaseServerConfig()
```

## Frontend → backend flow

1. **Browser / React** calls your Next.js API routes (e.g. `/api/billing/create-checkout-session`).
2. **API routes** (server-only) call `getSecretsStoreValue()` or service helpers — never expose raw secrets to the client.
3. **Publishable** keys only (e.g. `NEXT_PUBLIC_*`, Stripe publishable key) may live in public env vars; **secret** keys stay in Secrets Store.

Check configuration without leaking values: `GET /api/internal/config-status` returns booleans only.

## Local development

Production Secrets Store secrets are **not** available in plain `next dev`. Options:

1. **Recommended:** Copy `.dev.vars.example` → `.dev.vars` with test credentials (fallback keys in `secrets.ts`).
2. **OpenNext + Wrangler:** Set `MUSASHI_OPENNEXT_DEV=1` and use `opennextjs-cloudflare preview` / `wrangler dev` after build.
3. **Remote bindings:** Use Wrangler remote bindings (requires login) for integration testing against live store secrets.

## Deployment

From the project root:

```bash
# 1. Authenticate
wrangler login

# 2. Verify store secrets exist (store ID is for listing/management only)
wrangler secrets-store secret list 3a6ee7307f0b482ab4b3f3dd6794168c --remote

# 3. Validate config
wrangler check

# 4. Regenerate TypeScript bindings after wrangler.toml changes
wrangler types --env-interface CloudflareEnv env.d.ts

# 5. Build OpenNext bundle and deploy
pnpm run deploy
# or: opennextjs-cloudflare build && opennextjs-cloudflare deploy
```

Set remaining per-Worker secrets (session, webhooks, storage) if not in Secrets Store:

```bash
wrangler secret put MUSASHI_SESSION_SECRET
# Prefer Secrets Store secret "ResendEmail" (binding SECRET_EMAIL). Legacy alternative:
wrangler secret put EMAIL_API_KEY
wrangler secret put STRIPE_WEBHOOK_SECRET
```

## When is Store ID used vs secret names?

| Use case | Use |
|----------|-----|
| `wrangler secrets-store secret list/create/delete` | **Store ID** |
| `wrangler.toml` `store_id` field | **Store ID** |
| Worker runtime `env.SECRET_STRIPE.get()` | **Binding name** (maps to `secret_name` in config) |
| Application code | **Binding name** or helpers — never Store ID as a credential |

## Wiring existing Stripe routes

Replace direct `process.env.STRIPE_SECRET_KEY` reads with:

```typescript
import { requireStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'

const secretKey = await requireStripeSecretKey()
```
