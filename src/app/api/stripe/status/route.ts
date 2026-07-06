import { NextResponse } from 'next/server'
import { requireStripeSecretKey } from '@/lib/stripe/getStripeSecretKey'

/**
 * Example Worker-backed route: validates Stripe secret from Secrets Store.
 * Returns metadata only — never exposes the secret key to the client.
 */
export async function GET() {
  try {
    const secretKey = await requireStripeSecretKey()
    const mode = secretKey.startsWith('sk_live_') ? 'live' : 'test'

    return NextResponse.json({
      configured: true,
      mode,
      keyPrefix: `${secretKey.slice(0, 7)}…`,
    })
  } catch {
    return NextResponse.json({ configured: false, mode: null }, { status: 503 })
  }
}
