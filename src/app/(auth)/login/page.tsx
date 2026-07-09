'use client'

import { Suspense, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Loader2 } from 'lucide-react'

/** Legacy /login → auth-first /welcome (preserves ?redirect=). */
export default function LoginRedirectPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </main>
      }
    >
      <LoginRedirectContent />
    </Suspense>
  )
}

function LoginRedirectContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const redirect = searchParams.get('redirect')
    const qs = new URLSearchParams()
    qs.set('mode', 'signin')
    if (redirect) qs.set('redirect', redirect)
    router.replace(`/welcome?${qs.toString()}`)
  }, [router, searchParams])

  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Redirecting" />
    </main>
  )
}
