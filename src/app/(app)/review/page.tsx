'use client'

/**
 * Detection review — the human side of the learning loop.
 *
 * Lists saved analysis ledgers; each detected event/fault/pattern can be
 * confirmed, rejected, or relabeled. Verdicts accumulate into the labeled
 * dataset (export at /api/fight/ledgers/export) used to tune detectors.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SectionHeader } from '@/components/ui/section-header'
import { ClipboardCheck, Download, RefreshCw } from 'lucide-react'
import { resolveAssetHref } from '@/lib/storage/assetRef'

type LedgerSummary = {
  id: string
  videoFileName: string | null
  sourceId: string | null
  clipDurationMs: number | null
  eventCount: number
  faultCount: number
  patternCount: number
  correctionCount: number
  createdAt: string
}

type ReviewItem = {
  id: string
  kind: string
  actorId?: 'A' | 'B'
  t: { startMs: number; endMs: number }
  label?: string
  message?: string
  confidence?: { score: number }
  severity?: string
}

type LedgerDetail = {
  summary: LedgerSummary
  ledger: {
    events: ReviewItem[]
    faults: ReviewItem[]
    patterns: ReviewItem[]
    /** Sport / clipType / fighterFocus / pose metadata (analyses saved after the context update). */
    context?: {
      sport?: string | null
      clipType?: string | null
      fighterFocus?: string | null
      poseEngine?: string | null
      poseQuality?: number | string | null
    }
    /** Final coaching the user received (analyses saved after the context update). */
    coaching?: {
      model?: string | null
      mainDiagnosis?: string
      quickCues?: Array<{ actorId?: string; quickCue?: string; text?: string }>
      suggestedCorrections?: Array<{ actorId?: string; title?: string; why?: string; doInstead?: string }>
    } | null
  }
  corrections: Array<{
    itemId: string
    verdict: 'confirm' | 'reject' | 'relabel'
    correctedKind: string | null
    note?: string | null
  }>
  /** Thumbs up/down ratings users left on this analysis. */
  userFeedback?: Array<{
    id: string
    userId: string | null
    rating: -1 | 1
    aiModel: string | null
    discipline: string | null
    createdAt: string
  }>
}

const RELABEL_KINDS = [
  'jab', 'cross', 'lead_hook', 'rear_hook', 'lead_uppercut', 'rear_uppercut',
  'teep', 'lead_kick', 'rear_kick', 'stance', 'guard', 'range', 'movement', 'reset', 'other',
]

const fmtTime = (ms: number) => `${(ms / 1000).toFixed(1)}s`

const markedMomentMs = (note?: string | null): number => {
  const m = /atMs:(\d+)/.exec(note || '')
  return m ? Number(m[1]) : 0
}

export default function ReviewPage() {
  const [ledgers, setLedgers] = useState<LedgerSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<LedgerDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingItem, setPendingItem] = useState<string | null>(null)
  const [relabelOpen, setRelabelOpen] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [customDiscipline, setCustomDiscipline] = useState<string>('bjj')
  const [customKind, setCustomKind] = useState('')
  const videoRef = useRef<HTMLVideoElement | null>(null)

  // Playable source for the open analysis, when the clip was saved (asset ref or URL).
  const playableSrc =
    detail?.summary.sourceId &&
    (detail.summary.sourceId.startsWith('asset:') || detail.summary.sourceId.startsWith('http'))
      ? resolveAssetHref(detail.summary.sourceId)
      : null

  const seekTo = (ms: number) => {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, ms / 1000)
    void v.play().catch(() => {})
  }

  const [markDiscipline, setMarkDiscipline] = useState<string>('bjj')
  const [markKind, setMarkKind] = useState('')
  const [marking, setMarking] = useState(false)

  const markedMoments = (detail?.corrections || []).filter((c) => c.itemId.startsWith('manual_'))

  const loadLedgers = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/fight/ledgers')
      const data = (await res.json()) as { success: boolean; error?: string; ledgers: LedgerSummary[] }
      if (!data.success) throw new Error(data.error || 'Failed to load ledgers')
      setLedgers(data.ledgers)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ledgers')
    } finally {
      setLoading(false)
    }
  }, [])

  const openLedger = useCallback(async (id: string) => {
    setDetailLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/fight/ledgers?id=${encodeURIComponent(id)}`)
      const data = (await res.json()) as ({ success: boolean; error?: string } & LedgerDetail)
      if (!data.success) throw new Error(data.error || 'Failed to load ledger')
      setDetail(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ledger')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const markMoment = useCallback(async () => {
    if (!detail || !videoRef.current || !markKind.trim()) return
    const ms = Math.round(videoRef.current.currentTime * 1000)
    setMarking(true)
    setError(null)
    try {
      const res = await fetch('/api/fight/ledgers/corrections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ledgerId: detail.summary.id,
          itemType: 'event',
          itemId: `manual_${ms}_${Date.now()}`,
          originalKind: 'missed',
          verdict: 'relabel',
          correctedKind: `${markDiscipline}:${markKind.trim()}`,
          note: `atMs:${ms}`,
        }),
      })
      const data = (await res.json()) as { success: boolean; error?: string }
      if (!data.success) throw new Error(data.error || 'Failed to mark moment')
      setMarkKind('')
      await openLedger(detail.summary.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark moment')
    } finally {
      setMarking(false)
    }
  }, [detail, markDiscipline, markKind, openLedger])

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/auth/me')
        const data = await res.json().catch(() => null)
        setIsAdmin((data as { user?: { role?: string } } | null)?.user?.role === 'shogun')
      } catch {
        setIsAdmin(false)
      }
    })()
  }, [])

  useEffect(() => {
    void loadLedgers()
  }, [loadLedgers])

  const submitCorrection = useCallback(
    async (
      itemType: 'event' | 'fault' | 'pattern',
      item: ReviewItem,
      verdict: 'confirm' | 'reject' | 'relabel',
      correctedKind?: string
    ) => {
      if (!detail) return
      setPendingItem(item.id)
      setError(null)
      try {
        const res = await fetch('/api/fight/ledgers/corrections', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            ledgerId: detail.summary.id,
            itemType,
            itemId: item.id,
            originalKind: item.kind,
            verdict,
            correctedKind: correctedKind ?? null,
            actorId: item.actorId ?? null,
          }),
        })
        const data = (await res.json()) as { success: boolean; error?: string }
        if (!data.success) throw new Error(data.error || 'Failed to save correction')
        setRelabelOpen(null)
        await openLedger(detail.summary.id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save correction')
      } finally {
        setPendingItem(null)
      }
    },
    [detail, openLedger]
  )

  const verdictFor = (itemId: string) => {
    if (!detail) return null
    // Latest verdict wins.
    const matches = detail.corrections.filter((c) => c.itemId === itemId)
    return matches.length > 0 ? matches[matches.length - 1] : null
  }

  const renderItems = (title: string, itemType: 'event' | 'fault' | 'pattern', items: ReviewItem[]) => {
    if (items.length === 0) return null
    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{title}</h3>
        {items.map((item) => {
          const verdict = verdictFor(item.id)
          const busy = pendingItem === item.id
          return (
            <Card key={item.id} className="border-border/50 bg-card/60">
              <CardContent className="py-3 px-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono">{item.kind}</Badge>
                  {item.actorId && (
                    <Badge variant="secondary" className={item.actorId === 'A' ? 'text-blue-400' : 'text-red-400'}>
                      Fighter {item.actorId}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {fmtTime(item.t.startMs)}–{fmtTime(item.t.endMs)}
                  </span>
                  {typeof item.confidence?.score === 'number' && (
                    <span className="text-xs text-muted-foreground">conf {(item.confidence.score * 100).toFixed(0)}%</span>
                  )}
                  {verdict && (
                    <Badge
                      className={
                        verdict.verdict === 'confirm'
                          ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/40'
                          : verdict.verdict === 'reject'
                            ? 'bg-red-600/20 text-red-400 border-red-600/40'
                            : 'bg-amber-600/20 text-amber-400 border-amber-600/40'
                      }
                    >
                      {verdict.verdict === 'relabel' ? `relabeled → ${verdict.correctedKind}` : verdict.verdict}
                    </Badge>
                  )}
                  <div className="ml-auto flex items-center gap-1.5">
                    {playableSrc && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy}
                        className="h-7 px-2 text-xs"
                        onClick={() => seekTo(item.t.startMs)}
                      >
                        ▶ {fmtTime(item.t.startMs)}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      className="h-7 px-2 text-emerald-400 hover:text-emerald-300"
                      onClick={() => submitCorrection(itemType, item, 'confirm')}
                    >
                      ✓ Right
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      className="h-7 px-2 text-red-400 hover:text-red-300"
                      onClick={() => submitCorrection(itemType, item, 'reject')}
                    >
                      ✗ Wrong
                    </Button>
                    {itemType === 'event' && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        className="h-7 px-2"
                        onClick={() => {
                          setCustomKind('')
                          setRelabelOpen(relabelOpen === item.id ? null : item.id)
                        }}
                      >
                        Relabel
                      </Button>
                    )}
                  </div>
                </div>
                {(item.label || item.message) && (
                  <p className="mt-1 text-sm text-muted-foreground">{item.label || item.message}</p>
                )}
                {relabelOpen === item.id && (
                  <div className="mt-2 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {RELABEL_KINDS.filter((k) => k !== item.kind).map((kind) => (
                        <Button
                          key={kind}
                          size="sm"
                          variant="secondary"
                          disabled={busy}
                          className="h-6 px-2 text-xs font-mono"
                          onClick={() => submitCorrection(itemType, item, 'relabel', kind)}
                        >
                          {kind}
                        </Button>
                      ))}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-border/40 pt-2">
                      <span className="text-xs text-muted-foreground">Other art:</span>
                      <select
                        value={customDiscipline}
                        onChange={(e) => setCustomDiscipline(e.target.value)}
                        className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                      >
                        <option value="boxing">Boxing</option>
                        <option value="muay_thai">Muay Thai</option>
                        <option value="wrestling">Wrestling</option>
                        <option value="judo">Judo</option>
                        <option value="bjj">Jiu-Jitsu</option>
                        <option value="mma">MMA</option>
                        <option value="other">Other</option>
                      </select>
                      <Input
                        value={customKind}
                        onChange={(e) => setCustomKind(e.target.value)}
                        placeholder="type a technique (e.g. single leg, armbar, seoi nage)"
                        className="h-7 w-56 text-xs"
                      />
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busy || !customKind.trim()}
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          submitCorrection(itemType, item, 'relabel', `${customDiscipline}:${customKind.trim()}`)
                        }
                      >
                        Save label
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    )
  }

  if (isAdmin === false) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-lg font-semibold">Admin only</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The detection review &amp; labeling tools are restricted to the admin account.
        </p>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 lg:px-6 lg:py-10">
      <SectionHeader
        icon={ClipboardCheck}
        eyebrow="Learning Loop"
        title="Detection Review"
        subtitle="Confirm or correct what the system detected. Every verdict becomes labeled training data."
        className="mb-6"
      />

      {error && (
        <Card className="mb-4 border-red-600/40 bg-red-950/20">
          <CardContent className="py-3 px-4 text-sm text-red-400">{error}</CardContent>
        </Card>
      )}

      {!detail ? (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              {loading ? 'Loading analyses…' : `${ledgers.length} saved ${ledgers.length === 1 ? 'analysis' : 'analyses'}`}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void loadLedgers()} disabled={loading}>
                <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
              </Button>
              <Button size="sm" variant="outline" asChild>
                <a href="/api/fight/ledgers/export" download>
                  <Download className="h-3.5 w-3.5 mr-1" /> Export dataset
                </a>
              </Button>
            </div>
          </div>

          {!loading && ledgers.length === 0 && (
            <Card className="border-border/50 bg-card/60">
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                No saved analyses yet. Run an analysis in the Fight Lab and it will show up here for review.
              </CardContent>
            </Card>
          )}

          <div className="space-y-2">
            {ledgers.map((l) => (
              <Card
                key={l.id}
                className="border-border/50 bg-card/60 cursor-pointer transition hover:border-border"
                onClick={() => void openLedger(l.id)}
              >
                <CardContent className="py-3 px-4 flex flex-wrap items-center gap-3">
                  <span className="text-sm font-medium">
                    {l.videoFileName || l.sourceId || `Analysis ${l.id.slice(5, 13)}`}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(l.createdAt).toLocaleString()}</span>
                  <span className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{l.eventCount} events</Badge>
                    <Badge variant="outline">{l.faultCount} faults</Badge>
                    <Badge variant="outline">{l.patternCount} patterns</Badge>
                    {l.correctionCount > 0 && (
                      <Badge className="bg-emerald-600/20 text-emerald-400 border-emerald-600/40">
                        {l.correctionCount} reviewed
                      </Badge>
                    )}
                  </span>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <Button size="sm" variant="ghost" onClick={() => setDetail(null)}>
              ← All analyses
            </Button>
            <p className="text-sm text-muted-foreground">
              {detail.summary.videoFileName || detail.summary.sourceId || detail.summary.id} ·{' '}
              {new Date(detail.summary.createdAt).toLocaleString()}
            </p>
          </div>
          {detailLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-6">
              {playableSrc ? (
                <div className="space-y-2">
                  <video
                    ref={videoRef}
                    src={playableSrc}
                    controls
                    playsInline
                    className="w-full rounded-md border border-border/50 bg-black"
                  />
                  <div className="flex flex-wrap items-center gap-1.5 rounded-md border border-border/40 p-2">
                    <span className="text-xs text-muted-foreground">Mark a missed moment:</span>
                    <select
                      value={markDiscipline}
                      onChange={(e) => setMarkDiscipline(e.target.value)}
                      className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="boxing">Boxing</option>
                      <option value="muay_thai">Muay Thai</option>
                      <option value="wrestling">Wrestling</option>
                      <option value="judo">Judo</option>
                      <option value="bjj">Jiu-Jitsu</option>
                      <option value="mma">MMA</option>
                      <option value="other">Other</option>
                    </select>
                    <Input
                      value={markKind}
                      onChange={(e) => setMarkKind(e.target.value)}
                      placeholder="technique the AI missed (e.g. armbar, single leg)"
                      className="h-7 w-60 text-xs"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={marking || !markKind.trim()}
                      className="h-7 px-2 text-xs"
                      onClick={() => void markMoment()}
                    >
                      Mark at current time
                    </Button>
                  </div>
                  {markedMoments.length > 0 && (
                    <div className="space-y-1">
                      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your marked moments</h3>
                      {markedMoments.map((m) => (
                        <div key={m.itemId} className="flex items-center gap-2 text-xs">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2 text-xs"
                            onClick={() => seekTo(markedMomentMs(m.note))}
                          >
                            ▶ {fmtTime(markedMomentMs(m.note))}
                          </Button>
                          <Badge variant="secondary" className="font-mono">{m.correctedKind}</Badge>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <Card className="border-border/50 bg-card/60">
                  <CardContent className="py-3 px-4 text-xs text-muted-foreground">
                    No video saved for this analysis. New analyses run after this update will be saved here for playback.
                  </CardContent>
                </Card>
              )}
              {(detail.ledger.context || detail.ledger.coaching || (detail.userFeedback?.length ?? 0) > 0) && (
                <Card className="border-border/50 bg-card/60">
                  <CardContent className="space-y-3 py-4 px-4">
                    {detail.ledger.context && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold uppercase tracking-wide text-muted-foreground">Analysis context</span>
                        {detail.ledger.context.sport && <Badge variant="outline">Sport: {detail.ledger.context.sport}</Badge>}
                        {detail.ledger.context.clipType && <Badge variant="outline">Clip: {detail.ledger.context.clipType}</Badge>}
                        {detail.ledger.context.fighterFocus && <Badge variant="outline">Focus: {detail.ledger.context.fighterFocus}</Badge>}
                        {detail.ledger.context.poseEngine && <Badge variant="outline">Pose: {detail.ledger.context.poseEngine}</Badge>}
                        {detail.ledger.context.poseQuality != null && (
                          <Badge variant="outline">
                            Pose quality: {typeof detail.ledger.context.poseQuality === 'number'
                              ? detail.ledger.context.poseQuality.toFixed(2)
                              : detail.ledger.context.poseQuality}
                          </Badge>
                        )}
                      </div>
                    )}
                    {Array.isArray(detail.userFeedback) && detail.userFeedback.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="font-semibold uppercase tracking-wide text-muted-foreground">User feedback</span>
                        {detail.userFeedback.map((f) => (
                          <Badge
                            key={f.id}
                            className={
                              f.rating === 1
                                ? 'bg-emerald-600/20 text-emerald-400 border-emerald-600/40'
                                : 'bg-red-600/20 text-red-400 border-red-600/40'
                            }
                          >
                            {f.rating === 1 ? '👍' : '👎'} {new Date(f.createdAt).toLocaleDateString()}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {detail.ledger.coaching && (
                      <div className="space-y-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold uppercase tracking-wide text-muted-foreground">Final feedback shown to user</span>
                          {detail.ledger.coaching.model && (
                            <Badge variant="secondary" className="font-mono">{detail.ledger.coaching.model}</Badge>
                          )}
                        </div>
                        {detail.ledger.coaching.mainDiagnosis && (
                          <p className="text-sm text-foreground/90">{detail.ledger.coaching.mainDiagnosis}</p>
                        )}
                        {Array.isArray(detail.ledger.coaching.quickCues) && detail.ledger.coaching.quickCues.length > 0 && (
                          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                            {detail.ledger.coaching.quickCues.map((cue, i) => (
                              <li key={i}>
                                {cue.actorId ? `[${cue.actorId}] ` : ''}
                                {cue.quickCue || cue.text || ''}
                              </li>
                            ))}
                          </ul>
                        )}
                        {Array.isArray(detail.ledger.coaching.suggestedCorrections) &&
                          detail.ledger.coaching.suggestedCorrections.length > 0 && (
                            <ul className="list-decimal space-y-0.5 pl-5 text-muted-foreground">
                              {detail.ledger.coaching.suggestedCorrections.map((c, i) => (
                                <li key={i}>
                                  {c.actorId ? `[${c.actorId}] ` : ''}
                                  <span className="font-medium text-foreground/80">{c.title || 'Adjustment'}</span>
                                  {c.doInstead ? ` — ${c.doInstead}` : ''}
                                </li>
                              ))}
                            </ul>
                          )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
              {renderItems('Strikes & events', 'event', detail.ledger.events)}
              {renderItems('Faults', 'fault', detail.ledger.faults)}
              {renderItems('Patterns', 'pattern', detail.ledger.patterns)}
              {detail.ledger.events.length === 0 &&
                detail.ledger.faults.length === 0 &&
                detail.ledger.patterns.length === 0 && (
                  <Card className="border-border/50 bg-card/60">
                    <CardContent className="py-8 text-center text-sm text-muted-foreground">
                      This analysis produced no reviewable detections.
                    </CardContent>
                  </Card>
                )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
