'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { MusashiWordmark } from '@/components/icons/MusashiIcon'

export default function LoginPage() {
  const router = useRouter()
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await login(email, password)
      router.push('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4 text-foreground">
      {/* Ambient backdrop — soft primary gradient + faint grid, matches the
          hero treatment so the auth page doesn't feel disconnected. */}
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
        </div>

        <Card className="border-border/60 bg-card/80 shadow-xl backdrop-blur-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl tracking-tight">Welcome back</CardTitle>
            <CardDescription>Sign in to your Musashi account</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onLogin}>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
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
                  <Label htmlFor="password">Password</Label>
                  <Link href="/forgot-password" className="text-xs font-medium text-primary hover:underline">
                    Forgot password?
                  </Link>
                </div>
                <Input
                  id="password"
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
          <CardFooter className="flex flex-col gap-3">
            <div className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{' '}
              <Link href="/signup" className="font-medium text-primary hover:underline">
                Sign up
              </Link>
            </div>
          </CardFooter>
        </Card>

        <div className="text-center">
          <Link href="/" className="text-sm text-muted-foreground/80 transition-colors hover:text-foreground">
            ← Back to home
          </Link>
        </div>
      </div>
    </main>
  )
}
