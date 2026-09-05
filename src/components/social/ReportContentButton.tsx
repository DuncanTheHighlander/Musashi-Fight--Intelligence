'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { Flag } from 'lucide-react'

type TargetType = 'job' | 'profile' | 'message' | 'product' | 'other'
type Reason = 'spam' | 'harassment' | 'inappropriate' | 'scam' | 'ip' | 'other'

const REASONS: Array<{ value: Reason; label: string }> = [
  { value: 'spam', label: 'Spam' },
  { value: 'harassment', label: 'Harassment or bullying' },
  { value: 'inappropriate', label: 'Inappropriate content' },
  { value: 'scam', label: 'Scam or fraud' },
  { value: 'ip', label: 'Intellectual property' },
  { value: 'other', label: 'Other' },
]

type Props = {
  targetType: TargetType
  targetId: string
  label?: string
  variant?: 'ghost' | 'outline' | 'link'
  className?: string
}

export function ReportContentButton({
  targetType,
  targetId,
  label = 'Report',
  variant = 'ghost',
  className,
}: Props) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<Reason>('inappropriate')
  const [details, setDetails] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/social/report', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetType, targetId, reason, details: details.trim() || undefined }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error || 'Report failed')
      toast({ title: 'Report submitted', description: 'Our team will review this content.' })
      setOpen(false)
      setDetails('')
    } catch (err) {
      toast({
        title: 'Could not submit report',
        description: err instanceof Error ? err.message : 'Try again',
        variant: 'destructive',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant={variant} size="sm" className={className}>
          <Flag className="mr-1.5 h-3.5 w-3.5" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report content</DialogTitle>
          <DialogDescription>
            Tell us what&apos;s wrong. False reports may lead to account action.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="report-reason">Reason</Label>
            <select
              id="report-reason"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={reason}
              onChange={(e) => setReason(e.target.value as Reason)}
            >
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="report-details">Details (optional)</Label>
            <Textarea
              id="report-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="What should we look at?"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Sending…' : 'Submit report'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
