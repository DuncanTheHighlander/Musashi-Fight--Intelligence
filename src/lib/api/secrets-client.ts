/**
 * Client-side helpers — call Worker/Next API routes only.
 * Never import server secret helpers or read secret env vars in the browser.
 */

export type StripeStatusResponse = {
  configured: boolean
  mode: 'live' | 'test' | null
}

export type SupabaseHealthResponse = {
  configured: boolean
}

export type ConfigStatusResponse = {
  secretsStore: {
    ai: boolean
    modal: boolean
    revcat1: boolean
    revcat2: boolean
    stripe: boolean
    supabase: boolean
  }
  supabaseUrlPublic: boolean
}

/** Example: browser fetches Stripe status via Worker API route (no secrets in client). */
export async function fetchStripeStatus(): Promise<StripeStatusResponse> {
  const res = await fetch('/api/stripe/status', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`Stripe status failed (${res.status})`)
  return res.json()
}

/** Example: browser fetches Supabase health via Worker API route. */
export async function fetchSupabaseHealth(): Promise<SupabaseHealthResponse> {
  const res = await fetch('/api/supabase/health', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`Supabase health failed (${res.status})`)
  return res.json()
}

/** Ops dashboard: which Secrets Store bindings resolve (booleans only). */
export async function fetchConfigStatus(): Promise<ConfigStatusResponse> {
  const res = await fetch('/api/internal/config-status', { credentials: 'same-origin' })
  if (!res.ok) throw new Error(`Config status failed (${res.status})`)
  return res.json()
}

/**
 * Usage in a React client component:
 *
 * ```tsx
 * 'use client'
 * import { useEffect, useState } from 'react'
 * import { fetchStripeStatus } from '@/lib/api/secrets-client'
 *
 * export function StripeStatusBadge() {
 *   const [status, setStatus] = useState<'loading' | 'ok' | 'missing'>('loading')
 *   useEffect(() => {
 *     fetchStripeStatus()
 *       .then((s) => setStatus(s.configured ? 'ok' : 'missing'))
 *       .catch(() => setStatus('missing'))
 *   }, [])
 *   return <span>{status === 'ok' ? 'Stripe ready' : 'Stripe not configured'}</span>
 * }
 * ```
 */
