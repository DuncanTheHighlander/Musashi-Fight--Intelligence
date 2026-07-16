import { NextResponse } from 'next/server'
import { getSecretsAvailability } from '@/lib/cloudflare/secrets'
import { requireUser } from '@/lib/musashiAuth'

/**
 * Server-only health check: reports which Secrets Store bindings resolve,
 * without returning secret values. Admin (shogun) only.
 */
export async function GET(request: Request) {
  try {
    await requireUser(request, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const availability = await getSecretsAvailability()

  return NextResponse.json({
    secretsStore: {
      ai: availability.SECRET_AI,
      modal: availability.SECRET_MODAL,
      revcat1: availability.SECRET_REVCAT1,
      revcat2: availability.SECRET_REVCAT2,
      stripe: availability.SECRET_STRIPE,
      supabase: availability.SECRET_SUPABASE,
      email: availability.SECRET_EMAIL,
    },
    supabaseUrlPublic: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()),
  })
}
