'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAuth } from '@/hooks/useAuth'
import { ArrowRight } from 'lucide-react'

type OnboardingStatus = {
  complete?: boolean
  needsProfileNudge?: boolean
}

export function ProfileCompletionBanner() {
  const { user, loading } = useAuth()
  const pathname = usePathname()
  const [status, setStatus] = useState<OnboardingStatus | null>(null)

  useEffect(() => {
    if (loading || !user || pathname === '/onboarding') {
      setStatus(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/onboarding-status', { credentials: 'include' })
        if (!res.ok) return
        const data = (await res.json()) as OnboardingStatus
        if (!cancelled) setStatus(data)
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, loading, pathname])

  if (!user || pathname === '/onboarding') return null
  if (status?.complete !== false && !status?.needsProfileNudge) return null

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
      <div className="container mx-auto flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="text-foreground/90">
          Complete your fighter or coach profile to unlock marketplace features.
        </p>
        <Link
          href="/onboarding"
          className="inline-flex items-center gap-1 font-medium text-amber-700 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
        >
          Finish setup
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}
