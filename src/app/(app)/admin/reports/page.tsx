'use client'

/**
 * Shogun moderation queue for user-generated content reports.
 * Backed by GET /api/social/report (role: shogun).
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SectionHeader, SectionShell } from '@/components/ui/section-header'
import { useAuth } from '@/hooks/useAuth'
import { Flag, Loader2, RefreshCw } from 'lucide-react'

type ReportRow = {
  id: string
  reporter_user_id: string
  target_type: string
  target_id: string
  reason: string
  details: string | null
  status: string
  created_at: string
}

export default function AdminReportsPage() {
  const { user, loading: authLoading } = useAuth()
  const [reports, setReports] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/social/report?status=open&limit=50', { credentials: 'include' })
      const data = (await res.json()) as { reports?: ReportRow[]; error?: string }
      if (!res.ok) throw new Error(data.error || 'Failed to load reports')
      setReports(data.reports || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
      setReports([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (user?.role === 'shogun') void load()
    else setLoading(false)
  }, [authLoading, user, load])

  if (authLoading || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading reports…
      </div>
    )
  }

  if (user?.role !== 'shogun') {
    return (
      <SectionShell maxWidth="5xl">
        <p className="text-sm text-muted-foreground">Shogun access required.</p>
        <Button asChild variant="outline" className="mt-4">
          <Link href="/welcome">Sign in</Link>
        </Button>
      </SectionShell>
    )
  }

  return (
    <SectionShell maxWidth="5xl">
      <SectionHeader
        icon={Flag}
        eyebrow="Moderation"
        title="Content reports"
        subtitle="User-flagged marketplace and social content. Resolve in order; contact reporters if needed."
      />
      <div className="mb-4 flex gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          Refresh
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/shogun">Shogun console</Link>
        </Button>
      </div>
      {error && (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {reports.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No open reports.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <Card key={r.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center gap-2">
                  <CardTitle className="text-base">
                    {r.target_type}/{r.target_id}
                  </CardTitle>
                  <Badge variant="secondary">{r.reason}</Badge>
                  <Badge variant="outline">{r.status}</Badge>
                </div>
                <CardDescription>
                  Reported {new Date(r.created_at).toLocaleString()} · reporter {r.reporter_user_id.slice(0, 8)}…
                </CardDescription>
              </CardHeader>
              {r.details && (
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">{r.details}</p>
                  {r.target_type === 'job' && (
                    <Button asChild variant="link" className="mt-2 h-auto px-0">
                      <Link href={`/marketplace/jobs/${r.target_id}`}>Open job</Link>
                    </Button>
                  )}
                </CardContent>
              )}
            </Card>
          ))}
        </div>
      )}
    </SectionShell>
  )
}
