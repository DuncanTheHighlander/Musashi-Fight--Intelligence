import { getSecretsStoreValue } from '@/lib/cloudflare/secrets'

export type SupabaseServerConfig = {
  url: string
  serviceRoleKey: string
}

/**
 * Supabase admin client config from Secrets Store binding `SECRET_SUPABASE`.
 *
 * Store value may be:
 * - JSON: {"url":"https://xxx.supabase.co","serviceRoleKey":"eyJ..."}
 * - Plain service-role key with NEXT_PUBLIC_SUPABASE_URL set as a public var
 */
export async function getSupabaseServerConfig(): Promise<SupabaseServerConfig | null> {
  const raw = await getSecretsStoreValue('SECRET_SUPABASE')
  if (!raw) return null

  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as {
        url?: string
        serviceRoleKey?: string
        key?: string
      }
      const url = parsed.url?.trim()
      const serviceRoleKey = (parsed.serviceRoleKey || parsed.key)?.trim()
      if (url && serviceRoleKey) return { url, serviceRoleKey }
    } catch {
      return null
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  if (url) return { url, serviceRoleKey: raw }

  return null
}

/** Example server-side Supabase REST call — keeps service role off the client. */
export async function supabaseAdminFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const config = await getSupabaseServerConfig()
  if (!config) {
    return new Response(JSON.stringify({ error: 'Supabase not configured' }), {
      status: 501,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const url = `${config.url.replace(/\/$/, '')}/rest/v1/${path.replace(/^\//, '')}`
  return fetch(url, {
    ...init,
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers as Record<string, string> | undefined),
    },
  })
}
