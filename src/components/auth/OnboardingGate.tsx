'use client'

/**
 * Client gate: logged-in users without a fighter/coach profile are sent to
 * /onboarding before they can use the rest of the app shell.
 */
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useAuth } from '@/hooks/useAuth'
import { Loader2 } from 'lucide-react'

const SKIP_PREFIXES = ['/onboarding', '/login', '/signup', '/welcome', '/forgot-password', '/reset-password', '/verify-email', '/terms', '/privacy']

function shouldSkip(pathname: string): boolean {
  return SKIP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth()
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    if (authLoading) return

    if (!user || user.role === 'shogun' || shouldSkip(pathname)) {
      setAllowed(true)
      setChecking(false)
      return
    }

    let cancelled = false
    setChecking(true)
    ;(async () => {
      try {
        const res = await fetch('/api/auth/onboarding-status', { credentials: 'include' })
        if (!res.ok) {
          if (!cancelled) {
            setAllowed(true)
            setChecking(false)
          }
          return
        }
        const data = (await res.json()) as { complete?: boolean; redirectTo?: string }
        if (cancelled) return
        if (!data.complete) {
          router.replace(data.redirectTo || '/onboarding')
          setAllowed(false)
        } else {
          setAllowed(true)
        }
      } catch {
        if (!cancelled) setAllowed(true)
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, authLoading, pathname, router])

  if (authLoading || checking) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
      </div>
    )
  }

  if (!allowed) return null
  return <>{children}</>
}
