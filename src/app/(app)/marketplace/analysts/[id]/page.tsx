'use client'

/**
 * /marketplace/analysts/[id] — public analyst profile + reviews.
 * Fighters can start a direct-hire flow from here if analyst has it enabled.
 */

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { parseApiResponse } from '@/lib/safeJson'
import { formatCents } from '@/lib/currency'
import { fundMarketplaceJob } from '@/lib/marketplace/fundClient'
import {
  ArrowLeft, CheckCircle2, Sparkles, Star, Clock, Briefcase,
} from 'lucide-react'
import { BeltBadge, type BeltTier } from '@/components/marketplace/BeltBadge'

type Analyst = {
  userId: string
  displayName: string
  discipline: string
  isVerified: boolean
  isPro: boolean
  bio: string
  specialties: string[]
  languages: string[]
  turnaroundHours: number
  beltTier: BeltTier
  beltScore: number
  jobsCompleted: number
  reviewCount: number
  avgOverall: number
  avgTacticalAccuracy: number
  avgActionability: number
  avgCommunication: number
  directHireEnabled: boolean
  directHireRateCents: number
  currentCapacity: number
  maxCapacity: number
}

type Review = {
  id: string
  jobId: string
  reviewerId: string
  reviewerName: string | null
  tacticalAccuracy: number
  actionability: number
  communication: number
  avgScore: number
  comment: string
  wouldHireAgain: boolean
  createdAt: string
}

export default function AnalystProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { user } = useAuth()
  const { toast } = useToast()

  const [analyst, setAnalyst] = useState<Analyst | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [loading, setLoading] = useState(true)
  const [hiring, setHiring] = useState(false)

  const load = useCallback(async () => {
    try {
      const [aRes, rRes] = await Promise.all([
        fetch(`/api/social/analysts/${id}`, { credentials: 'include' }),
        fetch(`/api/social/analysts/${id}/reviews?limit=25`, { credentials: 'include' }),
      ])
      const aData = await parseApiResponse<{ analyst: Analyst }>(aRes)
      const rData = await parseApiResponse<{ reviews: Review[] }>(rRes)
      setAnalyst(aData.analyst)
      setReviews(rData.reviews || [])
    } catch (err) {
      toast({
        title: 'Failed to load analyst',
        description: err instanceof Error ? err.message : 'Unknown',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { load() }, [load])

  async function directHire() {
    if (!user) {
      router.push('/login')
      return
    }
    if (!analyst) return
    setHiring(true)
    try {
      const createRes = await fetch('/api/social/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          jobType: 'direct_hire',
          title: `Direct hire: ${analyst.displayName}`,
          brief: 'Direct-hire engagement — fill out brief on the job detail page.',
          amountCents: analyst.directHireRateCents,
          analystId: analyst.userId,
          clientRequestId: crypto.randomUUID(),
        }),
      })
      const created = await parseApiResponse<{ job: { id: string } }>(createRes)
      const funded = await fundMarketplaceJob(created.job.id)
      if (funded.redirected) {
        toast({
          title: 'Finish payment',
          description: 'Redirecting to Stripe Checkout.',
        })
        return
      }
      toast({ title: 'Direct hire created' })
      router.push(`/marketplace/jobs/${created.job.id}`)
    } catch (err) {
      toast({
        title: 'Direct hire failed',
        description: err instanceof Error ? err.message : 'Unknown',
        variant: 'destructive',
      })
    } finally {
      setHiring(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-8 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    )
  }
  if (!analyst) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <Card><CardContent className="py-10 text-center">Analyst not found.</CardContent></Card>
      </div>
    )
  }

  const initials = analyst.displayName.substring(0, 2).toUpperCase() || '??'
  const canHire = analyst.directHireEnabled && analyst.directHireRateCents > 0

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/marketplace">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to marketplace
        </Link>
      </Button>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col sm:flex-row gap-4 sm:items-start">
            <Avatar className="h-20 w-20">
              <AvatarFallback className="bg-primary/20 text-primary text-2xl font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <CardTitle className="text-2xl">{analyst.displayName || 'Unnamed'}</CardTitle>
                {analyst.isVerified && <CheckCircle2 className="h-5 w-5 text-emerald-500" />}
                {analyst.isPro && <Sparkles className="h-5 w-5 text-amber-500" />}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <BeltBadge tier={analyst.beltTier} />
                {analyst.discipline && (
                  <Badge variant="secondary" className="capitalize">{analyst.discipline}</Badge>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <span className="flex items-center gap-1 font-semibold">
                  <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                  {analyst.avgOverall.toFixed(1)}
                  <span className="text-muted-foreground text-xs font-normal">
                    ({analyst.reviewCount} review{analyst.reviewCount === 1 ? '' : 's'})
                  </span>
                </span>
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <Briefcase className="h-4 w-4" />
                  {analyst.jobsCompleted} jobs
                </span>
                <span className="flex items-center gap-1 text-muted-foreground text-sm">
                  <Clock className="h-4 w-4" />
                  ~{analyst.turnaroundHours}h turnaround
                </span>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {analyst.bio && (
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{analyst.bio}</p>
          )}
          {analyst.specialties.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-1.5">Specialties</h3>
              <div className="flex flex-wrap gap-1.5">
                {analyst.specialties.map((s) => (
                  <Badge key={s} variant="secondary">{s}</Badge>
                ))}
              </div>
            </div>
          )}
          <Separator />
          <div className="grid grid-cols-3 gap-3 text-center">
            <ScoreCell label="Tactical" value={analyst.avgTacticalAccuracy} />
            <ScoreCell label="Actionable" value={analyst.avgActionability} />
            <ScoreCell label="Comms" value={analyst.avgCommunication} />
          </div>
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {canHire ? (
                <div className="text-sm">
                  <span className="font-semibold text-lg">{formatCents(analyst.directHireRateCents)}</span>
                  <span className="text-muted-foreground"> · direct hire rate</span>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Direct hire not enabled — post a bounty instead.
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Capacity: {analyst.currentCapacity}/{analyst.maxCapacity} active jobs
              </p>
            </div>
            <div className="flex gap-2">
              {canHire && (
                <Button
                  onClick={directHire}
                  disabled={hiring || user?.id === analyst.userId}
                >
                  {hiring ? 'Creating...' : 'Hire directly'}
                </Button>
              )}
              <Button asChild variant="outline">
                <Link href="/marketplace/jobs/new">Post a bounty</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Reviews</CardTitle></CardHeader>
        <CardContent>
          {reviews.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No reviews yet.</p>
          ) : (
            <div className="space-y-4">
              {reviews.map((r) => (
                <div key={r.id} className="border-b border-border/50 pb-4 last:border-0 last:pb-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{r.reviewerName || 'Fighter'}</span>
                      <span className="text-muted-foreground text-xs">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                      <span className="font-semibold text-sm">{r.avgScore.toFixed(1)}</span>
                    </div>
                  </div>
                  {r.comment && (
                    <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{r.comment}</p>
                  )}
                  <div className="flex gap-3 text-xs text-muted-foreground mt-2">
                    <span>Tactical {r.tacticalAccuracy}/5</span>
                    <span>Actionable {r.actionability}/5</span>
                    <span>Comms {r.communication}/5</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ScoreCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md bg-muted/40 py-2">
      <div className="text-lg font-bold">{value.toFixed(1)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}
