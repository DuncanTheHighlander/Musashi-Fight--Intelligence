'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

type Correction = {
  id: string
  clipId: string | null
  ledgerId: string | null
  responseType: string
  cardSection: string | null
  sport: string
  startMs: number | null
  endMs: number | null
  wholeClip: boolean
  originalText: string
  correctionText: string
  correctedLabelsJson: string
  status: string
  updatedAt: string
}

function windowLabel(c: Correction): string {
  if (c.wholeClip) return 'whole clip'
  if (c.startMs == null && c.endMs == null) return 'no timestamp'
  return `${((c.startMs ?? 0) / 1000).toFixed(1)}–${((c.endMs ?? c.startMs ?? 0) / 1000).toFixed(1)}s`
}

function labelsSummary(json: string): string {
  try {
    const parsed = JSON.parse(json) as { incorrect_labels?: string[]; correct_labels?: string[] }
    const a = (parsed.incorrect_labels ?? []).join(', ') || '?'
    const b = (parsed.correct_labels ?? []).join(', ') || '?'
    return `${a} → ${b}`
  } catch {
    return '—'
  }
}

export function AiCorrectionsPanel() {
  const [status, setStatus] = useState('all')
  const [rows, setRows] = useState<Correction[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const qs = status === 'all' ? '' : `?status=${encodeURIComponent(status)}`
      const res = await fetch(`/api/fight/teach-correction/list${qs}`)
      const data = (await res.json().catch(() => null)) as {
        success?: boolean
        corrections?: Correction[]
        error?: string
      } | null
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Failed to load')
      setRows(data.corrections ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }, [status])

  useEffect(() => {
    void load()
  }, [load])

  const setRowStatus = async (id: string, next: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/fight/teach-correction/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status: next }),
      })
      const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Update failed')
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Teach Musashi — Corrections</CardTitle>
        <CardDescription>
          Exact-clip correction memory. Approve/Reject/Archive/Gold. Reanalyze from the fight screen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {['all', 'draft', 'approved', 'gold', 'rejected', 'archived'].map((s) => (
            <Button
              key={s}
              size="sm"
              variant={status === s ? 'default' : 'outline'}
              onClick={() => setStatus(s)}
            >
              {s}
            </Button>
          ))}
          <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy}>
            Refresh
          </Button>
        </div>
        {error && <div className="text-sm text-amber-600">{error}</div>}
        <div className="space-y-3">
          {rows.length === 0 && !busy && (
            <div className="text-sm text-muted-foreground">No corrections yet.</div>
          )}
          {rows.map((c) => (
            <div key={c.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">{c.status}</Badge>
                <Badge variant="outline">{c.sport}</Badge>
                <Badge variant="outline">{c.responseType}</Badge>
                <span className="text-xs text-muted-foreground">{windowLabel(c)}</span>
                {c.clipId && (
                  <a className="text-xs text-cyan-600 underline" href={`/fight?asset=${encodeURIComponent(c.clipId)}`}>
                    Open clip
                  </a>
                )}
              </div>
              <div className="text-sm font-medium">{labelsSummary(c.correctedLabelsJson)}</div>
              <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
                <div>
                  <div className="font-semibold text-foreground/80">Original</div>
                  <div className="line-clamp-3">{c.originalText}</div>
                </div>
                <div>
                  <div className="font-semibold text-foreground/80">Correction</div>
                  <div className="line-clamp-3">{c.correctionText}</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {c.status !== 'approved' && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void setRowStatus(c.id, 'approved')}>
                    Approve
                  </Button>
                )}
                {c.status !== 'rejected' && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void setRowStatus(c.id, 'rejected')}>
                    Reject
                  </Button>
                )}
                {c.status !== 'archived' && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void setRowStatus(c.id, 'archived')}>
                    Archive
                  </Button>
                )}
                {c.status !== 'gold' && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void setRowStatus(c.id, 'gold')}>
                    Mark Gold
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
