'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MusashiWordmark } from '@/components/icons/MusashiIcon'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setDevResetUrl(null)
    setLoading(true)

    try {
      const resp = await fetch('/api/auth/password/reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = (await resp.json()) as { error?: string; dryRun?: boolean; url?: string }
      if (!resp.ok) {
        setError(data.error || 'Request failed')
        return
      }
      setSent(true)
      if (data.dryRun && data.url) {
        setDevResetUrl(data.url)
      }
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
            <CardTitle className="text-2xl tracking-tight">Forgot password</CardTitle>
            <CardDescription>We&apos;ll email you a link to reset your password</CardDescription>
          </CardHeader>
          <CardContent>
            {sent ? (
              <div className="space-y-3">
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                  If an account exists for that email, a reset link has been sent.
                </div>
                {devResetUrl && (
                  <div className="rounded-md border border-border/60 bg-muted/40 p-3 text-sm">
                    <p className="mb-2 text-muted-foreground">Dev mode (no email provider): use this link:</p>
                    <Link href={devResetUrl} className="break-all font-medium text-primary hover:underline">
                      {devResetUrl}
                    </Link>
                  </div>
                )}
              </div>
            ) : (
              <form className="space-y-4" onSubmit={onSubmit}>
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
                {error && (
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                )}
                <Button type="submit" disabled={loading} className="h-11 w-full text-base shadow-md">
                  {loading ? 'Sending…' : 'Send reset link'}
                </Button>
              </form>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <div className="text-center text-sm text-muted-foreground">
              <Link href="/login" className="font-medium text-primary hover:underline">
                Back to sign in
              </Link>
            </div>
          </CardFooter>
        </Card>
      </div>
    </main>
  )
}
