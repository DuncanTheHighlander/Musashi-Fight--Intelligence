/**
 * After login/signup, send users to onboarding if incomplete, else home or
 * the original redirect target.
 */
export async function resolvePostAuthPath(fallback = '/'): Promise<string> {
  try {
    const res = await fetch('/api/auth/onboarding-status', { credentials: 'include' })
    if (!res.ok) return fallback
    const data = (await res.json()) as { complete?: boolean; redirectTo?: string }
    if (!data.complete) return data.redirectTo || '/onboarding'
    if (fallback === '/login' || fallback === '/signup' || fallback === '/welcome') return '/'
    return fallback || '/'
  } catch {
    return fallback
  }
}
