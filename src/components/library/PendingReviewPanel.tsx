'use client'

/**
 * Shogun-only moderation panel for the knowledge library. Lists documents users
 * submitted (review_state = 'pending') and lets an admin approve (feeds the AI)
 * or reject them. Renders nothing for non-admins.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { parseApiResponse } from '@/lib/safeJson'
import { ShieldCheck } from 'lucide-react'

type PendingDoc = { id: string; title: string; author: string | null; createdAt: string }

export default function PendingReviewPanel() {
  const { user, loading: authLoading } = useAuth()
  const { toast } = useToast()
  const [docs, setDocs] = useState<PendingDoc[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const isShogun = user?.role === 'shogun'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/library/review', { credentials: 'include' })
      if (res.status === 403) return
      const data = await parseApiResponse<{ documents: PendingDoc[] }>(res)
      setDocs(data.documents || [])
    } catch {
      /* silent — non-admins never see this panel */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!authLoading && isShogun) load()
  }, [authLoading, isShogun, load])

  async function decide(id: string, decision: 'approve' | 'reject') {
    setBusy(id)
    try {
      const res = await fetch('/api/library/review', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, decision }),
      })
      await parseApiResponse(res)
      toast({ title: decision === 'approve' ? 'Approved — now feeds AI coaching' : 'Rejected' })
      setDocs((prev) => prev.filter((d) => d.id !== id))
    } catch (err) {
      toast({
        title: 'Action failed',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setBusy(null)
    }
  }

  if (authLoading || !isShogun) return null
  if (!loading && docs.length === 0) return null

  return (
    <div className="container mx-auto max-w-6xl px-4 pt-6 lg:px-6">
      <Card className="border-amber-500/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            Knowledge review queue
            <Badge variant="outline" className="text-[10px]">{docs.length} pending</Badge>
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            User-submitted documents. They do NOT feed AI coaching until you approve them.
          </p>
        </CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="py-4 text-sm text-muted-foreground">Loading…</p>
          ) : (
            docs.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-card p-3"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{d.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {d.author || 'unknown'} · {new Date(d.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-destructive"
                    disabled={busy === d.id}
                    onClick={() => decide(d.id, 'reject')}
                  >
                    Reject
                  </Button>
                  <Button size="sm" disabled={busy === d.id} onClick={() => decide(d.id, 'approve')}>
                    Approve
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
