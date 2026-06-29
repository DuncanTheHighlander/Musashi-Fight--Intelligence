import { NextResponse } from 'next/server'
import { getSecretsAvailability } from '@/lib/cloudflare/secrets'

/**
 * Server-only health check: reports which Secrets Store bindings resolve,
 * without returning secret values. Safe for ops dashboards (protect in prod).
 */
export async function GET() {
  const availability = await getSecretsAvailability()

  return NextResponse.json({
    secretsStore: {
      ai: availability.SECRET_AI,
      modal: availability.SECRET_MODAL,
      revcat1: availability.SECRET_REVCAT1,
      revcat2: availability.SECRET_REVCAT2,
      stripe: availability.SECRET_STRIPE,
      supabase: availability.SECRET_SUPABASE,
    },
    supabaseUrlPublic: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
  })
}
