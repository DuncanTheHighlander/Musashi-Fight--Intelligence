'use client'

import React, { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { User, Mail, Shield, Calendar, Activity, Loader2, TriangleAlert, ShieldCheck } from 'lucide-react'
import { useSection } from '@/contexts/SectionContext'
import { SectionShell } from '@/components/ui/section-header'
import { parseApiResponse } from '@/lib/safeJson'
import { sendVerificationEmail } from '@/lib/auth'
import Link from 'next/link'

/** In-app account deletion — required by Apple 5.1.1(v) and Google Play for
 *  apps with account creation. Two-step: reveal, then password + confirm. */
function DangerZoneCard({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onDelete = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setDeleting(true)
    try {
      const res = await fetch('/api/auth/account', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data?.error || 'Unable to delete account')
      // Session is revoked server-side; full reload clears all client state.
      window.location.href = '/'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete account')
      setDeleting(false)
    }
  }

  return (
    <Card className="mt-5 border-destructive/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg text-destructive">
          <TriangleAlert className="h-5 w-5" />
          Danger Zone
        </CardTitle>
        <CardDescription>
          Permanently delete your account, videos, analyses, and personal data. This cannot be undone.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isAdmin ? (
          <p className="text-sm text-muted-foreground">Admin accounts cannot be deleted from the app.</p>
        ) : !open ? (
          <Button variant="outline" className="h-10 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={() => setOpen(true)}>
            Delete account…
          </Button>
        ) : (
          <form className="max-w-sm space-y-3" onSubmit={onDelete}>
            <div className="space-y-2">
              <Label htmlFor="delete-password">Confirm your password to delete your account</Label>
              <Input
                id="delete-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-10"
                required
              />
            </div>
            {error && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="flex gap-2">
              <Button type="submit" variant="destructive" className="h-10" disabled={deleting || !password}>
                {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {deleting ? 'Deleting…' : 'Permanently delete'}
              </Button>
              <Button type="button" variant="ghost" className="h-10" disabled={deleting} onClick={() => { setOpen(false); setPassword(''); setError(null) }}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

/** View/withdraw consent to use uploaded footage for AI-improvement. See
 *  docs/PRIVACY_CONSENT_SPEC.md. Backed by GET/POST /api/auth/consent. */
function AiConsentCard() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [aiTraining, setAiTraining] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/consent', { credentials: 'include' })
        const data = await parseApiResponse<{ aiTraining: boolean }>(res)
        if (!cancelled) setAiTraining(Boolean(data.aiTraining))
      } catch {
        /* leave default; the toggle below still works */
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  async function update(next: boolean) {
    setAiTraining(next)
    setSaving(true)
    try {
      const res = await fetch('/api/auth/consent', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ aiTraining: next }),
      })
      await parseApiResponse(res)
      toast({ title: next ? 'Thanks — your footage may help improve the AI' : 'Preference saved' })
    } catch (err) {
      setAiTraining(!next)
      toast({
        title: 'Could not save preference',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="mt-5 border-border/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ShieldCheck className="h-5 w-5" />
          AI Improvement
        </CardTitle>
        <CardDescription>Whether your footage may be used to improve Musashi&apos;s AI coaching</CardDescription>
      </CardHeader>
      <CardContent>
        <label className="flex cursor-pointer items-start gap-3">
          <Checkbox
            checked={aiTraining}
            disabled={loading || saving}
            onCheckedChange={(v) => update(v === true)}
            className="mt-0.5"
          />
          <span className="text-sm">
            Use my footage and its analysis to help improve Musashi&apos;s AI coaching.
            <span className="block text-xs text-muted-foreground">
              You can turn this off anytime — see our{' '}
              <a href="/privacy" target="_blank" rel="noreferrer" className="underline">Privacy Policy</a>.
            </span>
          </span>
        </label>
      </CardContent>
    </Card>
  )
}

/** Prompt unverified users to confirm email (required for AI coaching in production). */
function EmailVerificationCard({
  email,
  verified,
  onVerifiedRefresh,
}: {
  email: string
  verified: boolean
  onVerifiedRefresh: () => Promise<void>
}) {
  const { toast } = useToast()
  const [sending, setSending] = useState(false)

  if (verified) {
    return (
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Mail className="h-5 w-5 text-primary" />
            Email
          </CardTitle>
          <CardDescription>
            <span className="text-emerald-600 dark:text-emerald-400">Verified</span> — {email}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const onResend = async () => {
    setSending(true)
    try {
      const result = await sendVerificationEmail()
      if (result.alreadyVerified) {
        await onVerifiedRefresh()
        toast({ title: 'Email already verified' })
        return
      }
      toast({
        title: 'Verification email sent',
        description: result.dryRun
          ? 'Email provider is in dry-run mode (dev). Check server logs for the link.'
          : `Check ${email} for a Musashi verification link.`,
      })
    } catch (err) {
      toast({
        title: 'Could not send email',
        description: err instanceof Error ? err.message : 'Try again later',
        variant: 'destructive',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Mail className="h-5 w-5 text-amber-600" />
          Verify your email
        </CardTitle>
        <CardDescription>
          Confirm <strong>{email}</strong> to unlock AI coaching analysis. Marketplace browsing still works.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button type="button" onClick={() => void onResend()} disabled={sending} className="h-10">
          {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {sending ? 'Sending…' : 'Resend verification email'}
        </Button>
      </CardContent>
    </Card>
  )
}

export default function ProfileSection() {
  const router = useRouter()
  const { user, loading, checkSession } = useAuth()
  const { setActiveSection } = useSection()

  useEffect(() => {
    if (!loading && !user) router.push('/welcome')
  }, [loading, router, user])

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="h-[600px] flex items-center justify-center">
          <div className="animate-pulse text-muted-foreground">Loading profile...</div>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  const initials = user.display_name
    ? user.display_name.substring(0, 2).toUpperCase()
    : user.email.substring(0, 2).toUpperCase()

  return (
    <SectionShell maxWidth="6xl">
      <header className="mb-8 flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        <Avatar className="h-20 w-20 ring-2 ring-primary/20">
          <AvatarFallback className="bg-primary/20 text-primary text-2xl font-semibold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="mb-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">Your Account</div>
          <h1 className="text-3xl font-bold tracking-tight truncate">{user.display_name}</h1>
          <p className="text-sm text-muted-foreground truncate">{user.email}</p>
        </div>
      </header>

      <div className="grid lg:grid-cols-2 gap-5 mb-5">
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <User className="h-5 w-5" />
              Account Information
            </CardTitle>
            <CardDescription>Your account details and status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Email</span>
              </div>
              <span className="font-medium">{user.email}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Shield className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Role</span>
              </div>
              <Badge variant={user.role === 'shogun' ? 'default' : 'secondary'}>
                {user.role || 'user'}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Display Name</span>
              </div>
              <span className="font-medium">{user.display_name}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-muted-foreground">Status</span>
              </div>
              <Badge variant="secondary" className="border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                Active
              </Badge>
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="h-5 w-5" />
              Activity
            </CardTitle>
            <CardDescription>Your platform activity and stats</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {[
              { label: 'Videos Analyzed', value: 0 },
              { label: 'AI Conversations', value: 0 },
              { label: 'Techniques Saved', value: 0 },
              { label: 'Training Sessions', value: 0 },
            ].map((row, i, arr) => (
              <div
                key={row.label}
                className={`flex items-center justify-between py-3 ${i < arr.length - 1 ? 'border-b border-border/40' : ''}`}
              >
                <span className="text-sm text-muted-foreground">{row.label}</span>
                <span className={`text-2xl font-bold tabular-nums ${row.value === 0 ? 'text-muted-foreground/60' : ''}`}>
                  {row.value === 0 ? '—' : row.value}
                </span>
              </div>
            ))}
            <p className="pt-3 text-xs text-muted-foreground/80">
              Activity totals update after your first analysis, conversation, or saved technique.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
          <CardDescription>Manage your account and preferences</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Button variant="outline" className="justify-start h-10" onClick={() => setActiveSection('coach')}>
              Start Analysis
            </Button>
            <Button variant="outline" className="justify-start h-10" onClick={() => setActiveSection('library')}>
              View Library
            </Button>
            <Button variant="outline" className="justify-start h-10" asChild>
              <Link href="/pricing">Billing &amp; plans</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <EmailVerificationCard
        email={user.email}
        verified={Boolean(user.emailVerifiedAt)}
        onVerifiedRefresh={checkSession}
      />
      <AiConsentCard />
      <DangerZoneCard isAdmin={user.role === 'shogun'} />
    </SectionShell>
  )
}
