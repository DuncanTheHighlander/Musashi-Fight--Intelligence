'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { parseApiResponse } from '@/lib/safeJson'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, Check, Crown, Loader2 } from 'lucide-react'
import { SectionHeader, SectionShell } from '@/components/ui/section-header'

// Display-only labels. The actual billed amount is controlled by the Stripe
// price (MUSASHI_STRIPE_PRICE_ID_PRO) — keep this in sync with Stripe.
const FREE_PRICE_LABEL = '$0'
const PRO_PRICE_LABEL = '$19'

const FREE_FEATURES = [
  'Daily AI analysis quota',
  'Fight Lab skeleton tracking',
  'Basic chat & coaching limits',
]

const PRO_FEATURES = [
  'Higher analyze, chat, reflex & track quotas',
  'Higher per-minute rate limit',
  'Faster iteration, fewer interruptions',
]

export default function PricingPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [active, setActive] = useState<boolean | null>(null)

  const loadStatus = async () => {
    try {
      const res = await fetch('/api/billing/status', { method: 'GET' })
      if (res.status === 401) {
        setActive(null)
        return
      }
      const data: any = await res.json()
      setActive(Boolean(data?.active))
    } catch {
      setActive(null)
    }
  }

  useEffect(() => {
    void loadStatus()
  }, [])

  const onUpgrade = async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/billing/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: 'pro' }),
      })

      if (res.status === 401) {
        window.location.href = '/login'
        return
      }

      const data: any = await parseApiResponse(res)
      if (!res.ok) throw new Error(data?.error || 'Unable to start checkout')

      if (data?.url) {
        window.location.href = String(data.url)
        return
      }
      throw new Error('Missing checkout URL')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to start checkout')
    } finally {
      setLoading(false)
    }
  }

  const onManageBilling = async () => {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/billing/create-portal-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl: window.location.origin + '/' }),
      })

      if (res.status === 401) {
        window.location.href = '/login'
        return
      }

      const data: any = await parseApiResponse(res)
      if (!res.ok) throw new Error(data?.error || 'Unable to open billing portal')
      if (data?.url) {
        window.location.href = String(data.url)
        return
      }
      throw new Error('Missing portal URL')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to open billing portal')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SectionShell maxWidth="5xl">
      <SectionHeader
        icon={Crown}
        iconAccent="gold"
        eyebrow="Plans & Billing"
        title="Pricing"
        subtitle="Upgrade for higher daily limits and faster iteration."
        action={
          <Button asChild variant="ghost" className="h-10 text-muted-foreground hover:text-foreground">
            <Link href="/">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Fight Lab
            </Link>
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:gap-6">
        <Card className="musashi-card-lift flex flex-col border-border/60 bg-card/60">
          <CardHeader className="space-y-1.5">
            <CardTitle className="text-xl">Free</CardTitle>
            <CardDescription>Good for learning and quick checks.</CardDescription>
            <div className="flex items-baseline gap-1 pt-1">
              <span className="text-4xl font-bold tracking-tight">{FREE_PRICE_LABEL}</span>
              <span className="text-sm text-muted-foreground">/month</span>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="space-y-2.5 text-sm">
              {FREE_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-muted-foreground">{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            <Button variant="secondary" className="h-10 w-full" asChild>
              <Link href="/">Use Free</Link>
            </Button>
          </CardFooter>
        </Card>

        <Card className="musashi-card-lift relative flex flex-col border-primary/40 bg-card shadow-lg shadow-primary/10">
          <Badge className="absolute -top-2.5 right-4 border-0 bg-primary px-2.5 text-[11px] uppercase tracking-wider text-primary-foreground">
            Recommended
          </Badge>
          <CardHeader className="space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-xl">
              Pro
              {active && (
                <Badge variant="secondary" className="border-0 bg-green-600/15 text-xs normal-case tracking-normal text-green-600 dark:text-green-400">
                  Current plan
                </Badge>
              )}
            </CardTitle>
            <CardDescription>More reps, more coaching, fewer interruptions.</CardDescription>
            <div className="flex items-baseline gap-1 pt-1">
              <span className="text-4xl font-bold tracking-tight">{PRO_PRICE_LABEL}</span>
              <span className="text-sm text-muted-foreground">/month</span>
            </div>
          </CardHeader>
          <CardContent className="flex-1">
            <ul className="space-y-2.5 text-sm">
              {PRO_FEATURES.map((feature) => (
                <li key={feature} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </CardContent>
          <CardFooter>
            {active ? (
              <Button className="h-10 w-full shadow-md" disabled={loading} onClick={onManageBilling}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {loading ? 'Opening…' : 'Manage billing'}
              </Button>
            ) : (
              <Button className="h-10 w-full shadow-md" disabled={loading} onClick={onUpgrade}>
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {loading ? 'Redirecting…' : 'Upgrade to Pro'}
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>

      {error && (
        <div role="alert" className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Billing is handled securely through Stripe. You can cancel anytime from the billing portal.
      </p>
    </SectionShell>
  )
}
