/**
 * Server-side access to Cloudflare Secrets Store bindings.
 *
 * Store secrets use async `env.BINDING.get()` — never read them in client components.
 * Local dev falls back to `.dev.vars` / process.env using SECRET_ENV_ALIASES keys.
 */
import { getCloudflareContext } from '@opennextjs/cloudflare'

export type SecretsStoreBinding =
  | 'SECRET_AI'
  | 'SECRET_MODAL'
  | 'SECRET_REVCAT1'
  | 'SECRET_REVCAT2'
  | 'SECRET_STRIPE'
  | 'SECRET_SUPABASE'

/** Env var name → Secrets Store binding (for migrating existing server code). */
export const ENV_KEY_TO_BINDING: Partial<Record<string, SecretsStoreBinding>> = {
  GEMINI_API_KEY: 'SECRET_AI',
  MODAL_API_KEY: 'SECRET_MODAL',
  REVENUECAT_API_KEY: 'SECRET_REVCAT1',
  REVENUECAT_API_KEY_SECONDARY: 'SECRET_REVCAT2',
  STRIPE_SECRET_KEY: 'SECRET_STRIPE',
  SUPABASE_SERVICE_ROLE_KEY: 'SECRET_SUPABASE',
}

/** Secrets Store binding → env var name used by existing server code / .dev.vars */
export const SECRET_ENV_ALIASES: Record<SecretsStoreBinding, string> = {
  SECRET_AI: 'GEMINI_API_KEY',
  SECRET_MODAL: 'MODAL_API_KEY',
  SECRET_REVCAT1: 'REVENUECAT_API_KEY',
  SECRET_REVCAT2: 'REVENUECAT_API_KEY_SECONDARY',
  SECRET_STRIPE: 'STRIPE_SECRET_KEY',
  SECRET_SUPABASE: 'SUPABASE_SERVICE_ROLE_KEY',
}

function readLocalFallback(binding: SecretsStoreBinding): string | undefined {
  const alias = SECRET_ENV_ALIASES[binding]
  const raw = process.env[alias]?.trim()
  if (!raw) return undefined
  const lower = raw.toLowerCase()
  if (
    lower.includes('your-') ||
    lower.includes('sk_test_your_') ||
    lower.includes('placeholder')
  ) {
    return undefined
  }
  return raw
}

/**
 * Resolve a server secret by legacy env var name.
 * Production: Cloudflare Secrets Store binding. Local dev: `.dev.vars` / process.env.
 */
export async function getServerSecret(envKey: string): Promise<string | undefined> {
  const binding = ENV_KEY_TO_BINDING[envKey]
  if (binding) {
    const fromStore = await getSecretsStoreValue(binding)
    if (fromStore) return fromStore
  }
  const raw = process.env[envKey]?.trim()
  if (!raw) return undefined
  const lower = raw.toLowerCase()
  if (
    lower.includes('your-') ||
    lower.includes('sk_test_your_') ||
    lower.includes('placeholder')
  ) {
    return undefined
  }
  return raw
}

export async function requireGeminiApiKey(): Promise<string> {
  const key = await getServerSecret('GEMINI_API_KEY')
  if (!key) throw new Error('GEMINI_API_KEY not configured')
  return key
}

export async function isGeminiConfigured(): Promise<boolean> {
  return Boolean(await getServerSecret('GEMINI_API_KEY'))
}

/**
 * Read one secret from Secrets Store (production) or `.dev.vars` (local).
 */
export async function getSecretsStoreValue(
  binding: SecretsStoreBinding,
): Promise<string | undefined> {
  try {
    const { env } = await getCloudflareContext({ async: true })
    const storeBinding = env[binding] as SecretsStoreSecret | undefined
    if (storeBinding?.get) {
      const value = (await storeBinding.get()).trim()
      return value || undefined
    }
  } catch {
    // next dev without OpenNext Cloudflare context — use local fallback
  }

  return readLocalFallback(binding)
}

/** Example: all six store secrets resolved to legacy env key names (server-only). */
export async function resolveServerSecrets(): Promise<Partial<Record<string, string>>> {
  const resolved: Partial<Record<string, string>> = {}
  for (const binding of Object.keys(SECRET_ENV_ALIASES) as SecretsStoreBinding[]) {
    const value = await getSecretsStoreValue(binding)
    if (value) resolved[SECRET_ENV_ALIASES[binding]] = value
  }
  return resolved
}

/** Which bindings are configured (boolean flags only — never returns secret values). */
export async function getSecretsAvailability(): Promise<Record<SecretsStoreBinding, boolean>> {
  const bindings = Object.keys(SECRET_ENV_ALIASES) as SecretsStoreBinding[]
  const entries = await Promise.all(
    bindings.map(async (binding) => [binding, Boolean(await getSecretsStoreValue(binding))] as const),
  )
  return Object.fromEntries(entries) as Record<SecretsStoreBinding, boolean>
}
