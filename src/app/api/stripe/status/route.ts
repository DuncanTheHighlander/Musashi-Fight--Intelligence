import { NextResponse } from 'next/server'
import { requireStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'
import { requireUser } from '@/lib/musashiAuth'

/**
 * Worker-backed route: validates Stripe secret from Secrets Store.
 * Shogun-only; returns metadata only — never exposes the secret key.
 */
export async function GET(request: Request) {
  try {
    await requireUser(request, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const secretKey = await requireStripeSecretKey()
    const mode = secretKey.startsWith('sk_live_') ? 'live' : 'test'

    return NextResponse.json({
      configured: true,
      mode,
    })
  } catch {
    return NextResponse.json({ configured: false, mode: null }, { status: 503 })
  }
}
