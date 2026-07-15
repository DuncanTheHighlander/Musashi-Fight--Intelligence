import { parseApiResponse } from '@/lib/safeJson'

export type MarketplaceFundResult = {
  redirected: boolean
  jobId: string
  status: string
  fundedInline?: boolean
}

export async function fundMarketplaceJob(
  jobId: string,
  urls?: { successUrl?: string; cancelUrl?: string; preferCheckout?: boolean },
): Promise<MarketplaceFundResult> {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const successUrl =
    urls?.successUrl || `${origin}/marketplace/jobs/${jobId}?funding=success`
  const cancelUrl =
    urls?.cancelUrl || `${origin}/marketplace/jobs/${jobId}?funding=cancelled`

  const fundRes = await fetch(`/api/social/jobs/${jobId}/fund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      successUrl,
      cancelUrl,
      preferCheckout: urls?.preferCheckout === true,
    }),
  })

  const funded = await parseApiResponse<{
    jobId: string
    status: string
    payment?: {
      requiresRedirect?: boolean
      checkoutUrl?: string | null
      fundedInline?: boolean
    }
  }>(fundRes)

  if (funded.payment?.fundedInline) {
    return {
      redirected: false,
      jobId: funded.jobId,
      status: funded.status,
      fundedInline: true,
    }
  }

  if (funded.payment?.requiresRedirect && funded.payment.checkoutUrl) {
    window.location.assign(funded.payment.checkoutUrl)
    return { redirected: true, jobId: funded.jobId, status: funded.status }
  }

  return { redirected: false, jobId: funded.jobId, status: funded.status }
}
