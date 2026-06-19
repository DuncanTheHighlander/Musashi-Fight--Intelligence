/**
 * Production environment validation.
 * Call validateEnv() at app startup to ensure all required env vars are set.
 */

type EnvVar = {
  key: string
  required: boolean
  secret?: boolean // if true, warn when using obvious defaults
}

const ENV_VARS: EnvVar[] = [
  { key: 'GEMINI_API_KEY', required: true },
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

  if (isProd && !process.env.STRIPE_SECRET_KEY?.startsWith('sk_live')) {
    warnings.push('STRIPE_SECRET_KEY is not a live key. Payments will not work in production.')
  }

  return { valid: errors.length === 0, errors, warnings }
}
