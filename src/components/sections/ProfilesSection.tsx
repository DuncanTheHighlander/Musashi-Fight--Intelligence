'use client'

import React, { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { FighterCard } from '@/components/social/FighterCard'
import {
  Search,
  Filter,
  Users,
  Shield,
} from 'lucide-react'
import { parseApiResponse } from '@/lib/safeJson'
import { SectionHeader, SectionShell, EmptySectionState } from '@/components/ui/section-header'

interface FighterProfile {
  id: string
  userId: string
  displayName: string
  bio: string
  location: { city: string; state: string; country: string }
  weightClass: string
  discipline: string
  record: { wins: number; losses: number; draws: number; kos: number }
  stance: string
  team: string
  isVerified: boolean
  isPro: boolean
  followers: number
  performanceStats: {
    avgHandSpeedBwps: number
    maxHandSpeedBwps: number
    avgPowerIndex: number
    maxPowerIndex: number
    totalSessions: number
    ranking: number
  }
  createdAt: string
  updatedAt: string
}

const disciplines = ['all', 'boxing', 'kickboxing', 'muay_thai', 'mma', 'other']

const disciplineLabels: Record<string, string> = {
  all: 'All Disciplines',
  boxing: 'Boxing',
  kickboxing: 'Kickboxing',
  muay_thai: 'Muay Thai',
  mma: 'MMA',
  other: 'Other',
}

export default function ProfilesSection() {
  const [profiles, setProfiles] = useState<FighterProfile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [discipline, setDiscipline] = useState('all')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const { toast } = useToast()

  const fetchProfiles = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (search) params.set('search', search)
      if (discipline !== 'all') params.set('discipline', discipline)
      if (verifiedOnly) params.set('verified', 'true')

      const res = await fetch(`/api/social/profiles?${params}`)
      if (!res.ok) throw new Error('Failed to fetch profiles')
      const data = (await parseApiResponse(res)) as Record<string, any>
      setProfiles(data.profiles || [])
    } catch {
      toast({ title: 'Error', description: 'Failed to load fighter profiles', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [discipline, search, toast, verifiedOnly])

  useEffect(() => {
    void fetchProfiles()
  }, [fetchProfiles])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    fetchProfiles()
  }

  const stats = [
    { label: 'Fighters Found', value: profiles.length },
    { label: 'Verified', value: profiles.filter(p => p.isVerified).length },
    { label: 'Pro Fighters', value: profiles.filter(p => p.isPro).length },
    { label: 'Disciplines', value: new Set(profiles.map(p => p.discipline)).size },
  ]
  const allStatsZero = stats.every(s => s.value === 0)

  return (
    <SectionShell>
      <SectionHeader
        icon={Users}
        eyebrow="Community"
        title="Fighter Directory"
        subtitle="Connect with fighters, coaches, and analysts in the community"
      />

      <Card className="mb-6 border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-5 sm:p-6">
          <form onSubmit={handleSearch} className="flex gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search fighters by name..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10 h-10 bg-background/50"
              />
            </div>
            <Button type="submit" className="h-10">
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
          </form>

          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {disciplines.map((d) => (
              <Button
                key={d}
                variant={discipline === d ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDiscipline(d)}
                className="h-8"
              >
                {disciplineLabels[d]}
              </Button>
            ))}
            <div className="ml-auto">
              <Button
                variant={verifiedOnly ? 'default' : 'outline'}
                size="sm"
                onClick={() => setVerifiedOnly(!verifiedOnly)}
                className="h-8"
              >
                <Shield className="h-3.5 w-3.5 mr-1.5" />
                Verified Only
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        {stats.map((stat, i) => (
          <Card key={i} className="border-border/50 bg-card/40">
            <CardContent className="p-4">
              <div className={`text-2xl font-bold ${allStatsZero ? 'text-muted-foreground/60' : 'text-primary'}`}>
                {allStatsZero ? '—' : stat.value}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{stat.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {[...Array(6)].map((_, i) => (
            <Card key={i} className="border-border/40 bg-card/30 animate-pulse">
              <CardContent className="p-6 h-48" />
            </Card>
          ))}
        </div>
      ) : profiles.length === 0 ? (
        <EmptySectionState
          icon={Users}
          title="No fighters found"
          description={
            search
              ? 'Try adjusting your search or filters.'
              : 'Be the first to publish a fighter profile — the directory is open for new arrivals.'
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {profiles.map((profile) => (
            <FighterCard
              key={profile.id}
              profile={{
                id: profile.id,
                display_name: profile.displayName,
                fighting_style: disciplineLabels[profile.discipline] || profile.discipline,
                weight_class: profile.weightClass,
                win_record: profile.record.wins,
                loss_record: profile.record.losses,
                draw_record: profile.record.draws,
                bio: profile.bio,
                verified: profile.isVerified,
              }}
            />
          ))}
        </div>
      )}
    </SectionShell>
  )
}
