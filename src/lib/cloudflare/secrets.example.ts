/**
 * Reference: accessing every Secrets Store binding from a Worker or API route.
 * Do not import this file in production — copy patterns into your handlers.
 */
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { getSecretsStoreValue } from '@/lib/cloudflare/secrets'

/** Raw binding access (Worker-style) */
export async function exampleRawBindingAccess() {
  const { env } = await getCloudflareContext({ async: true })

  const ai = await env.SECRET_AI.get()
  const modal = await env.SECRET_MODAL.get()
  const revcat1 = await env.SECRET_REVCAT1.get()
  const revcat2 = await env.SECRET_REVCAT2.get()
  const stripe = await env.SECRET_STRIPE.get()
  const supabase = await env.SECRET_SUPABASE.get()

  return { ai, modal, revcat1, revcat2, stripe, supabase }
}

/** Preferred: shared helper with .dev.vars fallback for local dev */
export async function exampleHelperAccess() {
  const ai = await getSecretsStoreValue('SECRET_AI')
  const modal = await getSecretsStoreValue('SECRET_MODAL')
  const revcat1 = await getSecretsStoreValue('SECRET_REVCAT1')
  const revcat2 = await getSecretsStoreValue('SECRET_REVCAT2')
  const stripe = await getSecretsStoreValue('SECRET_STRIPE')
  const supabase = await getSecretsStoreValue('SECRET_SUPABASE')

  return { ai, modal, revcat1, revcat2, stripe, supabase }
}
