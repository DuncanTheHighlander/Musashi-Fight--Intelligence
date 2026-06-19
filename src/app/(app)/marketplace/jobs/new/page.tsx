'use client'

/**
 * /marketplace/jobs/new — post a bounty form.
 *
 * MVP flow:
 *   1. Fighter fills title + brief + budget + (optional) video URLs.
 *   2. POST /api/social/jobs creates status=CREATED.
 *   3. Client immediately POSTs /fund which writes HOLD + flips to FUNDED.
 *      (Stripe call is stubbed — the ledger records pending_stripe.)
 *   4. Redirect to the job detail.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { parseApiResponse } from '@/lib/safeJson'
import { centsFromDollars, formatCents } from '@/lib/currency'
import { ArrowLeft, Briefcase, Upload } from 'lucide-react'
import { SectionHeader } from '@/components/ui/section-header'
import type { BeltTier } from '@/components/marketplace/BeltBadge'
import { platformFeeBps } from '@/lib/marketplace/beltTier'
import { computeFeeSplit } from '@/lib/marketplace/ledger'

const BELT_OPTIONS: { value: BeltTier; label: string }[] = [
  { value: 'white',  label: 'Any coach' },
  { value: 'blue',   label: 'Blue belt or higher' },
  { value: 'purple', label: 'Purple belt or higher' },
  { value: 'brown',  label: 'Brown belt or higher' },
  { value: 'black',  label: 'Black belt or higher' },
]

export default function NewJobPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { toast } = useToast()

  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [budget, setBudget] = useState<string>('50')
  const [requiredBeltTier, setRequiredBeltTier] = useState<BeltTier>('blue')
  const [videos, setVideos] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)

  const amountCents = centsFromDollars(budget)
  const feeBps = platformFeeBps(requiredBeltTier)
  const { platformFeeCents: feeEstimate, analystPayoutCents: payoutEstimate } =
    computeFeeSplit(amountCents, feeBps)
  const feePercentLabel = (feeBps / 100).toFixed(1)

  if (!authLoading && !user) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <Card>
          <CardContent className="py-10 text-center space-y-3">
            <h2 className="text-lg font-semibold">Log in to post a bounty</h2>
            <Button onClick={() => router.push('/login')}>Log In</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) {
      toast({ title: 'Title required', variant: 'destructive' })
      return
    }
    if (amountCents < 100) {
      toast({ title: 'Minimum budget is $1.00', variant: 'destructive' })
      return
    }
    setSubmitting(true)
    try {
      const videoList = videos
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)

      // Step 1 — create
      const createRes = await fetch('/api/social/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          jobType: 'open_bounty',
          title: title.trim(),
          brief: brief.trim(),
          amountCents,
          requiredBeltTier,
          videos: videoList,
          clientRequestId: crypto.randomUUID(),
        }),
      })
      const created = await parseApiResponse<{ job: { id: string } }>(createRes)
      const jobId = created.job.id

      // Step 2 — fund (Stripe stub — ledger row pending)
      const fundRes = await fetch(`/api/social/jobs/${jobId}/fund`, {
        method: 'POST',
        credentials: 'include',
      })
      await parseApiResponse(fundRes)

      toast({
        title: 'Bounty posted',
        description: 'Verified analysts can now claim it.',
      })
      router.push(`/marketplace/jobs/${jobId}`)
    } catch (err) {
      toast({
        title: 'Failed to post bounty',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-8 lg:px-6 lg:py-10">
      <Button asChild variant="ghost" size="sm" className="mb-4">
        <Link href="/marketplace">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to marketplace
        </Link>
      </Button>

      <SectionHeader
        icon={Briefcase}
        eyebrow="New Bounty"
        title="Post a Bounty"
        subtitle="Describe what you need analyzed. An analyst will claim it, deliver, and you review."
        className="mb-6"
      />

      <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="text-sm font-medium mb-1.5 block">Title</label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Break down my sparring footage vs. southpaw"
                maxLength={120}
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Brief</label>
              <Textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="What do you want the coach to focus on? Footwork, guard, specific round..."
                rows={5}
                maxLength={2000}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Video URLs <span className="text-muted-foreground font-normal">(one per line)</span>
              </label>
              <Textarea
                value={videos}
                onChange={(e) => setVideos(e.target.value)}
                placeholder="https://..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Upload className="h-3 w-3" />
                Direct upload coming soon — paste a shareable link for now.
              </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Budget (USD)</label>
                <Input
                  type="number"
                  min={1}
                  step="0.01"
                  value={budget}
                  onChange={(e) => setBudget(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Minimum Belt</label>
                <Select
                  value={requiredBeltTier}
                  onValueChange={(v) => setRequiredBeltTier(v as BeltTier)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BELT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Card className="bg-muted/40 border-dashed">
              <CardContent className="py-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span>Escrow total</span>
                  <span className="font-semibold">{formatCents(amountCents)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground text-xs">
                  <span>Platform fee (~{feePercentLabel}%)</span>
                  <span>{formatCents(feeEstimate)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground text-xs">
                  <span>Analyst payout (estimated)</span>
                  <span>{formatCents(payoutEstimate)}</span>
                </div>
              </CardContent>
            </Card>

            <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-400">
              <strong>Test mode:</strong> Stripe isn&apos;t wired yet. Posting creates the job and
              a pending escrow entry; no real card is charged.
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Posting...' : 'Post Bounty'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
