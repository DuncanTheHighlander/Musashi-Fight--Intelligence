export const PUBLIC_PATHS = [
  '/',
  '/login',
  '/signup',
  '/terms',
  '/privacy',
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/me',
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
