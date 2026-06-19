'use client'

import React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import {
  Star,
  Users,
  Award,
  Play,
  ShoppingCart,
  BarChart3,
  Zap,
  Activity,
} from 'lucide-react'

interface ContentEffectiveness {
  techniqueSuccessRate: number
  avgImprovementRate: number
  userSkillLevel: 'beginner' | 'intermediate' | 'advanced' | 'pro'
  realWorldApplication: number
  biomechanicalEfficiency: number
  totalPractitioners: number
  verifiedResults: boolean
}

interface MarketplaceContent {
  id: string
  title: string
  creatorName: string
  creatorPerformance: {
    avgPowerIndex: number
    avgHandSpeedBwps: number
    totalSessions: number
  }
  type: 'technique' | 'breakdown' | 'training' | 'coaching'
  price: number
  rating: number
  salesCount: number
  effectivenessMetrics: ContentEffectiveness
  tags: string[]
  videoUrl: string
  thumbnailUrl: string
}

interface BiometricMarketplaceCardProps {
  content: MarketplaceContent
  currentUserMetrics?: {
    avgPowerIndex: number
    avgHandSpeedBwps: number
    consistencyScore: number
  }
  onPurchase?: (contentId: string) => void
  onPreview?: (contentId: string) => void
}

export function BiometricMarketplaceCard({
  content,
  currentUserMetrics,
  onPurchase,
  onPreview,
}: BiometricMarketplaceCardProps) {
  // Only meaningful when BOTH sides have real recorded sessions. Returns null
  // otherwise so the UI hides the compatibility row instead of fabricating
  // a "50%" placeholder that misleads the buyer.
  const getCompatibilityScore = (): number | null => {
    if (!currentUserMetrics) return null
    if (
      content.creatorPerformance.totalSessions <= 0 ||
      currentUserMetrics.avgPowerIndex <= 0
    ) {
      return null
    }

    const powerDiff = Math.abs(content.creatorPerformance.avgPowerIndex - currentUserMetrics.avgPowerIndex)
    const speedDiff = Math.abs(content.creatorPerformance.avgHandSpeedBwps - currentUserMetrics.avgHandSpeedBwps)

    const powerScore = Math.max(0, 1 - (powerDiff / 10))
    const speedScore = Math.max(0, 1 - (speedDiff / 5))
    return (powerScore + speedScore) / 2
  }

  const hasCreatorPerformance = content.creatorPerformance.totalSessions > 0
  const hasEffectivenessData = content.effectivenessMetrics.totalPractitioners > 0

  const getSkillLevelClasses = (level: string) => {
    switch (level) {
      case 'beginner':    return 'bg-green-500/15 text-green-400 ring-green-500/30'
      case 'intermediate': return 'bg-blue-500/15 text-blue-400 ring-blue-500/30'
      case 'advanced':    return 'bg-purple-500/15 text-purple-400 ring-purple-500/30'
      case 'pro':         return 'bg-orange-500/15 text-orange-400 ring-orange-500/30'
      default:            return 'bg-muted text-muted-foreground ring-border'
    }
  }

  const getEffectivenessLevel = (rate: number) => {
    if (rate >= 0.8) return { level: 'Excellent', color: 'text-green-500' }
    if (rate >= 0.6) return { level: 'Good',      color: 'text-blue-500' }
    if (rate >= 0.4) return { level: 'Fair',      color: 'text-yellow-500' }
    return            { level: 'Developing', color: 'text-muted-foreground' }
  }

  const compatibilityScore = getCompatibilityScore()
  const effectivenessLevel = getEffectivenessLevel(content.effectivenessMetrics.techniqueSuccessRate)

  // We deliberately do NOT animate this with a setInterval anymore — the
  // previous "live" pulse was just Math.random() drift on top of a static
  // value, which is a deceptive UX pattern. Effectiveness numbers now stay
  // stable until the next page load (which fetches the real aggregate).
  const displayEffectiveness = content.effectivenessMetrics

  return (
    <Card className="group flex h-full flex-col border-border/60 bg-card transition-all duration-300 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <CardTitle className="line-clamp-2 text-base font-semibold leading-snug">
              {content.title}
            </CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              <span className="truncate text-xs text-muted-foreground">by {content.creatorName}</span>
              {content.effectivenessMetrics.verifiedResults && (
                <Badge variant="secondary" className="border-0 bg-green-500/15 text-[10px] text-green-500">
                  <Award className="mr-1 h-3 w-3" />
                  Verified
                </Badge>
              )}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-xl font-bold tracking-tight text-foreground tabular-nums">
              ${content.price}
            </div>
            <Badge variant="outline" className="mt-1 border-border/70 text-[10px] capitalize text-muted-foreground">
              {content.type}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 space-y-4">
        {/* Creator performance — hidden when the creator has no recorded
            sessions yet. We don't render zeros that would imply "this creator
            has been measured at 0.0 power"; that's misleading. */}
        {hasCreatorPerformance ? (
          <div className="space-y-2 rounded-lg border border-border/40 bg-muted/40 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-xs uppercase tracking-wide text-muted-foreground/80">Creator</span>
              <div className="flex items-center gap-1.5 text-yellow-500">
                <Zap className="h-3.5 w-3.5" />
                <span className="text-sm font-semibold tabular-nums">
                  {content.creatorPerformance.avgPowerIndex.toFixed(1)} Power
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5">
                <Activity className="h-3 w-3 text-blue-500" />
                <span className="text-muted-foreground">
                  {content.creatorPerformance.avgHandSpeedBwps.toFixed(2)} BW/s
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <BarChart3 className="h-3 w-3 text-green-500" />
                <span className="text-muted-foreground">
                  {content.creatorPerformance.totalSessions} sessions
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border/50 bg-muted/20 p-3 text-xs text-muted-foreground">
            Creator hasn&apos;t published session metrics yet.
          </div>
        )}

        {/* Effectiveness metrics — only shown when there is real practitioner
            data behind them. Avoids "0% success rate" rendering on a brand
            new product, which would scare users away for the wrong reason. */}
        {hasEffectivenessData && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground/80">Effectiveness</span>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Success Rate</span>
                <span className={cn('font-medium tabular-nums', effectivenessLevel.color)}>
                  {effectivenessLevel.level} ({(displayEffectiveness.techniqueSuccessRate * 100).toFixed(0)}%)
                </span>
              </div>
              <Progress value={displayEffectiveness.techniqueSuccessRate * 100} className="h-1.5" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Avg Improvement</span>
                <span className="font-medium tabular-nums text-blue-500">
                  +{(displayEffectiveness.avgImprovementRate * 100).toFixed(0)}%
                </span>
              </div>
              <Progress value={displayEffectiveness.avgImprovementRate * 100} className="h-1.5" />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Real-world Application</span>
                <span className="font-medium tabular-nums text-purple-500">
                  {displayEffectiveness.realWorldApplication.toFixed(1)}x
                </span>
              </div>
              <Progress value={Math.min(displayEffectiveness.realWorldApplication * 20, 100)} className="h-1.5" />
            </div>
          </div>
        )}

        {/* Compatibility — only when BOTH the user and the creator have real
            recorded metrics. Otherwise we don't show "50% compatible" which
            was previously the placeholder default. */}
        {compatibilityScore !== null && (
          <div className="rounded-lg border border-border/40 bg-muted/30 p-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Compatibility with your level</span>
              <span className="font-medium tabular-nums text-green-500">
                {(compatibilityScore * 100).toFixed(0)}%
              </span>
            </div>
            <Progress value={compatibilityScore * 100} className="mt-1.5 h-1" />
          </div>
        )}

        {/* Skill Level & Practitioners */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                'border-0 capitalize ring-1',
                getSkillLevelClasses(content.effectivenessMetrics.userSkillLevel)
              )}
            >
              {content.effectivenessMetrics.userSkillLevel}
            </Badge>
            {displayEffectiveness.totalPractitioners > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                <span className="tabular-nums">{displayEffectiveness.totalPractitioners.toLocaleString()}</span>
              </div>
            )}
          </div>

          {(content.rating > 0 || content.salesCount > 0) && (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {content.rating > 0 && (
                <>
                  <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                  <span className="tabular-nums">{content.rating.toFixed(1)}</span>
                </>
              )}
              {content.salesCount > 0 && (
                <span className="text-muted-foreground/70">({content.salesCount.toLocaleString()} sold)</span>
              )}
            </div>
          )}
        </div>

        {/* Tags */}
        {content.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {content.tags.slice(0, 3).map((tag) => (
              <Badge key={tag} variant="secondary" className="text-[10px] capitalize">
                {tag}
              </Badge>
            ))}
            {content.tags.length > 3 && (
              <Badge variant="outline" className="text-[10px] text-muted-foreground">
                +{content.tags.length - 3}
              </Badge>
            )}
          </div>
        )}
      </CardContent>

      {/* Action Buttons */}
      <div className="flex gap-2 border-t border-border/40 p-4 pt-3">
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onPreview?.(content.id)}
          className="flex-1"
        >
          <Play className="mr-2 h-4 w-4" />
          Preview
        </Button>
        <Button
          size="sm"
          onClick={() => onPurchase?.(content.id)}
          className="flex-1"
        >
          <ShoppingCart className="mr-2 h-4 w-4" />
          Purchase
        </Button>
      </div>
    </Card>
  )
}

// Grid component for displaying multiple content items
export function BiometricMarketplaceGrid({
  contents,
  currentUserMetrics,
  onPurchase,
  onPreview,
}: {
  contents: MarketplaceContent[]
  currentUserMetrics?: {
    avgPowerIndex: number
    avgHandSpeedBwps: number
    consistencyScore: number
  }
  onPurchase?: (contentId: string) => void
  onPreview?: (contentId: string) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {contents.map((content) => (
        <BiometricMarketplaceCard
          key={content.id}
          content={content}
          currentUserMetrics={currentUserMetrics}
          onPurchase={onPurchase}
          onPreview={onPreview}
        />
      ))}
    </div>
  )
}
