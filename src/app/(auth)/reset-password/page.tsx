'use client'

import React, { Suspense, useState } from 'react'
import Link from 'next/link'
import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MusashiWordmark } from '@/components/icons/MusashiIcon'

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-background p-4 text-muted-foreground">
          Loading…
        </main>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  )
}

function ResetPasswordContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const token = searchParams.get('token') || ''
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (!token) {
      setError('Missing reset token. Request a new password reset link.')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 10) {
      setError('Password must be at least 10 characters')
      return
    }

    setLoading(true)
    try {
      const resp = await fetch('/api/auth/password/reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })
      const data = (await resp.json()) as { error?: string }
      if (!resp.ok) {
        setError(data.error || 'Reset failed')
        return
      }
      setDone(true)
      setTimeout(() => router.push('/welcome'), 2000)
    } catch {
      setError('Network error. Try again in a moment.')
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
        </div>

        <Card className="border-border/60 bg-card/80 shadow-xl backdrop-blur-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl tracking-tight">Reset password</CardTitle>
            <CardDescription>Choose a new password for your Musashi account</CardDescription>
          </CardHeader>
          <CardContent>
            {done ? (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                Password updated. Redirecting to sign in…
              </div>
            ) : (
              <form className="space-y-4" onSubmit={onSubmit}>
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    className="h-10"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    className="h-10"
                    required
                  />
                </div>
                {error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <Button type="submit" disabled={loading || !token} className="h-11 w-full text-base shadow-md">
                  {loading ? 'Updating…' : 'Update password'}
                </Button>
              </form>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <div className="text-center text-sm text-muted-foreground">
              <Link href="/welcome" className="font-medium text-primary hover:underline">
                Back to sign in
              </Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    </main>
  )
}
