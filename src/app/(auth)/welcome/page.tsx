'use client'

/**
 * /welcome — auth-first front door. Sign in or create account (no card required).
 * Free trial: 2 AI clip analyses, 10s max; Pro unlocks 30s + weekly quota.
 */

import React, { Suspense, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useAuth } from '@/hooks/useAuth'
import { register } from '@/lib/auth'
import { resolvePostAuthPath } from '@/lib/authRedirect'
import { MusashiWordmark } from '@/components/icons/MusashiIcon'
import { FREE_LIFETIME_VIDEOS, FREE_MAX_VIDEO_SEC } from '@/lib/videoTierLimits'

type Mode = 'signin' | 'signup'

export default function WelcomePage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background p-4 text-muted-foreground">
          Loading…
        </main>
      }
    >
      <WelcomeContent />
    </Suspense>
  )
}

function WelcomeContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const redirectParam = searchParams.get('redirect') || '/'
  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin'
  const { login, checkSession, user, loading: authLoading } = useAuth()

  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (authLoading || !user) return
    let cancelled = false
    ;(async () => {
      const dest = await resolvePostAuthPath(redirectParam)
      if (!cancelled) router.replace(dest)
    })()
    return () => {
      cancelled = true
    }
  }, [user, authLoading, redirectParam, router])

  const onSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      const dest = await resolvePostAuthPath(redirectParam)
      router.push(dest)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const onSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }
    if (password.length < 10) {
      setError('Password must be at least 10 characters')
      return
    }
    if (!/[A-Z]/.test(password)) {
      setError('Password must contain an uppercase letter')
      return
    }
    if (!/[a-z]/.test(password)) {
      setError('Password must contain a lowercase letter')
      return
    }
    if (!/[0-9]/.test(password)) {
      setError('Password must contain a number')
      return
    }
    if (!acceptTerms) {
      setError('You must accept the terms and conditions')
      return
    }

    setLoading(true)
    try {
      await register({
        email,
        password,
        display_name: displayName || undefined,
      })
      await checkSession()
      router.push('/onboarding')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5" />
      <div className="pointer-events-none absolute inset-0 bg-[url('/grid.svg')] opacity-[0.05]" />

      <div className="relative w-full max-w-md space-y-6">
        <div className="flex flex-col items-center gap-3">
          <MusashiWordmark height={64} />
          <div className="flex items-center gap-3 text-muted-foreground/50">
            <span className="h-px w-10 bg-gradient-to-r from-transparent to-primary/40" />
            <span className="h-1.5 w-1.5 rotate-45 bg-primary/40" />
            <span className="h-px w-10 bg-gradient-to-l from-transparent to-primary/40" />
          </div>
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            Sign in or create a free account — no card required. Try {FREE_LIFETIME_VIDEOS} AI
            clips ({FREE_MAX_VIDEO_SEC}s each), then upgrade for 30s Pro analysis.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border/60 bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => {
              setMode('signin')
              setError(null)
            }}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              mode === 'signin' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => {
              setMode('signup')
              setError(null)
            }}
            className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
              mode === 'signup' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            Create account
          </button>
        </div>

        <Card className="border-border/60 bg-card/80 shadow-xl backdrop-blur-sm">
          {mode === 'signin' ? (
            <>
              <CardHeader className="space-y-1">
                <CardTitle className="text-2xl tracking-tight">Welcome back</CardTitle>
                <CardDescription>Sign in to your Musashi account</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={onSignIn}>
                  <div className="space-y-2">
                    <Label htmlFor="welcome-email">Email</Label>
                    <Input
                      id="welcome-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      className="h-10"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="welcome-password">Password</Label>
                      <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                        Forgot password?
                      </Link>
                    </div>
                    <Input
                      id="welcome-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="current-password"
                      className="h-10"
                      required
                    />
                  </div>
                  {error && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  )}
                  <Button type="submit" disabled={loading} className="h-11 w-full text-base shadow-md">
                    {loading ? 'Signing in…' : 'Sign in'}
                  </Button>
                </form>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className="space-y-1">
                <CardTitle className="text-2xl tracking-tight">Create account</CardTitle>
                <CardDescription>No credit card — {FREE_LIFETIME_VIDEOS} free AI clips to start</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-4" onSubmit={onSignUp}>
                  <div className="space-y-2">
                    <Label htmlFor="welcome-signup-email">Email</Label>
                    <Input
                      id="welcome-signup-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      className="h-10"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="welcome-displayName">
                      Display Name <span className="text-muted-foreground/60">(optional)</span>
                    </Label>
                    <Input
                      id="welcome-displayName"
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Fighter name"
                      autoComplete="name"
                      className="h-10"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="welcome-signup-password">Password</Label>
                    <Input
                      id="welcome-signup-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoComplete="new-password"
                      className="h-10"
                      required
                    />
                    <div className="text-[11px] text-muted-foreground/80">
                      Minimum 10 characters, with uppercase, lowercase, and a number.
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="welcome-confirm">Confirm Password</Label>
                    <Input
                      id="welcome-confirm"
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      className="h-10"
                      required
                    />
                  </div>
                  <div className="flex items-start space-x-2">
                    <Checkbox
                      id="welcome-terms"
                      checked={acceptTerms}
                      onCheckedChange={(checked) => setAcceptTerms(checked as boolean)}
                    />
                    <label htmlFor="welcome-terms" className="text-sm leading-snug">
                      I accept the{' '}
                      <Link href="/terms" className="font-medium text-primary hover:underline">
                        terms and conditions
                      </Link>
                    </label>
                  </div>
                  {error && (
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      {error}
                    </div>
                  )}
                  <Button type="submit" disabled={loading} className="h-11 w-full text-base shadow-md">
                    {loading ? 'Creating account…' : 'Create account'}
                  </Button>
                </form>
              </CardContent>
              <CardFooter>
                <p className="w-full text-center text-xs text-muted-foreground">
                  Clips over {FREE_MAX_VIDEO_SEC}s are trimmed in-app before analysis.
                </p>
              </CardFooter>
            </>
          )}
        </Card>
      </div>
    </main>
  )
}
