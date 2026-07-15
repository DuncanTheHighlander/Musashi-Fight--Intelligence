'use client'

/**
 * /marketplace/jobs/new — post a bounty form.
 *
 * Flow:
 *   1. Fighter fills title + brief + budget + (optional) video.
 *   2. POST /api/social/jobs creates status=CREATED.
 *   3. POST /fund — mock funds immediately; stripe redirects to Checkout.
 *   4. Redirect to job detail (or Stripe).
 */

import { useEffect, useState } from 'react'
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
import { ArrowLeft, Video } from 'lucide-react'
import { SectionHeader } from '@/components/ui/section-header'
import type { BeltTier } from '@/components/marketplace/BeltBadge'
import { platformFeeBps } from '@/lib/marketplace/beltTier'
import { computeFeeSplit } from '@/lib/marketplace/ledger'
import { UploadDropzone } from '@/components/marketplace/UploadDropzone'
import { fundMarketplaceJob } from '@/lib/marketplace/fundClient'

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
  const [videoAssetIds, setVideoAssetIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [paymentMode, setPaymentMode] = useState<'mock' | 'stripe' | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/social/marketplace/config')
      .then(async (res) => {
        if (!res.ok) return null
        return (await res.json()) as { payments?: string }
      })
      .then((data) => {
        if (!cancelled && data?.payments) {
          setPaymentMode(data.payments === 'stripe' ? 'stripe' : 'mock')
        }
      })
      .catch(() => {
        if (!cancelled) setPaymentMode('mock')
      })
    return () => { cancelled = true }
  }, [])

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
            <Button onClick={() => router.push('/welcome')}>Log In</Button>
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
    if (amountCents < 5000) {
      toast({ title: 'Minimum budget is $50.00', variant: 'destructive' })
      return
    }
    const videoList = videos.split('\n').map((s) => s.trim()).filter(Boolean)
    if (videoList.length === 0 && videoAssetIds.length === 0) {
      toast({
        title: 'Upload your clip',
        description: 'Add at least one video file or URL so the coach can review your footage.',
        variant: 'destructive',
      })
      return
    }
    setSubmitting(true)
    try {
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
          assetIds: videoAssetIds,
          clientRequestId: crypto.randomUUID(),
        }),
      })
      const created = await parseApiResponse<{ job: { id: string } }>(createRes)
      const jobId = created.job.id

      const funded = await fundMarketplaceJob(jobId)
      if (funded.redirected) {
        toast({
          title: 'Finish payment',
          description: 'Redirecting to Stripe Checkout.',
        })
        return
      }

      toast({
        title: 'Clip posted',
        description: 'A coach will claim this and send a video breakdown back.',
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
        icon={Video}
        eyebrow="Clip review"
        title="Get coach feedback on your clip"
        subtitle="Upload sparring or technique footage. A verified coach analyzes it and sends a video breakdown back to you."
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
                placeholder="e.g. Review my jab-cross timing in round 2 sparring"
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
                Your clip <span className="text-destructive">*</span>
              </label>
              <UploadDropzone
                purpose="job_video"
                accept="video/mp4,video/quicktime,video/webm"
                label="Upload your fight clip"
                hint="Sparring, pad work, or competition — MP4, MOV, or WebM up to 500 MB."
                onUploaded={(asset) => setVideoAssetIds((prev) => [...prev, asset.id])}
                onRemoved={(assetId) =>
                  setVideoAssetIds((prev) => prev.filter((id) => id !== assetId))
                }
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Video URLs <span className="text-muted-foreground font-normal">(optional fallback)</span>
              </label>
              <Textarea
                value={videos}
                onChange={(e) => setVideos(e.target.value)}
                placeholder="https://..."
                rows={3}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Paste shareable links if direct upload is unavailable in your environment.
              </p>
            </div>

            <div className="grid gap-4">
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

            <p className="text-xs text-muted-foreground">
              Coaches reply with a <strong>video breakdown</strong> (not just text). You approve before payment releases.
            </p>

            {paymentMode === 'mock' && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-400">
                <strong>Dev mode:</strong> Payments are simulated — no real card is charged.
                Escrow is recorded instantly so you can test the full job flow.
              </div>
            )}
            {paymentMode === 'stripe' && (
              <div className="rounded-md bg-emerald-500/10 border border-emerald-500/30 p-3 text-xs text-emerald-700 dark:text-emerald-400">
                You&apos;ll be redirected to Stripe Checkout to fund escrow before analysts can claim.
              </div>
            )}

            <div className="flex flex-wrap gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Posting…' : 'Request clip review'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
