'use client'

/**
 * /admin/coach-review — Musashi Quality Review. Shogun + appointed reviewers see
 * the promotion queue (approve/hold). Shogun-only: hand-award Coral/Red and
 * manage the reviewer roster.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { parseApiResponse } from '@/lib/safeJson'
import { BELT_COLOR_ORDER } from '@/lib/marketplace/coachRank'
import { ArrowLeft, Trophy, ShieldCheck } from 'lucide-react'

type QueueItem = {
  userId: string
  displayName: string
  discipline: string
  currentBelt: string
  pendingBelt: string
  pendingTitle: string
  queuedAt: string
  metrics?: {
    positiveReviews: number
    recentAvgRating: number
    daysInGrade: number
    activeRecently: boolean
  }
}

type Reviewer = { userId: string; displayName: string; email: string; grantedAt: string }

export default function CoachReviewPage() {
  const { user, loading: authLoading } = useAuth()
  const { toast } = useToast()
  const isShogun = user?.role === 'shogun'

  const [queue, setQueue] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [notesByUser, setNotesByUser] = useState<Record<string, string>>({})

  const loadQueue = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/social/coaches/review-queue', { credentials: 'include' })
      if (res.status === 403) { setForbidden(true); setQueue([]); return }
      const data = await parseApiResponse<{ queue: QueueItem[] }>(res)
      setQueue(data.queue || [])
      setForbidden(false)
    } catch (err) {
      toast({ title: 'Failed to load queue', description: err instanceof Error ? err.message : 'Unknown', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (!authLoading) loadQueue()
  }, [authLoading, loadQueue])

  async function decide(userId: string, decision: 'approve' | 'hold') {
    setBusy(userId)
    try {
      const res = await fetch(`/api/social/coaches/${userId}/review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, notes: notesByUser[userId] || '' }),
      })
      await parseApiResponse(res)
      toast({ title: decision === 'approve' ? 'Promotion approved' : 'Held' })
      setNotesByUser((prev) => {
        const next = { ...prev }
        delete next[userId]
        return next
      })
      await loadQueue()
    } catch (err) {
      toast({ title: 'Action failed', description: err instanceof Error ? err.message : 'Unknown', variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  if (!authLoading && forbidden) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <Card><CardContent className="py-10 text-center">
          <h2 className="mb-2 text-lg font-semibold">Reviewers only</h2>
          <p className="text-sm text-muted-foreground">This page is for shogun and appointed Quality Reviewers.</p>
        </CardContent></Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-4 px-4 py-8">
      <Button asChild variant="ghost" size="sm">
        <Link href="/coaches"><ArrowLeft className="mr-1 h-4 w-4" />Back to rankings</Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5" />Promotion Review Queue</CardTitle>
          <p className="text-sm text-muted-foreground">
            Coaches who met the metrics for a senior belt. Approve to promote, or hold to keep them at their current rank.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : queue.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Nothing awaiting review — all caught up.</p>
          ) : (
            queue.map((q) => (
              <div key={q.userId} className="rounded-md border border-border bg-card p-3">
                <div className="min-w-0">
                  <div className="truncate font-medium">{q.displayName}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline" className="text-[10px] capitalize">{q.currentBelt} → {q.pendingBelt}</Badge>
                    <span className="font-medium text-foreground">{q.pendingTitle}</span>
                    {q.discipline && <span className="capitalize">{q.discipline}</span>}
                    <span>queued {new Date(q.queuedAt).toLocaleDateString()}</span>
                  </div>
                  {q.metrics && (
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <Metric label="Positive reviews" value={String(q.metrics.positiveReviews)} />
                      <Metric label="Recent average" value={q.metrics.recentAvgRating ? q.metrics.recentAvgRating.toFixed(2) : '0.00'} />
                      <Metric label="Days in grade" value={String(q.metrics.daysInGrade)} />
                      <Metric label="Recent activity" value={q.metrics.activeRecently ? 'Active' : 'Inactive'} />
                    </div>
                  )}
                </div>
                <div className="mt-3 flex shrink-0 justify-end gap-2">
                  <Button size="sm" variant="outline" disabled={busy === q.userId} onClick={() => decide(q.userId, 'hold')}>Hold</Button>
                  <Button size="sm" disabled={busy === q.userId} onClick={() => decide(q.userId, 'approve')}>Approve</Button>
                </div>
                <Textarea
                  className="mt-3 min-h-16 text-sm"
                  value={notesByUser[q.userId] || ''}
                  onChange={(e) => setNotesByUser((prev) => ({ ...prev, [q.userId]: e.target.value }))}
                  placeholder="Decision notes"
                />
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {isShogun && <ReviewerPanel />}
      {isShogun && <HandAwardPanel />}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium text-foreground">{value}</div>
    </div>
  )
}

function ReviewerPanel() {
  const { toast } = useToast()
  const [reviewers, setReviewers] = useState<Reviewer[]>([])
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social/coaches/reviewers', { credentials: 'include' })
      const data = await parseApiResponse<{ reviewers: Reviewer[] }>(res)
      setReviewers(data.reviewers || [])
    } catch { /* shown via toast on actions */ }
  }, [])

  useEffect(() => { load() }, [load])

  async function add() {
    if (!email.trim()) return
    setBusy(true)
    try {
      const res = await fetch('/api/social/coaches/reviewers', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      await parseApiResponse(res)
      setEmail('')
      toast({ title: 'Reviewer appointed' })
      await load()
    } catch (err) {
      toast({ title: 'Could not appoint', description: err instanceof Error ? err.message : 'Unknown', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  async function revoke(userId: string) {
    try {
      const res = await fetch(`/api/social/coaches/reviewers?userId=${encodeURIComponent(userId)}`, {
        method: 'DELETE', credentials: 'include',
      })
      await parseApiResponse(res)
      await load()
    } catch (err) {
      toast({ title: 'Could not revoke', description: err instanceof Error ? err.message : 'Unknown', variant: 'destructive' })
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" />Quality Reviewers</CardTitle>
        <p className="text-sm text-muted-foreground">Appoint coaches or staff who can approve promotions.</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input placeholder="reviewer@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button onClick={add} disabled={busy}>Appoint</Button>
        </div>
        {reviewers.length === 0 ? (
          <p className="text-xs text-muted-foreground">No appointed reviewers yet. Shogun can always review.</p>
        ) : (
          <ul className="divide-y divide-border">
            {reviewers.map((r) => (
              <li key={r.userId} className="flex items-center justify-between py-2 text-sm">
                <span className="min-w-0 truncate">{r.displayName} <span className="text-muted-foreground">{r.email}</span></span>
                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => revoke(r.userId)}>Revoke</Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function HandAwardPanel() {
  const { toast } = useToast()
  const [userId, setUserId] = useState('')
  const [belt, setBelt] = useState('coral')
  const [busy, setBusy] = useState(false)

  async function award() {
    if (!userId.trim()) return
    setBusy(true)
    try {
      const res = await fetch(`/api/social/coaches/${encodeURIComponent(userId.trim())}/award`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toBelt: belt }),
      })
      await parseApiResponse(res)
      toast({ title: `Awarded ${belt} rank` })
      setUserId('')
    } catch (err) {
      toast({ title: 'Award failed', description: err instanceof Error ? err.message : 'Unknown', variant: 'destructive' })
    } finally { setBusy(false) }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hand-award a rank</CardTitle>
        <p className="text-sm text-muted-foreground">For honorary belts (Coral 9°, Red 10°) outside the metric path.</p>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="coach user id" value={userId} onChange={(e) => setUserId(e.target.value)} />
        <select
          className="h-10 rounded-md border border-input bg-background px-3 text-sm capitalize"
          value={belt}
          onChange={(e) => setBelt(e.target.value)}
        >
          {BELT_COLOR_ORDER.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <Button onClick={award} disabled={busy}>Award</Button>
      </CardContent>
    </Card>
  )
}
