'use client'

import React, { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { MusashiWordmark } from '@/components/icons/MusashiIcon'

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background p-4 text-muted-foreground">
          Loading…
        </main>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  )
}

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setStatus('error')
      setMessage('Missing verification link. Check your email for a valid link.')
      return
    }

    let cancelled = false
    const verify = async () => {
      setStatus('loading')
      try {
        const resp = await fetch('/api/auth/email/verify/confirm', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        const data = (await resp.json()) as { error?: string }
        if (cancelled) return
        if (!resp.ok) {
          setStatus('error')
          setMessage(data.error || 'Verification failed')
          return
        }
        setStatus('success')
        setMessage('Your email is verified. You can sign in and continue.')
      } catch {
        if (!cancelled) {
          setStatus('error')
          setMessage('Network error. Try again in a moment.')
        }
      }
    }

    void verify()
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5" />
      <div className="pointer-events-none absolute inset-0 bg-[url('/grid.svg')] opacity-[0.05]" />

      <div className="relative w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <MusashiWordmark height={64} />
        </div>

        <Card className="border-border/60 bg-card/80 shadow-xl backdrop-blur-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl tracking-tight">Verify email</CardTitle>
            <CardDescription>
              {status === 'loading' ? 'Confirming your email address…' : 'Email verification'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {status === 'loading' && (
              <p className="text-sm text-muted-foreground">Please wait while we verify your link.</p>
            )}
            {status === 'success' && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                {message}
              </div>
            )}
            {status === 'error' && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {message}
              </div>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            {status === 'success' && (
              <Button asChild className="h-11 w-full">
                <Link href="/login">Sign in</Link>
              </Button>
            )}
            {status === 'error' && (
              <Button asChild variant="outline" className="h-11 w-full">
                <Link href="/login">Back to sign in</Link>
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </main>
  )
}
