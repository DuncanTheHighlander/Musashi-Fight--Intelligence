'use client'

/**
 * CoachLeaderboard — shared belt-ranking list used by both the /coaches route
 * and the in-app Coaches section. Fetches the unified ranking and renders each
 * coach with their CoachBeltBadge. See lib/marketplace/coachRank.ts.
 */

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { parseApiResponse } from '@/lib/safeJson'
import { CoachBeltBadge } from '@/components/marketplace/CoachBeltBadge'
import { BeltLadderBar } from '@/components/marketplace/BeltLadderBar'
import type { BeltColorKey } from '@/lib/marketplace/coachRank'
import { EmptySectionState } from '@/components/ui/section-header'
import { Trophy, Star, CheckCircle2, Sparkles, ShieldQuestion } from 'lucide-react'

export interface CoachRow {
  position: number
  userId: string
  displayName: string
  title: string
  discipline: string
  isVerified: boolean
  isPro: boolean
  belt: {
    key: BeltColorKey
    label: string
    stripes: number
    degree: number
    rankLabel: string
    rankIndex: number
  }
  score: number
  stats: {
    qualityRating: number
    reviewCount: number
    jobsCompleted: number
    salesCount: number
    prepFeeling: number
    prepResponses: number
    wins: number
    losses: number
    draws: number
  }
}

const MEDAL = ['🥇', '🥈', '🥉']

function beltToBadge(belt: CoachRow['belt']) {
  return {
    beltKey: belt.key,
    beltLabel: belt.label,
    stripes: belt.stripes,
    degree: belt.degree,
    label: belt.rankLabel,
  }
}

export function CoachLeaderboard({ limit = 50 }: { limit?: number }) {
  const { toast } = useToast()
  const [coaches, setCoaches] = useState<CoachRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchLeaderboard = useCallback(async () => {
    setError(false)
    setLoading(true)
    try {
      const res = await fetch(`/api/social/coaches/leaderboard?limit=${limit}`, {
        credentials: 'include',
      })
      const data = await parseApiResponse<{ coaches: CoachRow[] }>(res)
      setCoaches(data.coaches || [])
    } catch (err) {
      setError(true)
      toast({
        title: 'Failed to load rankings',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [limit, toast])

  useEffect(() => {
    fetchLeaderboard()
  }, [fetchLeaderboard])

  const body = loading ? (
    <div className="space-y-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-20 rounded-lg" />
      ))}
    </div>
  ) : error ? (
    <EmptySectionState
      icon={ShieldQuestion}
      title="Could not load rankings"
      description="Check your connection and try again."
      action={
        <Button variant="outline" onClick={fetchLeaderboard}>
          Retry
        </Button>
      }
    />
  ) : coaches.length === 0 ? (
    <EmptySectionState
      icon={Trophy}
      title="No ranked coaches yet"
      description="Coaches appear here once they take jobs, sell content, or earn reviews."
    />
  ) : (
    <ol className="space-y-3">
      {coaches.map((c) => (
        <li key={c.userId}>
          <Card className="transition-all hover:border-primary/60 hover:shadow-md">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="w-8 shrink-0 text-center text-lg font-bold tabular-nums">
                {c.position <= 3 ? MEDAL[c.position - 1] : c.position}
              </div>

              <CoachBeltBadge rank={beltToBadge(c.belt)} size={44} showLabel={false} />

              <Avatar className="h-10 w-10 shrink-0">
                <AvatarFallback className="bg-primary/20 text-primary font-bold">
                  {(c.displayName.slice(0, 2) || '??').toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold">{c.displayName}</span>
                  {c.isVerified && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
                  {c.isPro && <Sparkles className="h-4 w-4 shrink-0 text-amber-500" />}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="font-semibold text-foreground">{c.title}</span>
                  <span>{c.belt.rankLabel}</span>
                  {c.discipline && <span className="capitalize">{c.discipline}</span>}
                  <span className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                    {c.stats.qualityRating.toFixed(1)} ({c.stats.reviewCount})
                  </span>
                  {c.stats.prepResponses > 0 && (
                    <span>prep felt {c.stats.prepFeeling.toFixed(1)}/5</span>
                  )}
                </div>
              </div>

              <Badge variant="secondary" className="shrink-0 tabular-nums">
                {c.score.toFixed(1)}
              </Badge>
            </CardContent>
          </Card>
        </li>
      ))}
    </ol>
  )

  return (
    <>
      <BeltLadderBar />
      {body}
    </>
  )
}
