'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { parseApiResponse } from '@/lib/safeJson'
import type { BusinessMetrics } from '@/lib/adminBusinessMetrics'
import { Loader2, RefreshCw } from 'lucide-react'

const money = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100)

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`)

type Props = {
  onError: (msg: string | null) => void
}

export function ShogunBusinessPanel({ onError }: Props) {
  const [data, setData] = useState<BusinessMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    onError(null)
    try {
      const res = await fetch('/api/shogun/business-metrics', { credentials: 'include' })
      const json = await parseApiResponse<BusinessMetrics & { error?: string }>(res)
      if (!res.ok) throw new Error(json?.error || 'Failed to load metrics')
      setData(json)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to load metrics')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [onError])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !data) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading business metrics…
      </div>
    )
  }

  if (!data) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between gap-3 p-6">
          <p className="text-sm text-muted-foreground">Could not load business metrics.</p>
          <Button variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { revenue, conversion, apiUsage } = data
  const maxBar = Math.max(
    1,
    ...revenue.byMonth.map((m) => m.proMrrCents + m.marketplaceFeeCents),
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Business</h2>
          <p className="text-sm text-muted-foreground">
            Estimated revenue, free→Pro conversion, and API usage cost. Updated{' '}
            {new Date(data.generatedAt).toLocaleString()}
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Est. MRR" value={money(revenue.estimatedMrrCents)} hint={`${revenue.activeProCount} active Pro`} />
        <StatCard label="Est. ARR" value={money(revenue.estimatedArrCents)} hint="MRR × 12" />
        <StatCard
          label="This month (est.)"
          value={money(revenue.thisMonthTotalCents)}
          hint="Pro MRR snapshot + marketplace fees"
        />
        <StatCard
          label="Free → Pro"
          value={pct(conversion.conversionRate)}
          hint={`${conversion.convertedFromFree} / ${conversion.freeStarters} free starters`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Conversion funnel</CardTitle>
            <CardDescription>Excludes admin accounts.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <FunnelRow label="Users" value={conversion.totalUsers} />
            <FunnelRow label="Used free analysis" value={conversion.freeStarters} />
            <FunnelRow label="Exhausted free (3 credits)" value={conversion.freeExhausted} />
            <FunnelRow label="Active Pro" value={conversion.activePro} />
            <FunnelRow label="Converted (started free → Pro)" value={conversion.convertedFromFree} />
            <div className="flex items-center justify-between border-t border-border/60 pt-2">
              <span className="text-muted-foreground">Exhausted → Pro rate</span>
              <Badge variant="secondary">{pct(conversion.exhaustedToProRate)}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">API usage (30 days)</CardTitle>
            <CardDescription>Counts from daily usage + fixed cost estimates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <FunnelRow label="Analyze calls" value={apiUsage.last30d.analyze} />
            <FunnelRow label="Chat calls" value={apiUsage.last30d.chat} />
            <FunnelRow label="Reflex / track" value={apiUsage.last30d.reflex + apiUsage.last30d.track} />
            <FunnelRow label="Est. API cost" value={money(apiUsage.last30d.estCostCents)} />
            <FunnelRow label="Prior 30d cost" value={money(apiUsage.prior30d.estCostCents)} />
            <div className="flex items-center justify-between border-t border-border/60 pt-2">
              <span className="text-muted-foreground">Cost growth vs prior 30d</span>
              <Badge variant={apiUsage.growthPct != null && apiUsage.growthPct > 0 ? 'destructive' : 'secondary'}>
                {pct(apiUsage.growthPct)}
              </Badge>
            </div>
            <p className="pt-1 text-xs text-muted-foreground">
              Rough monthly contribution ≈ this month revenue − that month&apos;s est. API cost (see table).
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Last 12 months</CardTitle>
          <CardDescription>
            Marketplace fees/GMV by month. Pro MRR is shown on the current month only (live snapshot).
            All-time marketplace fees {money(revenue.marketplaceFeeCentsAllTime)} · GMV{' '}
            {money(revenue.marketplaceGmvCentsAllTime)}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex h-36 items-end gap-1 sm:gap-2">
            {revenue.byMonth.map((m) => {
              const total = m.proMrrCents + m.marketplaceFeeCents
              const h = Math.max(4, Math.round((total / maxBar) * 100))
              return (
                <div key={m.month} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-primary/80"
                    style={{ height: `${h}%` }}
                    title={`${m.month}: ${money(total)}`}
                  />
                  <span className="text-[10px] text-muted-foreground">{m.month.slice(5)}</span>
                </div>
              )
            })}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-border/60 text-xs text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Month</th>
                  <th className="py-2 pr-3 font-medium">Pro MRR</th>
                  <th className="py-2 pr-3 font-medium">Mkt fees</th>
                  <th className="py-2 pr-3 font-medium">Mkt GMV</th>
                  <th className="py-2 pr-3 font-medium">Est. API $</th>
                  <th className="py-2 font-medium">Analyzes</th>
                </tr>
              </thead>
              <tbody>
                {[...revenue.byMonth].reverse().map((m) => (
                  <tr key={m.month} className="border-b border-border/40">
                    <td className="py-2 pr-3 tabular-nums">{m.month}</td>
                    <td className="py-2 pr-3 tabular-nums">{money(m.proMrrCents)}</td>
                    <td className="py-2 pr-3 tabular-nums">{money(m.marketplaceFeeCents)}</td>
                    <td className="py-2 pr-3 tabular-nums">{money(m.marketplaceGmvCents)}</td>
                    <td className="py-2 pr-3 tabular-nums">{money(m.estApiCostCents)}</td>
                    <td className="py-2 tabular-nums">{m.analyzeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {data.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {data.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
        {hint ? <div className="mt-1 text-[11px] text-muted-foreground/80">{hint}</div> : null}
      </CardContent>
    </Card>
  )
}

function FunnelRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums text-foreground">{value}</span>
    </div>
  )
}
