import { NextResponse } from 'next/server'
import { resolveMarketplacePaymentMode } from '@/lib/marketplace/payments'
import { resolveStorageMode } from '@/lib/storage/r2'
import { isStripeConfigured } from '@/lib/stripe/getStripeSecretKey'

function storageConfigured(): boolean {
  return Boolean(
    process.env.STORAGE_SERVICE_URL?.trim() &&
      process.env.STORAGE_ACCESS_KEY?.trim() &&
      process.env.STORAGE_SECRET_KEY?.trim() &&
      process.env.STORAGE_BUCKET_NAME?.trim(),
  )
}

export async function GET() {
  const payments = await resolveMarketplacePaymentMode()
  const storage = resolveStorageMode()
  const stripeConfigured = await isStripeConfigured()
  return NextResponse.json({
    payments,
    storage,
    stripeConfigured,
    storageConfigured: storageConfigured(),
  })
}
