import { getSecretsStoreValue } from '@/lib/cloudflare/secrets'

/**
 * Stripe secret key from Secrets Store binding `SECRET_STRIPE` (store name: "Stripe").
 * Server/API routes only — never import from client components.
 */
export async function getStripeSecretKey(): Promise<string | undefined> {
  return getSecretsStoreValue('SECRET_STRIPE')
}

export async function requireStripeSecretKey(): Promise<string> {
  const key = await getStripeSecretKey()
  if (!key) throw new Error('STRIPE_NOT_CONFIGURED')
  return key
}

/** Boolean check only — never throws or returns secret values. */
export async function isStripeConfigured(): Promise<boolean> {
  return Boolean(await getStripeSecretKey())
}
