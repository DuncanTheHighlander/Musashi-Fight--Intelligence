'use client'

import React, { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { parseApiResponse } from '@/lib/safeJson'

export type OverviewUser = {
  id: string
  email: string
  role: string
  created_at: string
  email_verified_at: string | null
  videos_analyzed: number
  last_analysis_at: string | null
  is_pro: number
  account_status?: string
  status_reason?: string | null
  support_notes?: string | null
  comp_pro_until?: string | null
  bonus_video_credits?: number
  consent_ai_training?: number
  consent_at?: string | null
  free_videos_used?: number
}

export type OverviewData = {
  totals: {
    users: number
    verified: number
    pro: number
    videosAnalyzed: number
    activeLast7d: number
    videosLast24h?: number
    consented?: number
    suspended?: number
  }
  users: OverviewUser[]
  killSwitch?: { active: boolean; envActive: boolean; runtimeActive: boolean }
}

type Props = {
  overview: OverviewData | null
  onRefresh: () => Promise<void>
  onError: (msg: string | null) => void
}

export function ShogunOverviewPanel({ overview, onRefresh, onError }: Props) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = overview?.users || []
    if (!q) return list
    return list.filter((u) => u.email.toLowerCase().includes(q) || u.role.toLowerCase().includes(q))
  }, [overview?.users, query])

  const selected = useMemo(
    () => (overview?.users || []).find((u) => u.id === selectedId) || null,
    [overview?.users, selectedId],
  )

  const runUserAction = async (action: string, extra?: Record<string, unknown>) => {
    if (!selectedId) return
    setBusy(true)
    setActionMsg(null)
    onError(null)
    try {
      const res = await fetch(`/api/shogun/users/${encodeURIComponent(selectedId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, reason, notes, credits: 10, days: 30, ...extra }),
      })
      const data = await parseApiResponse<{ error?: string; ok?: boolean; dryRun?: boolean }>(res)
      if (!res.ok) throw new Error(data?.error || 'Action failed')
      setActionMsg(data?.dryRun ? 'Done (email dry-run)' : 'Done')
      setReason('')
      await onRefresh()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const toggleKillSwitch = async (active: boolean) => {
    setBusy(true)
    onError(null)
    try {
      const res = await fetch('/api/shogun/kill-switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active, reason: reason || (active ? 'Emergency halt' : 'Resume AI') }),
      })
      const data = await parseApiResponse<{ error?: string }>(res)
      if (!res.ok) throw new Error(data?.error || 'Kill switch update failed')
      setActionMsg(active ? 'AI halted for non-admin users' : 'AI resumed')
      await onRefresh()
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Kill switch failed')
    } finally {
      setBusy(false)
    }
  }

  const purgeCache = async () => {
    setBusy(true)
    onError(null)
    try {
      const res = await fetch('/api/shogun/cache-purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ everything: false }),
      })
      const data = await parseApiResponse<{ error?: string; hint?: string }>(res)
      if (!res.ok) throw new Error(data?.error || data?.hint || 'Cache purge failed')
      setActionMsg('CDN cache purge requested')
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Cache purge failed')
    } finally {
      setBusy(false)
    }
  }

  const killActive = Boolean(overview?.killSwitch?.active)

  return (
    <div className="space-y-4">
      <Card className={killActive ? 'border-destructive' : 'border-border'}>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">System controls</CardTitle>
          <CardDescription>
            Kill switch stops new AI analyses for everyone except Shogun. Env override{' '}
            <code className="text-xs">MUSASHI_AI_KILL_SWITCH=1</code> also forces halt.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Badge variant={killActive ? 'destructive' : 'secondary'}>
            AI {killActive ? 'HALTED' : 'live'}
          </Badge>
          {killActive ? (
            <Button disabled={busy} variant="default" onClick={() => void toggleKillSwitch(false)}>
              Resume AI
            </Button>
          ) : (
            <Button disabled={busy} variant="destructive" onClick={() => void toggleKillSwitch(true)}>
              HALT AI ANALYSIS GLOBALLY
            </Button>
          )}
          <Button disabled={busy} variant="outline" onClick={() => void purgeCache()}>
            Purge CDN cache
          </Button>
          {actionMsg && <span className="text-sm text-muted-foreground">{actionMsg}</span>}
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
        {[
          { label: 'Users', value: overview?.totals.users },
          { label: 'Verified', value: overview?.totals.verified },
          { label: 'Pro', value: overview?.totals.pro },
          { label: 'Videos', value: overview?.totals.videosAnalyzed },
          { label: 'Active 7d', value: overview?.totals.activeLast7d },
          { label: 'Consented', value: overview?.totals.consented },
        ].map((stat) => (
          <Card key={stat.label}>
            <CardContent className="p-4">
              <div className="text-2xl font-bold tabular-nums">{stat.value ?? '—'}</div>
              <div className="text-xs text-muted-foreground">{stat.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Users</CardTitle>
            <CardDescription>Search and tap a row for god-panel actions.</CardDescription>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search email…"
              className="mt-2"
            />
          </CardHeader>
          <CardContent className="max-h-[420px] overflow-auto">
            {/* Mobile cards */}
            <div className="space-y-2 sm:hidden">
              {filtered.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => {
                    setSelectedId(u.id)
                    setNotes(u.support_notes || '')
                  }}
                  className={`w-full rounded-lg border p-3 text-left ${
                    selectedId === u.id ? 'border-primary bg-muted/50' : 'border-border'
                  }`}
                >
                  <div className="text-sm font-medium break-all">{u.email}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <Badge variant={u.role === 'shogun' ? 'default' : 'secondary'}>{u.role}</Badge>
                    <Badge variant={u.is_pro ? 'default' : 'outline'}>{u.is_pro ? 'Pro' : 'Free'}</Badge>
                    <Badge variant="outline">{u.videos_analyzed} vids</Badge>
                    {u.account_status && u.account_status !== 'active' && (
                      <Badge variant="destructive">{u.account_status}</Badge>
                    )}
                  </div>
                </button>
              ))}
            </div>
            {/* Desktop table */}
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead className="text-right">Videos</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u) => (
                    <TableRow
                      key={u.id}
                      className={selectedId === u.id ? 'bg-muted/50' : 'cursor-pointer'}
                      onClick={() => {
                        setSelectedId(u.id)
                        setNotes(u.support_notes || '')
                      }}
                    >
                      <TableCell className="max-w-[180px] truncate">{u.email}</TableCell>
                      <TableCell>
                        <Badge variant={u.role === 'shogun' ? 'default' : 'secondary'}>{u.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.is_pro ? 'default' : 'outline'}>{u.is_pro ? 'Pro' : 'Free'}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{u.videos_analyzed}</TableCell>
                      <TableCell>{u.account_status || 'active'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {!overview && <div className="py-4 text-sm text-muted-foreground">Loading stats…</div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>User control</CardTitle>
            <CardDescription>
              {selected ? selected.email : 'Select a user to manage account, Pro, credits, and access.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {selected ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                  <div>Verified: {selected.email_verified_at ? 'Yes' : 'No'}</div>
                  <div>Consent: {Number(selected.consent_ai_training) === 1 ? 'Yes' : 'No'}</div>
                  <div>Bonus credits: {selected.bonus_video_credits ?? 0}</div>
                  <div>
                    Comp Pro:{' '}
                    {selected.comp_pro_until
                      ? new Date(selected.comp_pro_until).toLocaleDateString()
                      : '—'}
                  </div>
                  <div className="col-span-2">
                    Joined:{' '}
                    {selected.created_at ? new Date(selected.created_at).toLocaleDateString() : '—'}
                  </div>
                  {selected.consent_at && (
                    <div className="col-span-2">
                      Consent at: {new Date(selected.consent_at).toLocaleString()}
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <Label htmlFor="admin-reason">Reason (required for ban / Pro / consent)</Label>
                  <Input
                    id="admin-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Support ticket / influencer deal…"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="admin-notes">Support notes</Label>
                  <Textarea
                    id="admin-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="min-h-[72px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void runUserAction('set_notes')}
                  >
                    Save notes
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy} onClick={() => void runUserAction('verify_email')}>
                    Verify email
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void runUserAction('send_password_reset')}
                  >
                    Send password reset
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void runUserAction('grant_comp_pro')}
                  >
                    Grant Pro (30d)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void runUserAction('revoke_comp_pro')}
                  >
                    Revoke Pro
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void runUserAction('add_credits', { credits: 10 })}
                  >
                    Add 10 credits
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void runUserAction('mark_consent', { consent: true })}
                  >
                    Mark consent
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void runUserAction('revoke_sessions')}
                  >
                    Revoke sessions
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void runUserAction('suspend')}
                  >
                    Suspend
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy}
                    onClick={() => void runUserAction('ban')}
                  >
                    Ban
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void runUserAction('restore')}
                  >
                    Restore
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No user selected.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
