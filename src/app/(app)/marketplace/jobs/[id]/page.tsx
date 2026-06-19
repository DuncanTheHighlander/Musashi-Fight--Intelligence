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

import { use, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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

export default function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { user } = useAuth()
  const { toast } = useToast()

  const [job, setJob] = useState<Job | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [acting, setActing] = useState(false)

  // Submit-deliverable dialog state
  const [deliverableUrl, setDeliverableUrl] = useState('')
  const [deliverableNotes, setDeliverableNotes] = useState('')
  const [submitOpen, setSubmitOpen] = useState(false)

  // Dispute dialog state
  const [disputeReason, setDisputeReason] = useState<string>('not_delivered')
  const [disputeDescription, setDisputeDescription] = useState('')
  const [disputeOpen, setDisputeOpen] = useState(false)

  // Review dialog state
  const [tactical, setTactical] = useState(5)
  const [actionability, setActionability] = useState(5)
  const [communication, setCommunication] = useState(5)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewOpen, setReviewOpen] = useState(false)

  const loadJob = useCallback(async () => {
    try {
      const res = await fetch(`/api/social/jobs/${id}`, { credentials: 'include' })
      const data = await parseApiResponse<{ job: Job; transactions: Transaction[] }>(res)
      setJob(data.job)
      setTransactions(data.transactions || [])
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
            <JobStatusBadge status={job.status} />
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
                Videos ({job.videos.length})
              </h3>
              <ul className="space-y-1">
                {job.videos.map((v, i) => (
                  <li key={i}>
                    <a
                      href={v}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary hover:underline break-all"
                    >
                      {v}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {job.deliverableUrl && (
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
              <h3 className="text-sm font-semibold mb-1 flex items-center gap-1 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
                Deliverable submitted
              </h3>
              <a
                href={job.deliverableUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-primary hover:underline break-all"
              >
                {job.deliverableUrl}
              </a>
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

          <Separator />

          {/* Action row */}
          <div className="flex flex-wrap gap-2">
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
                    Submit deliverable
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Submit your analysis</DialogTitle>
                    <DialogDescription>
                      Paste a shareable link to your breakdown. Notes are optional.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <div>
                      <label className="text-sm font-medium mb-1 block">Deliverable URL</label>
                      <Input
                        value={deliverableUrl}
                        onChange={(e) => setDeliverableUrl(e.target.value)}
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
                      disabled={acting || !deliverableUrl.trim()}
                      onClick={async () => {
                        const ok = await postAction('/submit', {
                          deliverableUrl: deliverableUrl.trim(),
                          deliverableNotes,
                        })
                        if (ok) {
                          setSubmitOpen(false)
                          toast({ title: 'Delivered', description: 'Fighter has 72h to approve.' })
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
