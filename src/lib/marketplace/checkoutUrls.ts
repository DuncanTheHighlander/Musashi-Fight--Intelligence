/**
 * Stripe Checkout return URLs must stay on the request origin to prevent open redirects.
 */
export function resolveSameOriginCheckoutUrl(
  req: Request,
  candidate: string | null | undefined,
  defaultPath: string,
): string {
  const origin = new URL(req.url).origin
  const path = defaultPath.startsWith('/') ? defaultPath : `/${defaultPath}`
  const fallback = `${origin}${path}`

  const raw = String(candidate || '').trim()
  if (!raw) return fallback

  try {
    const resolved = raw.startsWith('/') ? new URL(raw, origin) : new URL(raw)
    if (resolved.origin !== origin) return fallback
    return resolved.toString()
  } catch {
    return fallback
  }
}
