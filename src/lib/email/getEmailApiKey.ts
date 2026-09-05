import { getServerSecret } from '@/lib/cloudflare/secrets'

/**
 * Resend API key from Secrets Store binding `SECRET_EMAIL` (store name: "ResendEmail"),
 * with fallback to Worker secret / `.dev.vars` `EMAIL_API_KEY`.
 * Server/API routes only — never import from client components.
 */
export async function getEmailApiKey(): Promise<string | undefined> {
  return getServerSecret('EMAIL_API_KEY')
}

export async function requireEmailApiKey(): Promise<string> {
  const key = await getEmailApiKey()
  if (!key) throw new Error('EMAIL_NOT_CONFIGURED')
  return key
}

/** Boolean check only — never throws or returns secret values. */
export async function isEmailConfigured(): Promise<boolean> {
  return Boolean(await getEmailApiKey())
}
