'use client'

/**
 * /admin/disputes — shogun-only dispute queue.
 * Lists OPEN + UNDER_REVIEW disputes. Click one to resolve.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { parseApiResponse } from '@/lib/safeJson'
import { formatCents, centsFromDollars } from '@/lib/currency'
import { ArrowLeft, Gavel } from 'lucide-react'

type Dispute = {
  id: string
  jobId: string
  jobTitle: string
  fighterId: string
  analystId: string | null
  amountCents: number
  openedById: string
  reason: string
  description: string
  status: string
  createdAt: string
}

export default function AdminDisputesPage() {
  const { user, loading: authLoading } = useAuth()
  const { toast } = useToast()
  const [disputes, setDisputes] = useState<Dispute[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social/disputes?status=active', { credentials: 'include' })
      const data = await parseApiResponse<{ disputes: Dispute[] }>(res)
      setDisputes(data.disputes || [])
    } catch (err) {
      toast({
        title: 'Failed to load disputes',
        description: err instanceof Error ? err.message : 'Unknown',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (!authLoading && user?.role === 'shogun') load()
  }, [authLoading, user, load])

  if (!authLoading && user?.role !== 'shogun') {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <Card>
          <CardContent className="py-10 text-center">
            <h2 className="text-lg font-semibold mb-2">Admin only</h2>
            <p className="text-sm text-muted-foreground">
              This page is restricted to Shogun accounts.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 space-y-4">
      <Button asChild variant="ghost" size="sm">
        <Link href="/marketplace">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to marketplace
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Gavel className="h-5 w-5" />
            Dispute Queue
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Review both sides and resolve with refund, release, or split.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <Skeleton className="h-48 w-full" />
          ) : disputes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No open disputes — you&apos;re all caught up.
            </p>
          ) : (
            disputes.map((d) => (
              <DisputeRow key={d.id} dispute={d} onResolved={load} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DisputeRow({ dispute, onResolved }: { dispute: Dispute; onResolved: () => void }) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [resolution, setResolution] = useState<'refund' | 'release' | 'split' | 'dismiss'>('refund')
  const [notes, setNotes] = useState('')
  const [refundDollars, setRefundDollars] = useState('0')
  const [payoutDollars, setPayoutDollars] = useState('0')
  const [resolving, setResolving] = useState(false)

  async function resolve() {
    setResolving(true)
    try {
      const body: Record<string, unknown> = { resolution, notes }
      if (resolution === 'split') {
        body.refundAmountCents = centsFromDollars(refundDollars)
        body.payoutAmountCents = centsFromDollars(payoutDollars)
      }
      const res = await fetch(`/api/social/disputes/${dispute.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      })
      await parseApiResponse(res)
      toast({ title: 'Resolved', description: `Disposition: ${resolution}` })
      setOpen(false)
      onResolved()
    } catch (err) {
      toast({
        title: 'Resolution failed',
        description: err instanceof Error ? err.message : 'Unknown',
        variant: 'destructive',
      })
    } finally {
      setResolving(false)
    }
  }

  return (
    <div className="rounded-md border border-border bg-card p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/marketplace/jobs/${dispute.jobId}`}
            className="font-medium text-sm hover:underline truncate block"
          >
            {dispute.jobTitle}
          </Link>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            <Badge variant="secondary" className="text-[10px]">{dispute.reason}</Badge>
            <Badge variant="outline" className="text-[10px]">{dispute.status}</Badge>
            <span className="text-xs text-muted-foreground">
              {formatCents(dispute.amountCents)}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(dispute.createdAt).toLocaleString()}
            </span>
          </div>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">Resolve</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Resolve dispute</DialogTitle>
              <DialogDescription>Choose how funds are distributed.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <label className="text-sm font-medium mb-1 block">Resolution</label>
                <Select value={resolution} onValueChange={(v) => setResolution(v as typeof resolution)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="refund">Full refund → fighter</SelectItem>
                    <SelectItem value="release">Full release → analyst</SelectItem>
                    <SelectItem value="split">Split</SelectItem>
                    <SelectItem value="dismiss">Dismiss (release as normal)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {resolution === 'split' && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">Refund (USD)</label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={refundDollars}
                      onChange={(e) => setRefundDollars(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Payout (USD)</label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={payoutDollars}
                      onChange={(e) => setPayoutDollars(e.target.value)}
                    />
                  </div>
                </div>
              )}
              <div>
                <label className="text-sm font-medium mb-1 block">Notes</label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={resolving} onClick={resolve}>
                {resolving ? 'Resolving...' : 'Confirm'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <p className="text-xs text-muted-foreground line-clamp-2">{dispute.description}</p>
    </div>
  )
}
