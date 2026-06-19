'use client'

import Link from 'next/link'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { BeltBadge, type BeltTier } from './BeltBadge'
import { formatCents } from '@/lib/currency'
import { Star, Clock, CheckCircle2, Sparkles } from 'lucide-react'

export interface AnalystCardData {
  userId: string
  displayName: string
  discipline: string
  isVerified: boolean
  isPro: boolean
  beltTier: BeltTier
  avgOverall: number
  reviewCount: number
  jobsCompleted: number
  turnaroundHours: number
  directHireEnabled: boolean
  directHireRateCents: number
  specialties: string[]
  bio: string
}

export function AnalystCard({ analyst }: { analyst: AnalystCardData }) {
  const initials = analyst.displayName.substring(0, 2).toUpperCase() || '??'
  return (
    <Link href={`/marketplace/analysts/${analyst.userId}`} className="block">
      <Card className="h-full transition-all hover:border-primary/60 hover:shadow-md">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-primary/20 text-primary font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <h3 className="font-semibold truncate">{analyst.displayName || 'Unnamed'}</h3>
                {analyst.isVerified && (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                )}
                {analyst.isPro && (
                  <Sparkles className="h-4 w-4 text-amber-500 shrink-0" />
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate capitalize">
                {analyst.discipline || 'Coach'}
              </p>
              <div className="mt-1.5">
                <BeltBadge tier={analyst.beltTier} showLabel={false} className="text-[10px] py-0 px-2" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground line-clamp-2">
            {analyst.bio || 'No bio yet.'}
          </p>
          {analyst.specialties.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {analyst.specialties.slice(0, 4).map((s) => (
                <Badge key={s} variant="secondary" className="text-[10px] px-2 py-0">
                  {s}
                </Badge>
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm pt-1">
            <span className="flex items-center gap-1">
              <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
              <span className="font-semibold">{analyst.avgOverall.toFixed(1)}</span>
              <span className="text-muted-foreground text-xs">({analyst.reviewCount})</span>
            </span>
            <span className="flex items-center gap-1 text-muted-foreground text-xs">
              <Clock className="h-3.5 w-3.5" />
              {analyst.turnaroundHours}h turnaround
            </span>
            <span className="text-muted-foreground text-xs">
              {analyst.jobsCompleted} jobs done
            </span>
          </div>
          {analyst.directHireEnabled && analyst.directHireRateCents > 0 && (
            <div className="text-sm font-semibold text-primary pt-1">
              Direct hire {formatCents(analyst.directHireRateCents)}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  )
}
