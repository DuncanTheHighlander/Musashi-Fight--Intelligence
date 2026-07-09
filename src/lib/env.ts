/**
 * Production environment validation.
 * Call validateEnv() at app startup to ensure all required env vars are set.
 * Secrets Store-backed secrets (e.g. STRIPE) are validated via validateProductionSecrets().
 */
import { getServerSecret } from '@/lib/cloudflare/secrets'

type EnvVar = {
  key: string
  required: boolean
  secret?: boolean // if true, warn when using obvious defaults
}

const ENV_VARS: EnvVar[] = [
  { key: 'MUSASHI_SESSION_SECRET', required: true, secret: true },
  { key: 'MUSASHI_SHOGUN_EMAIL', required: false },
  { key: 'MUSASHI_SHOGUN_PASSWORD', required: false, secret: true },
]

const WEAK_SECRETS = [
  'musashi-super-secret',
  'change-me',
  'your-secret-here',
  'generate-a-strong',
  'password123',
  'secret123',
]

// Substrings that indicate a placeholder rather than a real credential.
// Anything matching these is treated as "not set" by readSecretEnv().
const PLACEHOLDER_MARKERS = [
  'your-',
  'your_',
  'change-me',
  'changeme',
  'replace-me',
  'replaceme',
  'placeholder',
  'sk_test_your_',
  'pk_test_your_',
  'whsec_your_',
]

/**
 * Read a secret env var, treating obvious placeholder strings (e.g. the
 * defaults shipped in .env.example) as if the variable were unset. This stops
 * us from sending `your-openai-api-key-here` as a Bearer token to OpenAI and
 * surfacing a confusing 401 in the demo.
 */
export function readSecretEnv(key: string): string | undefined {
  const raw = process.env[key]
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const lower = trimmed.toLowerCase()
  if (PLACEHOLDER_MARKERS.some((m) => lower.includes(m))) return undefined
  return trimmed
}

export function validateEnv(): { valid: boolean; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  const isProd = process.env.NODE_ENV === 'production'

  for (const v of ENV_VARS) {
    const val = process.env[v.key]
    const effectiveVal = v.secret || v.key.includes('KEY') || v.key.includes('SECRET')
      ? readSecretEnv(v.key)
      : val?.trim()
    if (v.required && !effectiveVal) {
      errors.push(`Missing required env var: ${v.key}`)
    }
    if (v.secret && val && isProd) {
      const lower = val.toLowerCase()
      if (WEAK_SECRETS.some((w) => lower.includes(w))) {
        errors.push(`${v.key} appears to use a weak/default value. Change it for production.`)
      }
    }
  }

  if (isProd && process.env.MUSASHI_DISABLE_AUTH === '1') {
    errors.push('MUSASHI_DISABLE_AUTH=1 must NOT be set in production. Remove it.')
  }

  if (isProd) {
    // Deployed Worker gets these from wrangler.toml [vars]; a local `next build`
    // also runs with NODE_ENV=production, so keep these warnings (not errors).
    const payments = String(process.env.MUSASHI_MARKETPLACE_PAYMENTS || 'mock').toLowerCase()
    if (payments !== 'stripe') {
      warnings.push(
        `MUSASHI_MARKETPLACE_PAYMENTS is "${payments}" — production must use "stripe" (wrangler.toml [vars]).`,
      )
    }
    const storage = String(process.env.MUSASHI_STORAGE_MODE || 'mock').toLowerCase()
    if (storage !== 'r2') {
      warnings.push(
        `MUSASHI_STORAGE_MODE is "${storage}" — production must use "r2" (wrangler.toml [vars]).`,
      )
    } else {
      const storageKeys = ['STORAGE_SERVICE_URL', 'STORAGE_ACCESS_KEY', 'STORAGE_SECRET_KEY', 'STORAGE_BUCKET_NAME']
      const missing = storageKeys.filter((k) => !readSecretEnv(k))
      if (missing.length > 0) {
        warnings.push(
          `R2 storage mode is on but ${missing.join(', ')} missing/placeholder — uploads will fail with STORAGE_NOT_CONFIGURED. Set via \`wrangler secret put\`.`,
        )
      }
    }
    if (!readSecretEnv('EMAIL_API_KEY')) {
      warnings.push(
        'EMAIL_API_KEY is missing or a placeholder — password reset / email verification will fail. Set it via `wrangler secret put EMAIL_API_KEY`.',
      )
    }
    if (!readSecretEnv('MUSASHI_CRON_SECRET')) {
      warnings.push(
        'MUSASHI_CRON_SECRET is not set — /api/cron/* HTTP routes stay locked (403). Set it via `wrangler secret put MUSASHI_CRON_SECRET`.',
      )
    }
    if (payments === 'stripe' && !readSecretEnv('STRIPE_WEBHOOK_SECRET')) {
      warnings.push(
        'STRIPE_WEBHOOK_SECRET is not set — Stripe webhooks will return 501. Set it via `wrangler secret put STRIPE_WEBHOOK_SECRET`.',
      )
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}

/** Async checks for Secrets Store-backed production secrets (Stripe, etc.). */
export async function validateProductionSecrets(): Promise<string[]> {
  const warnings: string[] = []
  if (process.env.NODE_ENV !== 'production') return warnings

  const geminiKey = await getServerSecret('GEMINI_API_KEY')
  if (!geminiKey) {
    warnings.push(
      'Gemini AI secret is not configured (Secrets Store binding SECRET_AI). Fight analysis will not work in production.',
    )
  }

  const stripeKey = await getServerSecret('STRIPE_SECRET_KEY')
  if (!stripeKey) {
    warnings.push(
      'STRIPE secret is not configured (Secrets Store binding SECRET_STRIPE). Payments will not work in production.',
    )
  } else if (!stripeKey.startsWith('sk_live')) {
    warnings.push('STRIPE secret is not a live key. Payments will not work in production.')
  }

  return warnings
}
