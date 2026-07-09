export const PUBLIC_PATHS = [
  '/welcome',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/terms',
  '/privacy',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/me',
  '/api/auth/password/reset/request',
  '/api/auth/password/reset/confirm',
  '/api/auth/email/verify/confirm',
  '/api/billing/webhook',
  '/api/health',
]

export const STATIC_PREFIXES = ['/_next', '/favicon', '/manifest', '/fonts', '/images']

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true
  if (STATIC_PREFIXES.some((p) => pathname.startsWith(p))) return true
  if (pathname.match(/\.(ico|png|jpg|jpeg|svg|webp|woff2?|ttf|css|js|map)$/)) return true
  return false
}

/**
 * Login / register / logout share the tight auth rate bucket.
 * /api/auth/me is excluded — AuthContext polls it on mount and focus.
 */
export function isAuthRateBucket(pathname: string): boolean {
  if (!pathname.startsWith('/api/auth/')) return false
  if (pathname === '/api/auth/me') return false
  return true
}
