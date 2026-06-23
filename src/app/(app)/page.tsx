'use client'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Award,
  Brain,
  MessageSquare,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  Users,
  Video,
} from 'lucide-react'
import { MusashiIcon, MusashiWordmark } from '@/components/icons/MusashiIcon'
import { parseApiResponse } from '@/lib/safeJson'
import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSection } from '@/contexts/SectionContext'

// FightCoachExperience pulls in MediaPipe + WASM. Loading it on the server
// (or even on the client during the initial RSC payload) crashes the dev
// server's 2 GB heap and ships ~3 MB of WASM-touching code into First Load JS.
// Dynamic + ssr:false keeps the home shell instant and defers the pose stack
// until the user actually opens the Fight Lab.
const FightCoachExperience = dynamic(() => import('@/components/fight/FightCoachExperience'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] items-center justify-center rounded-2xl border border-border bg-card">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  ),
})

import ProfilesSection from '@/components/sections/ProfilesSection'
import MarketplaceSection from '@/components/sections/MarketplaceSection'
import ScoutingSection from '@/components/sections/ScoutingSection'
import CoachesSection from '@/components/sections/CoachesSection'
import MessagesSection from '@/components/sections/MessagesSection'
import LibrarySection from '@/components/sections/LibrarySection'
import ProfileSection from '@/components/sections/ProfileSection'

export default function HomePage() {
  const { activeSection } = useSection()
  const [bootstrapVideoFile, setBootstrapVideoFile] = useState<File | null>(null)
  const [autoPlayFixture, setAutoPlayFixture] = useState(false)
  const fixtureLoadedRef = useRef(false)
  const [stats, setStats] = useState({
    aiAnalyses: 0,
    videosReviewed: 0,
    community: 0,
    techniques: 0,
    aiAnalysesTrend: '+0%',
    videosReviewedTrend: '+0%',
    communityTrend: '+0%',
    techniquesTrend: '+0%',
  })
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const fetchStats = async () => {
      try {
        const response = await fetch('/api/stats')
        if (cancelled) return
        if (response.ok) {
          const data = (await parseApiResponse(response)) as {
            aiAnalyses: number
            videosReviewed: number
            community: number
            techniques: number
            aiAnalysesTrend: string
            videosReviewedTrend: string
            communityTrend: string
            techniquesTrend: string
          }
          if (!cancelled) {
            setStats(data)
            setStatsError(false)
          }
        } else {
          setStatsError(true)
        }
      } catch (e) {
        console.error('Failed to fetch stats:', e)
        if (!cancelled) setStatsError(true)
      } finally {
        if (!cancelled) setStatsLoading(false)
      }
    }
    void fetchStats()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && !new URLSearchParams(window.location.search).get('qaLoop')) return
    const params = new URLSearchParams(window.location.search)
    const qaLoop = params.get('qaLoop') === '1'
    if (!qaLoop && process.env.NODE_ENV === 'production') return

    const fixtureVideo = params.get('fixtureVideo')
    const fixtureAutoPlay = params.get('fixtureAutoplay') === '1'
    if (!fixtureVideo?.startsWith('/test-videos/')) {
      if (qaLoop && !fixtureLoadedRef.current) {
        void fetch('/test-videos/clips.manifest.json')
          .then((r) => r.json())
          .then((raw: unknown) => {
            const m = raw as { clips: Array<{ url: string }> }
            const first = m.clips[0]?.url
            if (first) {
              params.set('fixtureVideo', first)
              params.set('qaClip', '0')
              window.location.search = params.toString()
            }
          })
          .catch(() => {})
      }
      return
    }

    let cancelled = false
    const loadFixture = async () => {
      const res = await fetch(fixtureVideo)
      if (!res.ok) throw new Error(`Fixture video failed to load: ${res.status}`)
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.startsWith('video/')) {
        throw new Error(`Fixture did not return a video: ${contentType || 'unknown content type'}`)
      }
      const blob = await res.blob()
      if (blob.size < 1024) throw new Error('Fixture video response was empty')
      if (cancelled || fixtureLoadedRef.current) return
      const name = fixtureVideo.split('/').pop() || 'fixture-video.mp4'
      const file = new File([blob], name, { type: blob.type || 'video/mp4' })
      fixtureLoadedRef.current = true
      setAutoPlayFixture(fixtureAutoPlay)
      setBootstrapVideoFile(file)
    }

    void loadFixture().catch((error) => {
      fixtureLoadedRef.current = false
      console.warn('[fixture] video load failed', error)
    })

    return () => {
      cancelled = true
    }
  }, [])

  /** QA loop: after dense pass on clip N, auto-advance to clip N+1 (dev / ?qaLoop=1). */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('qaLoop') !== '1') return

    const onDenseReady = async () => {
      const manifest = await fetch('/test-videos/clips.manifest.json').then((r) => r.json()) as {
        clips: Array<{ id: string; url: string; label: string }>
      }
      const idx = Number(params.get('qaClip') ?? '0')
      const current = manifest.clips[idx]
      console.log(`[qaLoop] dense pass complete — ${current?.label ?? idx}`)
      const next = idx + 1
      if (next >= manifest.clips.length) {
        console.log('[qaLoop] all clips done — loop complete')
        return
      }
      params.set('qaClip', String(next))
      params.set('fixtureVideo', manifest.clips[next]!.url)
      fixtureLoadedRef.current = false
      window.location.search = params.toString()
    }

    window.addEventListener('musashi:dense-ready', onDenseReady)
    return () => window.removeEventListener('musashi:dense-ready', onDenseReady)
  }, [])

  const scrollToFightLab = useCallback(() => {
    requestAnimationFrame(() => {
      document.getElementById('fight-lab-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const clearBootstrapVideo = useCallback(() => setBootstrapVideoFile(null), [])
  const OFFLINE = process.env.NEXT_PUBLIC_OFFLINE_MODE === '1'

  const onHeroFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBootstrapVideoFile(f)
  }

  if (activeSection === 'fighters') return <ProfilesSection />
  if (activeSection === 'marketplace') return <MarketplaceSection />
  if (activeSection === 'scouting') return <ScoutingSection />
  if (activeSection === 'coaches') return <CoachesSection />
  if (activeSection === 'messages') return <MessagesSection />
  if (activeSection === 'library') return <LibrarySection />
  if (activeSection === 'profile') return <ProfileSection />

  return (
    <div className="container mx-auto max-w-6xl space-y-8 p-4 lg:p-6">
      {OFFLINE && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300">
          <strong>Offline mode active.</strong> Coaching analysis is mocked and not running on Gemini.
          Unset <code className="text-xs">NEXT_PUBLIC_OFFLINE_MODE</code> to use real AI.
        </div>
      )}
      <input
        id="musashi-hero-video-input"
        type="file"
        accept="video/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
        className="sr-only"
        aria-label="Upload a fight video"
        onChange={onHeroFileChange}
      />

      <div className="musashi-card-lift relative overflow-hidden rounded-3xl border border-border/60 bg-card shadow-xl">
        {/* Soft warm-earth gradient + subtle grid */}
        <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-primary/5" />
        <div className="absolute inset-0 bg-[url('/grid.svg')] opacity-[0.06]" />

        <div className="relative px-6 py-12 sm:px-10 sm:py-16 lg:px-14 lg:py-20">
          <div className="flex flex-col items-center text-center gap-8 lg:gap-10">
            <Badge
              variant="secondary"
              className="border-0 bg-primary/15 px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-primary"
            >
              <Sparkles className="mr-1.5 h-3 w-3" />
              AI Fight Intelligence
            </Badge>

            <MusashiWordmark
              height={96}
              className="w-full max-w-3xl lg:!h-[140px]"
            />

            <p className="max-w-xl text-balance text-base sm:text-lg leading-relaxed text-muted-foreground">
              Your AI fight coach, analyst, and training partner.
              Upload footage for local skeleton tracking, tactical coaching,
              and clean breakdown tools — in one place.
            </p>

            {bootstrapVideoFile && (
              <div
                role="status"
                className="flex flex-col sm:flex-row items-center gap-2 rounded-xl border border-primary/35 bg-primary/10 px-4 py-3 text-sm text-primary"
              >
                <Video className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate font-medium">{bootstrapVideoFile.name}</span>
                <span className="text-primary/70">— loading in Fight Lab below</span>
              </div>
            )}

            {/* Subtle samurai blade accent */}
            <div className="flex items-center gap-3 text-muted-foreground/50">
              <span className="h-px w-12 bg-gradient-to-r from-transparent to-primary/40" />
              <span className="h-1.5 w-1.5 rotate-45 bg-primary/40" />
              <span className="h-px w-12 bg-gradient-to-l from-transparent to-primary/40" />
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4">
              <Button
                size="lg"
                className="bg-primary hover:bg-primary/90 px-8 h-12 text-base shadow-md"
                asChild
              >
                <label htmlFor="musashi-hero-video-input" className="inline-flex cursor-pointer items-center">
                  <Upload className="mr-2 h-4 w-4" />
                  Upload a Clip
                </label>
              </Button>
              <Button
                size="lg"
                variant="ghost"
                type="button"
                onClick={scrollToFightLab}
                className="px-6 h-12 text-base text-foreground hover:bg-foreground/5"
              >
                Open Fight Lab
                <MessageSquare className="ml-2 h-4 w-4 opacity-60" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {(() => {
        const allZero =
          !statsLoading &&
          !statsError &&
          stats.aiAnalyses === 0 &&
          stats.videosReviewed === 0 &&
          stats.community === 0 &&
          stats.techniques === 0

        const cards = [
          { icon: Brain, label: 'AI Analyses', raw: stats.aiAnalyses, trend: stats.aiAnalysesTrend },
          { icon: Video, label: 'Videos Reviewed', raw: stats.videosReviewed, trend: stats.videosReviewedTrend },
          { icon: Users, label: 'Community', raw: stats.community, trend: stats.communityTrend },
          { icon: Award, label: 'Techniques', raw: stats.techniques, trend: stats.techniquesTrend },
        ]

        const formatValue = (label: string, raw: number) => {
          if (statsLoading) return '…'
          if (statsError) return '—'
          if (label === 'Community' && raw >= 1000) return `${(raw / 1000).toFixed(1)}K`
          return raw.toLocaleString()
        }

        return (
          <section aria-label="Platform activity">
            <h2 className="font-display mb-4 text-sm tracking-[0.14em] text-muted-foreground">
              Platform Activity
            </h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {cards.map((stat, i) => {
              // When the app is genuinely empty (no usage data yet), we suppress
              // the "+0%" trend chip — a graveyard of green/gray "+0%" badges
              // signals a broken or abandoned product. We also swap "0" for a
              // muted dash, so the card reads as "ready, waiting for data"
              // instead of "zero users / zero activity".
              const showTrend = !allZero && !statsLoading
              const displayValue = allZero ? '—' : formatValue(stat.label, stat.raw)
              // Tints chosen to stay legible on both the dark (default) and
              // light surfaces — the previous 700-weight text was near-invisible
              // on the dark warm-earth background.
              const trendColorClass = statsError
                ? 'border-0 bg-amber-500/15 text-amber-600 dark:text-amber-300'
                : stat.trend.startsWith('+') && stat.trend !== '+0%'
                  ? 'border-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                  : 'border-0 bg-muted text-muted-foreground'

              return (
                <Card key={i} className="musashi-card-lift border-border/60 bg-card shadow-sm">
                  <CardContent className="p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                        <stat.icon className="h-4 w-4 text-primary" />
                      </div>
                      {showTrend ? (
                        <Badge variant="secondary" className={cn('text-xs', trendColorClass)}>
                          {statsError ? 'Unavailable' : stat.trend}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-3">
                      <div className={cn('font-display text-2xl tabular-nums tracking-wide', allZero && 'text-muted-foreground/60')}>
                        {displayValue}
                      </div>
                      <div className="mt-0.5 text-xs font-medium text-muted-foreground">{stat.label}</div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
            </div>
          </section>
        )
      })()}

      <section id="fight-lab-anchor" className="scroll-mt-24 outline-none" tabIndex={-1} aria-label="Fight Lab">
        <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Fight Lab
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload a clip or try the demo — choose a clip, then wait for Ready and press Play.
            </p>
          </div>
          <Badge variant="secondary" className="w-fit border-0 bg-primary/12 text-primary">
            <Target className="mr-1.5 h-3 w-3" />
            Local CV first
          </Badge>
        </div>
        <FightCoachExperience
          hideShellHeader
          bootstrapVideoFile={bootstrapVideoFile}
          autoPlayOnReady={autoPlayFixture}
          onBootstrapConsumed={clearBootstrapVideo}
        />
      </section>
    </div>
  )
}
