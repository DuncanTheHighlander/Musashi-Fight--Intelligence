'use client'

/**
 * /marketplace/jobs/[id] — job detail + lifecycle actions.
 *
 * Action visibility by role + status:
 *   - Fighter, FUNDED:              cancel
 *   - Analyst (not assigned), FUNDED+open_bounty: claim
 *   - Analyst (assigned), CLAIMED:  start
 *   - Analyst (assigned), IN_PROGRESS: submit deliverable
 *   - Fighter, SUBMITTED:           approve · dispute
 *   - Fighter, RELEASED+no review:  leave review
 *   - Either, IN_PROGRESS|SUBMITTED: open dispute
 */

import { use, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { parseApiResponse } from '@/lib/safeJson'
import { formatCents } from '@/lib/currency'
import {
  ArrowLeft, Coins, Video, Clock, CheckCircle2, XCircle, Gavel, Send, Play, Star,
} from 'lucide-react'
import { JobStatusBadge, type JobStatus } from '@/components/marketplace/JobStatusBadge'
import { BeltBadge, type BeltTier } from '@/components/marketplace/BeltBadge'
import { UploadDropzone } from '@/components/marketplace/UploadDropzone'
import { CoachFeedbackVideo, isLikelyVideoRef } from '@/components/marketplace/CoachFeedbackVideo'
import { ReportContentButton } from '@/components/social/ReportContentButton'
import { displayAssetLabel, resolveAssetHref } from '@/lib/storage/assetRef'
import { fundMarketplaceJob } from '@/lib/marketplace/fundClient'

type Job = {
  id: string
  fighterId: string
  analystId: string | null
  jobType: 'open_bounty' | 'direct_hire'
  requiredBeltTier: BeltTier
  title: string
  brief: string
  videos: string[]
  amountCents: number
  platformFeeCents: number
  analystPayoutCents: number
  currency: string
  status: JobStatus
  scoutingRequestId?: string | null
  deliverableUrl: string | null
  deliverableNotes: string | null
  submittedAt: string | null
  approvedAt: string | null
  releasedAt: string | null
  claimDeadlineAt: string | null
  deliveryDeadlineAt: string | null
  approvalDeadlineAt: string | null
  createdAt: string
}

type Transaction = {
  id: string
  type: string
  amountCents: number
  status: string
  createdAt: string
}

type ActiveDispute = {
  id: string
  status: string
  reason: string
  description: string
  openedById: string
  counterStatement: string | null
}

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  const fundingParam = searchParams.get('funding')
  const { user } = useAuth()
  const { toast } = useToast()

  const [job, setJob] = useState<Job | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)
  const [fundingPoll, setFundingPoll] = useState(false)
  const fundingHandled = useRef(false)
  const fundingPollStarted = useRef(false)

  // Submit-deliverable dialog state
  const [deliverableUrl, setDeliverableUrl] = useState('')
  const [deliverableAssetId, setDeliverableAssetId] = useState<string | null>(null)
  const [deliverableNotes, setDeliverableNotes] = useState('')
  const [submitOpen, setSubmitOpen] = useState(false)

  // Dispute dialog state
  const [disputeReason, setDisputeReason] = useState<string>('not_delivered')
  const [disputeDescription, setDisputeDescription] = useState('')
  const [disputeEvidenceAssetIds, setDisputeEvidenceAssetIds] = useState<string[]>([])
  const [disputeOpen, setDisputeOpen] = useState(false)
  const [activeDispute, setActiveDispute] = useState<ActiveDispute | null>(null)
  const [evidenceOpen, setEvidenceOpen] = useState(false)
  const [evidenceStatement, setEvidenceStatement] = useState('')
  const [extraEvidenceAssetIds, setExtraEvidenceAssetIds] = useState<string[]>([])

  // Review dialog state
  const [tactical, setTactical] = useState(5)
  const [actionability, setActionability] = useState(5)
  const [communication, setCommunication] = useState(5)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)

  const loadJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/social/jobs/${id}`, { credentials: 'include' })
      const data = await parseApiResponse<{
        job: Job
        transactions: Transaction[]
        dispute?: ActiveDispute | null
      }>(res)
      setJob(data.job)
      setTransactions(data.transactions || [])
      setActiveDispute(data.dispute ?? null)
    } catch (err) {
      toast({
        title: 'Failed to load job',
        description: err instanceof Error ? err.message : 'Unknown',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [id, toast])

  useEffect(() => { loadJob() }, [loadJob])

  useEffect(() => {
    if (fundingParam !== 'success' || !job) return

    if (job.status === 'FUNDED' && !fundingHandled.current) {
      fundingHandled.current = true
      toast({ title: 'Payment confirmed', description: 'Your bounty is live for analysts.' })
      router.replace(`/marketplace/jobs/${id}`)
      return
    }

    if (job.status !== 'CREATED' || fundingPollStarted.current) return

    fundingPollStarted.current = true
    setFundingPoll(true)
    toast({
      title: 'Confirming payment',
      description: 'Waiting for Stripe to confirm — this usually takes a few seconds.',
    })

    let attempts = 0
    const interval = window.setInterval(async () => {
      attempts += 1
      try {
        const res = await fetch(`/api/social/jobs/${id}`, { credentials: 'include' })
        const data = await parseApiResponse<{ job: Job }>(res)
        setJob(data.job)
        if (data.job.status === 'FUNDED') {
          window.clearInterval(interval)
          setFundingPoll(false)
          if (!fundingHandled.current) {
            fundingHandled.current = true
            toast({ title: 'Payment confirmed', description: 'Your bounty is live for analysts.' })
            router.replace(`/marketplace/jobs/${id}`)
          }
        } else if (attempts >= 15) {
          window.clearInterval(interval)
          setFundingPoll(false)
        }
      } catch {
        if (attempts >= 15) {
          window.clearInterval(interval)
          setFundingPoll(false)
        }
      }
    }, 2000)

    return () => window.clearInterval(interval)
  }, [fundingParam, job, id, router, toast])

  useEffect(() => {
    if (fundingParam !== 'cancelled' || fundingHandled.current) return
    fundingHandled.current = true
    toast({
      title: 'Payment cancelled',
      description: 'Complete payment when you are ready to publish the bounty.',
      variant: 'destructive',
    })
    router.replace(`/marketplace/jobs/${id}`)
  }, [fundingParam, id, router, toast])

  async function handleAddEvidence() {
    if (!activeDispute) return
    setActing(true)
    try {
      const res = await fetch(`/api/social/disputes/${activeDispute.id}/evidence`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          statement: evidenceStatement.trim(),
          evidenceAssetIds: extraEvidenceAssetIds,
        }),
      })
      await parseApiResponse(res)
      setEvidenceOpen(false)
      setEvidenceStatement('')
      setExtraEvidenceAssetIds([])
      await loadJob()
      toast({ title: 'Evidence submitted', description: 'Admin will review all materials.' })
    } catch (err) {
      toast({
        title: 'Failed to submit evidence',
        description: err instanceof Error ? err.message : 'Unknown',
        variant: 'destructive',
      })
    } finally {
      setActing(false)
    }
  }

  async function handleFund() {
    setActing(true)
    try {
      const funded = await fundMarketplaceJob(id)
      if (funded.redirected) {
        toast({
          title: 'Finish payment',
          description: 'Redirecting to Stripe Checkout.',
        })
        return
      }
      await loadJob()
      toast({ title: 'Bounty funded', description: 'Analysts can now claim it.' })
    } catch (err) {
      toast({
        title: 'Funding failed',
        description: err instanceof Error ? err.message : 'Unknown',
        variant: 'destructive',
      })
    } finally {
      setActing(false)
    }
  }

  async function postAction(path: string, body?: Record<string, unknown>) {
    setActing(true)
    try {
      const res = await fetch(`/api/social/jobs/${id}${path}`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        credentials: 'include',
        body: body ? JSON.stringify(body) : undefined,
      })
      await parseApiResponse(res)
      await loadJob()
      return true
    } catch (err) {
      toast({
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Unknown',
        variant: 'destructive',
      })
      return false
    } finally {
      setActing(false)
    }
  }

  if (loading) return <JobSkeleton />
  if (!job) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-12">
        <Card><CardContent className="py-10 text-center">Job not found.</CardContent></Card>
      </div>
    )
  }

  const isFighter = user?.id === job.fighterId
  const isAnalyst = user?.id === job.analystId
  const canFund = isFighter && job.status === 'CREATED'
  const canClaim =
    user &&
    !isFighter &&
    job.jobType === 'open_bounty' &&
    job.status === 'FUNDED' &&
    !job.analystId
  const canStart = isAnalyst && job.status === 'CLAIMED'
  const canSubmit = isAnalyst && job.status === 'IN_PROGRESS'
  const canApprove = isFighter && job.status === 'SUBMITTED'
  const canCancel = isFighter && ['CREATED', 'FUNDED', 'CLAIMED', 'IN_PROGRESS'].includes(job.status)
  const canDispute =
    (isFighter || isAnalyst) &&
    ['IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'RELEASED'].includes(job.status)
  const canAddDisputeEvidence =
    job.status === 'DISPUTED' &&
    activeDispute &&
    ['OPEN', 'UNDER_REVIEW'].includes(activeDispute.status) &&
    (isFighter || isAnalyst)
  const isDisputeCounterparty =
    activeDispute &&
    user &&
    user.id !== activeDispute.openedById &&
    (user.id === job.fighterId || user.id === job.analystId)
  const canReview = isFighter && ['RELEASED', 'RESOLVED_RELEASE', 'RESOLVED_SPLIT'].includes(job.status)

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/marketplace">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to marketplace
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="text-2xl leading-tight">{job.title}</CardTitle>
            <div className="flex flex-col items-end gap-2">
              <JobStatusBadge status={job.status} />
              <ReportContentButton targetType="job" targetId={job.id} />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <Badge variant="secondary">
              {job.jobType === 'direct_hire' ? 'Direct Hire' : 'Open Bounty'}
            </Badge>
            <BeltBadge tier={job.requiredBeltTier} showLabel={false} />
            <span className="text-xs text-muted-foreground">
              Posted {new Date(job.createdAt).toLocaleDateString()}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="flex items-center gap-1 font-bold text-lg">
              <Coins className="h-5 w-5 text-amber-500" />
              {formatCents(job.amountCents, job.currency)}
            </span>
            <span className="text-muted-foreground text-xs flex items-center gap-1">
              Platform fee {formatCents(job.platformFeeCents)} · Analyst receives {formatCents(job.analystPayoutCents)}
            </span>
          </div>

          {job.brief && (
            <div>
              <h3 className="text-sm font-semibold mb-1">Brief</h3>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">{job.brief}</p>
            </div>
          )}

          {job.videos.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-2 flex items-center gap-1">
                <Video className="h-4 w-4" />
                {job.scoutingRequestId ? 'Footage for review' : 'Your clip'} ({job.videos.length})
              </h3>
              <div className="space-y-4">
                {job.videos.map((v, i) =>
                  isLikelyVideoRef(v) ? (
                    <CoachFeedbackVideo
                      key={i}
                      src={v}
                      title={job.videos.length > 1 ? `Clip ${i + 1}` : undefined}
                    />
                  ) : (
                    <a
                      key={i}
                      href={resolveAssetHref(v)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline break-all block"
                    >
                      {displayAssetLabel(v)}
                    </a>
                  ),
                )}
              </div>
            </div>
          )}

          {job.deliverableUrl && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-3">
              <h3 className="text-sm font-semibold flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                Coach video feedback
              </h3>
              {isLikelyVideoRef(job.deliverableUrl) ? (
                <CoachFeedbackVideo src={job.deliverableUrl} />
              ) : (
                <a
                  href={resolveAssetHref(job.deliverableUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline break-all"
                >
                  {displayAssetLabel(job.deliverableUrl)}
                </a>
              )}
              {job.deliverableNotes && (
                <p className="text-sm text-muted-foreground mt-2 whitespace-pre-wrap">
                  {job.deliverableNotes}
                </p>
              )}
              {job.approvalDeadlineAt && job.status === 'SUBMITTED' && (
                <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Auto-release {new Date(job.approvalDeadlineAt).toLocaleString()}
                </p>
              )}
            </div>
          )}

          {job.status === 'DISPUTED' && activeDispute && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
              <h3 className="text-sm font-semibold flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <Gavel className="h-4 w-4" />
                Dispute in progress
              </h3>
              <p className="text-xs text-muted-foreground">
                Reason: {activeDispute.reason.replace(/_/g, ' ')} · Status: {activeDispute.status}
              </p>
              <p className="text-sm whitespace-pre-wrap">{activeDispute.description}</p>
              {activeDispute.counterStatement && (
                <p className="text-sm whitespace-pre-wrap border-t border-border/50 pt-2">
                  <span className="font-medium">Response: </span>
                  {activeDispute.counterStatement}
                </p>
              )}
            </div>
          )}

          <Separator />

          {/* Action row */}
          <div className="flex flex-wrap gap-2">
            {fundingPoll && (
              <div className="w-full rounded-md bg-muted/50 border border-border/60 px-3 py-2 text-xs text-muted-foreground">
                Confirming your Stripe payment…
              </div>
            )}
            {canFund && (
              <Button onClick={handleFund} disabled={acting || fundingPoll}>
                <Coins className="h-4 w-4 mr-1" />
                {fundingPoll ? 'Confirming payment…' : 'Complete payment'}
              </Button>
            )}
            {canClaim && (
              <Button onClick={() => postAction('/claim')} disabled={acting}>
                <Play className="h-4 w-4 mr-1" />
                Claim this bounty
              </Button>
            )}
            {canStart && (
              <Button onClick={() => postAction('/start')} disabled={acting}>
                Start work
              </Button>
            )}
            {canSubmit && (
              <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
                <DialogTrigger asChild>
                  <Button disabled={acting}>
                    <Send className="h-4 w-4 mr-1" />
                    Send video feedback
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Send video feedback to fighter</DialogTitle>
                    <DialogDescription>
                      Upload a video breakdown (preferred) with your coaching notes. The fighter watches it before approving payment.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <UploadDropzone
                      purpose="deliverable"
                      accept="video/mp4,video/quicktime,video/webm,application/pdf,text/plain,text/markdown"
                      label="Upload video breakdown"
                      hint="Video preferred — MP4, MOV, or WebM up to 500 MB."
                      jobId={job.id}
                      onUploaded={(asset) => {
                        setDeliverableAssetId(asset.id)
                        setDeliverableUrl('')
                      }}
                      onRemoved={() => setDeliverableAssetId(null)}
                    />
                    <div>
                      <label className="text-sm font-medium mb-1 block">Or paste a URL</label>
                      <Input
                        value={deliverableUrl}
                        onChange={(e) => {
                          setDeliverableUrl(e.target.value)
                          if (e.target.value.trim()) setDeliverableAssetId(null)
                        }}
                        placeholder="https://..."
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Notes</label>
                      <Textarea
                        value={deliverableNotes}
                        onChange={(e) => setDeliverableNotes(e.target.value)}
                        rows={4}
                        placeholder="Key takeaways, timestamps, drills..."
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setSubmitOpen(false)}>Cancel</Button>
                    <Button
                      disabled={acting || (!deliverableUrl.trim() && !deliverableAssetId)}
                      onClick={async () => {
                        const ok = await postAction('/submit', {
                          deliverableUrl: deliverableUrl.trim() || undefined,
                          deliverableAssetId: deliverableAssetId || undefined,
                          deliverableNotes,
                        })
                        if (ok) {
                          setSubmitOpen(false)
                          toast({ title: 'Video sent', description: 'Fighter has 72h to watch and approve.' })
                        }
                      }}
                    >
                      Submit
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            {canApprove && (
              <Button
                onClick={async () => {
                  const ok = await postAction('/approve')
                  if (ok) toast({ title: 'Approved', description: 'Payout released.' })
                }}
                disabled={acting}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Approve & release payment
              </Button>
            )}
            {canCancel && (
              <Button
                variant="outline"
                onClick={async () => {
                  if (!confirm('Cancel this job? Funds will be refunded.')) return
                  const ok = await postAction('/cancel', { reason: 'fighter_cancelled' })
                  if (ok) toast({ title: 'Cancelled' })
                }}
                disabled={acting}
              >
                <XCircle className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            )}
            {canAddDisputeEvidence && (
              <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" disabled={acting}>
                    <Gavel className="h-4 w-4 mr-1" />
                    {isDisputeCounterparty && !activeDispute?.counterStatement
                      ? 'Respond to dispute'
                      : 'Add evidence'}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>
                      {isDisputeCounterparty && !activeDispute?.counterStatement
                        ? 'Submit your response'
                        : 'Add dispute evidence'}
                    </DialogTitle>
                    <DialogDescription>
                      Upload files or add a statement. Admin reviews both sides before resolving.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <UploadDropzone
                      purpose="dispute_evidence"
                      accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/quicktime,video/webm,text/plain"
                      label="Upload evidence"
                      hint="Images, PDF, or video up to 500 MB."
                      jobId={job.id}
                      onUploaded={(asset) =>
                        setExtraEvidenceAssetIds((prev) => [...prev, asset.id])
                      }
                      onRemoved={(assetId) =>
                        setExtraEvidenceAssetIds((prev) => prev.filter((x) => x !== assetId))
                      }
                    />
                    <div>
                      <label className="text-sm font-medium mb-1 block">
                        {isDisputeCounterparty && !activeDispute?.counterStatement
                          ? 'Your statement'
                          : 'Additional notes'}
                      </label>
                      <Textarea
                        value={evidenceStatement}
                        onChange={(e) => setEvidenceStatement(e.target.value)}
                        rows={4}
                        placeholder="Explain your side..."
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setEvidenceOpen(false)}>Cancel</Button>
                    <Button
                      disabled={
                        acting ||
                        (!evidenceStatement.trim() && extraEvidenceAssetIds.length === 0)
                      }
                      onClick={handleAddEvidence}
                    >
                      Submit
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            {canDispute && (
              <Dialog open={disputeOpen} onOpenChange={setDisputeOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" disabled={acting}>
                    <Gavel className="h-4 w-4 mr-1" />
                    Open dispute
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Open a dispute</DialogTitle>
                    <DialogDescription>
                      An admin will review both sides and decide refund, release, or split.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <div>
                      <label className="text-sm font-medium mb-1 block">Reason</label>
                      <Select value={disputeReason} onValueChange={setDisputeReason}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="not_delivered">Not delivered</SelectItem>
                          <SelectItem value="poor_quality">Poor quality</SelectItem>
                          <SelectItem value="off_brief">Off brief</SelectItem>
                          <SelectItem value="late">Late</SelectItem>
                          <SelectItem value="plagiarism">Plagiarism</SelectItem>
                          <SelectItem value="harassment">Harassment</SelectItem>
                          <SelectItem value="fraud">Fraud</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Evidence (optional)</label>
                      <UploadDropzone
                        purpose="dispute_evidence"
                        accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4,video/webm,text/plain"
                        label="Upload evidence files"
                        jobId={job.id}
                        onUploaded={(asset) =>
                          setDisputeEvidenceAssetIds((prev) => [...prev, asset.id])
                        }
                        onRemoved={(assetId) =>
                          setDisputeEvidenceAssetIds((prev) => prev.filter((id) => id !== assetId))
                        }
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium mb-1 block">Description</label>
                      <Textarea
                        value={disputeDescription}
                        onChange={(e) => setDisputeDescription(e.target.value)}
                        rows={5}
                        placeholder="Explain what happened in detail..."
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setDisputeOpen(false)}>Cancel</Button>
                    <Button
                      disabled={acting || !disputeDescription.trim()}
                      onClick={async () => {
                        const ok = await postAction('/dispute', {
                          reason: disputeReason,
                          description: disputeDescription.trim(),
                          evidenceAssetIds: disputeEvidenceAssetIds,
                        })
                        if (ok) {
                          setDisputeOpen(false)
                          toast({ title: 'Dispute opened' })
                        }
                      }}
                    >
                      Submit dispute
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
            {canReview && (
              <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
                <DialogTrigger asChild>
                  <Button>
                    <Star className="h-4 w-4 mr-1" />
                    Leave review
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Rate this analyst</DialogTitle>
                    <DialogDescription>
                      Help the next fighter make a good call.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <StarRow label="Tactical accuracy" value={tactical} onChange={setTactical} />
                    <StarRow label="Actionability" value={actionability} onChange={setActionability} />
                    <StarRow label="Communication" value={communication} onChange={setCommunication} />
                    <div>
                      <label className="text-sm font-medium mb-1 block">Comment</label>
                      <Textarea
                        value={reviewComment}
                        onChange={(e) => setReviewComment(e.target.value)}
                        rows={4}
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setReviewOpen(false)}>Cancel</Button>
                    <Button
                      disabled={acting}
                      onClick={async () => {
                        try {
                          const res = await fetch(`/api/social/jobs/${id}/review`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            credentials: 'include',
                            body: JSON.stringify({
                              tacticalAccuracy: tactical,
                              actionability,
                              communication,
                              comment: reviewComment,
                            }),
                          })
                          await parseApiResponse(res)
                          setReviewOpen(false)
                          toast({ title: 'Review submitted — thanks!' })
                          await loadJob()
                        } catch (err) {
                          toast({
                            title: 'Failed',
                            description: err instanceof Error ? err.message : 'unknown',
                            variant: 'destructive',
                          })
                        }
                      }}
                    >
                      Submit review
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </div>
        </CardContent>
      </Card>

      {transactions.length > 0 && (isFighter || isAnalyst) && (
        <Card>
          <CardHeader><CardTitle className="text-base">Ledger</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {transactions.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-sm border-b border-border/50 pb-1">
                <div>
                  <span className="font-mono text-xs">{t.type}</span>
                  <span className="text-muted-foreground text-xs ml-2">
                    {new Date(t.createdAt).toLocaleString()}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">{t.status}</span>
                  <span className={t.amountCents < 0 ? 'text-muted-foreground' : 'font-semibold'}>
                    {t.amountCents < 0 ? '−' : ''}{formatCents(Math.abs(t.amountCents))}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function StarRow({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-sm font-medium">{label}</label>
        <span className="text-xs text-muted-foreground">{value}/5</span>
      </div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className="p-1"
            aria-label={`${n} star${n > 1 ? 's' : ''}`}
          >
            <Star
              className={`h-5 w-5 ${n <= value ? 'fill-amber-500 text-amber-500' : 'text-muted-foreground/40'}`}
            />
          </button>
        ))}
      </div>
    </div>
  )
}

function JobSkeleton() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-4">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-64 w-full rounded-lg" />
    </div>
  )
}
