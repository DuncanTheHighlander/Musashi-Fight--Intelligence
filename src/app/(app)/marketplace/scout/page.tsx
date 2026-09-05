'use client'

/**
 * /marketplace/scout — post opponent scouting request with escrow.
 * Coach claims, analyzes opponent footage, sends video breakdown back.
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
import { ArrowLeft, Target } from 'lucide-react'
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

export default function ScoutOpponentPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { toast } = useToast()

  const [opponentName, setOpponentName] = useState('')
  const [location, setLocation] = useState('')
  const [fightDate, setFightDate] = useState('')
  const [weightClass, setWeightClass] = useState('')
  const [style, setStyle] = useState('')
  const [brief, setBrief] = useState('')
  const [yourVideos, setYourVideos] = useState('')
  const [opponentVideos, setOpponentVideos] = useState('')
  const [yourVideoAssetIds, setYourVideoAssetIds] = useState<string[]>([])
  const [budget, setBudget] = useState('75')
  const [requiredBeltTier, setRequiredBeltTier] = useState<BeltTier>('blue')
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
      .catch(() => { if (!cancelled) setPaymentMode('mock') })
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
            <h2 className="text-lg font-semibold">Log in to scout an opponent</h2>
            <Button onClick={() => router.push('/welcome')}>Log In</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!opponentName.trim() || !location.trim() || !brief.trim()) {
      toast({ title: 'Fill in opponent, event, and what you need analyzed', variant: 'destructive' })
      return
    }
    if (amountCents < 5000) {
      toast({ title: 'Minimum budget is $50.00', variant: 'destructive' })
      return
    }

    setSubmitting(true)
    try {
      const yourVideoList = yourVideos.split('\n').map((s) => s.trim()).filter(Boolean)
      const opponentVideoList = opponentVideos.split('\n').map((s) => s.trim()).filter(Boolean)

      const scoutRes = await fetch('/api/social/scouting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          opponentName: opponentName.trim(),
          location: location.trim(),
          description: brief.trim(),
          fightDate: fightDate || null,
          budget: amountCents / 100,
          videos: yourVideoList,
          opponentVideos: opponentVideoList,
          opponentInfo: {
            weightClass: weightClass.trim(),
            style: style.trim(),
            record: '',
            notableFights: [],
          },
        }),
      })
      const scout = await parseApiResponse<{ id: string }>(scoutRes)

      const createRes = await fetch('/api/social/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          jobType: 'open_bounty',
          scoutingRequestId: scout.id,
          title: `Scout opponent: ${opponentName.trim()}`,
          brief: [
            `Event: ${location.trim()}${fightDate ? ` · ${fightDate}` : ''}`,
            weightClass.trim() ? `Weight: ${weightClass.trim()}` : '',
            style.trim() ? `Style: ${style.trim()}` : '',
            '',
            brief.trim(),
          ].filter(Boolean).join('\n'),
          amountCents,
          requiredBeltTier,
          videos: [...yourVideoList, ...opponentVideoList],
          assetIds: yourVideoAssetIds,
          clientRequestId: crypto.randomUUID(),
        }),
      })
      const created = await parseApiResponse<{ job: { id: string } }>(createRes)

      const funded = await fundMarketplaceJob(created.job.id)
      if (funded.redirected) {
        toast({ title: 'Finish payment', description: 'Redirecting to Stripe Checkout.' })
        return
      }

      toast({
        title: 'Scouting request posted',
        description: 'A coach will claim this and send you a video breakdown.',
      })
      router.push(`/marketplace/jobs/${created.job.id}`)
    } catch (err) {
      toast({
        title: 'Failed to post scouting request',
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
          Back to coaches
        </Link>
      </Button>

      <SectionHeader
        icon={Target}
        eyebrow="Opponent scouting"
        title="Scout an opponent"
        subtitle="Upload your footage and any opponent tape. A verified coach sends back a video breakdown with a game plan."
        className="mb-6"
      />

      <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
        <CardContent className="pt-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Opponent name</label>
                <Input
                  value={opponentName}
                  onChange={(e) => setOpponentName(e.target.value)}
                  placeholder="Who are you fighting?"
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Event / location</label>
                <Input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="Gym, tournament, etc."
                  required
                />
              </div>
            </div>

            <div className="grid gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Fight date</label>
                <Input type="date" value={fightDate} onChange={(e) => setFightDate(e.target.value)} />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Weight class</label>
                <Input value={weightClass} onChange={(e) => setWeightClass(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Their style</label>
                <Input value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Southpaw, wrestler…" />
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">What should the coach focus on?</label>
              <Textarea
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Patterns to watch, your concerns, rounds to prioritize…"
                rows={4}
                required
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">Your sparring / fight clips</label>
              <UploadDropzone
                purpose="job_video"
                accept="video/mp4,video/quicktime,video/webm"
                label="Upload your footage"
                hint="Your rounds — helps the coach tailor advice to you."
                onUploaded={(asset) => setYourVideoAssetIds((prev) => [...prev, asset.id])}
                onRemoved={(id) => setYourVideoAssetIds((prev) => prev.filter((x) => x !== id))}
              />
              <Textarea
                className="mt-2"
                value={yourVideos}
                onChange={(e) => setYourVideos(e.target.value)}
                placeholder="Or paste URLs to your clips (one per line)"
                rows={2}
              />
            </div>

            <div>
              <label className="text-sm font-medium mb-1.5 block">
                Opponent footage <span className="text-muted-foreground font-normal">(URLs)</span>
              </label>
              <Textarea
                value={opponentVideos}
                onChange={(e) => setOpponentVideos(e.target.value)}
                placeholder="Links to their fights, social clips, etc."
                rows={3}
              />
            </div>

            <div className="grid gap-4">
              <div>
                <label className="text-sm font-medium mb-1.5 block">Budget (USD)</label>
                <Input type="number" min={1} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} required />
              </div>
              <div>
                <label className="text-sm font-medium mb-1.5 block">Minimum coach belt</label>
                <Select value={requiredBeltTier} onValueChange={(v) => setRequiredBeltTier(v as BeltTier)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BELT_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
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
                  <span>Coach payout (estimated)</span>
                  <span>{formatCents(payoutEstimate)}</span>
                </div>
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">
              Coaches deliver a <strong>video breakdown</strong> you can watch in the app. Escrow releases when you approve.
            </p>

            {paymentMode === 'mock' && (
              <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-400">
                Dev mode: no real card charge; full flow works for testing.
              </div>
            )}

            <div className="flex gap-2 justify-end pt-2">
              <Button type="button" variant="outline" onClick={() => router.back()}>Cancel</Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Posting…' : 'Post scouting request'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
