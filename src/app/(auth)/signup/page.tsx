'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { register } from '@/lib/auth'
import { useAuth } from '@/hooks/useAuth'
import { MusashiWordmark } from '@/components/icons/MusashiIcon'

export default function SignupPage() {
  const router = useRouter()
  const { checkSession } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [acceptTerms, setAcceptTerms] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onSignup = async (e: React.FormEvent) => {
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
      router.push('/')
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
        </div>

        <Card className="border-border/60 bg-card/80 shadow-xl backdrop-blur-sm">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl tracking-tight">Create account</CardTitle>
            <CardDescription>Join the Musashi AI fight coaching platform</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={onSignup}>
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
                <Label htmlFor="displayName">Display Name <span className="text-muted-foreground/60">(optional)</span></Label>
                <Input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Fighter name"
                  autoComplete="name"
                  className="h-10"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
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
                <Label htmlFor="confirmPassword">Confirm Password</Label>
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

              <div className="flex items-start space-x-2">
                <Checkbox
                  id="terms"
                  checked={acceptTerms}
                  onCheckedChange={(checked) => setAcceptTerms(checked as boolean)}
                />
                <label
                  htmlFor="terms"
                  className="text-sm leading-snug peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                >
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
          <CardFooter className="flex flex-col gap-3">
            <div className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/login" className="font-medium text-primary hover:underline">
                Log in
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
