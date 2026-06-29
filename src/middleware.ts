import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isPublicPath, isAuthRateBucket, STATIC_PREFIXES } from './middleware-helpers'

// Simple in-memory rate limiter for API routes
const rateMap = new Map<string, { count: number; resetAt: number }>()
const RATE_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_API = 120 // requests per window for API
const RATE_LIMIT_AUTH = 10 // requests per window for auth endpoints

function checkRateLimit(key: string, limit: number): boolean {
  const now = Date.now()
  const entry = rateMap.get(key)
  if (!entry || now > entry.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS })
    return true
  }
  entry.count++
  return entry.count <= limit
}

// Periodic cleanup to prevent memory leak
let lastCleanup = Date.now()
function cleanupRateMap() {
  const now = Date.now()
  if (now - lastCleanup < RATE_WINDOW_MS) return
  lastCleanup = now
  for (const [key, entry] of rateMap) {
    if (now > entry.resetAt) rateMap.delete(key)
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const response = NextResponse.next()

  // Security headers for all responses
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set(
    'Permissions-Policy',
    'camera=(self), microphone=(self), geolocation=()'
  )

  // Skip middleware for static assets
  if (STATIC_PREFIXES.some((p) => pathname.startsWith(p))) {
    return response
  }

  // Rate limiting for API routes
  if (pathname.startsWith('/api/')) {
    cleanupRateMap()
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
    const isAuthBucket = isAuthRateBucket(pathname)
    const limit = isAuthBucket ? RATE_LIMIT_AUTH : RATE_LIMIT_API
    const rateKey = `${ip}:${isAuthBucket ? 'auth' : 'api'}`

    if (!checkRateLimit(rateKey, limit)) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': '60' } }
      )
    }
  }

  // Auth check: if MUSASHI_DISABLE_AUTH is set, skip auth redirect (dev/local only).
  // In production, auth bypass is never honored even if the env var is mis-set.
  if (process.env.MUSASHI_DISABLE_AUTH === '1' && process.env.NODE_ENV !== 'production') {
    return response
  }

  // For protected routes (non-public), check for session cookie
  if (!isPublicPath(pathname)) {
    const sessionCookie = request.cookies.get('musashi_session')
    if (!sessionCookie?.value) {
      // API routes return 401, page routes redirect to login
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      const loginUrl = new URL('/login', request.url)
      loginUrl.searchParams.set('redirect', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  return response
}

export const config = {
  matcher: [
    // Match all routes except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
