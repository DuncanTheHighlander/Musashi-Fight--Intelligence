/**
 * After login/signup, send users to onboarding if incomplete, else home or
 * the original redirect target. Admins (shogun) go to /shogun.
 */
export async function resolvePostAuthPath(fallback = '/'): Promise<string> {
  try {
    const res = await fetch('/api/auth/onboarding-status', { credentials: 'include' })
    if (!res.ok) return fallback
    const data = (await res.json()) as { complete?: boolean; redirectTo?: string }
    if (!data.complete) return data.redirectTo || '/onboarding'
    // Prefer explicit post-auth destination from the API (e.g. admin → /shogun)
    if (typeof data.redirectTo === 'string' && data.redirectTo.startsWith('/') && data.redirectTo !== '/onboarding') {
      if (data.redirectTo !== '/') return data.redirectTo
    }
    if (fallback === '/login' || fallback === '/signup' || fallback === '/welcome') return '/'
    return fallback || '/'
  } catch {
    return fallback
  }
}
