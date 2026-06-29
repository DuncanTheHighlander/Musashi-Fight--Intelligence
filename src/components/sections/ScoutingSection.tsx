'use client'

import React, { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useToast } from '@/hooks/use-toast'
import { ScoutingCard } from '@/components/social/ScoutingCard'
import {
  Filter,
  Target,
  Plus,
  DollarSign,
  Eye,
  ArrowRight,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { parseApiResponse } from '@/lib/safeJson'
import { SectionHeader, SectionShell, EmptySectionState } from '@/components/ui/section-header'

interface ScoutingRequest {
  id: string
  authorId: string
  authorName: string
  opponentName: string
  opponentInfo: {
    weightClass: string
    record: string
    notableFights: string[]
    style: string
  }
  fightDate: string | null
  location: string
  description: string
  videos: string[]
  tags: string[]
  status: 'open' | 'in_progress' | 'completed'
  responseCount: number
  budget: number
  visibility: 'public' | 'targeted'
  createdAt: string
  updatedAt: string
}

const statusFilters = ['all', 'open', 'in_progress', 'completed'] as const

const statusLabels: Record<string, string> = {
  all: 'All',
  open: 'Open',
  in_progress: 'In Progress',
  completed: 'Completed',
}

const PREVIEW_ENABLED = process.env.NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES === '1'

export default function ScoutingSection() {
  const [requests, setRequests] = useState<ScoutingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const { toast } = useToast()

  const [formOpponentName, setFormOpponentName] = useState('')
  const [formLocation, setFormLocation] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formFightDate, setFormFightDate] = useState('')
  const [formBudget, setFormBudget] = useState('')
  const [formWeightClass, setFormWeightClass] = useState('')
  const [formStyle, setFormStyle] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const { user } = useAuth()

  const fetchRequests = useCallback(async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      if (statusFilter !== 'all') params.set('status', statusFilter)

      const res = await fetch(`/api/social/scouting?${params}`)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = (await parseApiResponse(res)) as Record<string, any>
      setRequests(data.requests || [])
    } catch {
      toast({ title: 'Error', description: 'Failed to load scouting requests', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [statusFilter, toast])

  useEffect(() => {
    if (!PREVIEW_ENABLED) return
    void fetchRequests()
  }, [fetchRequests])

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formOpponentName.trim() || !formLocation.trim() || !formDescription.trim()) {
      toast({ title: 'Missing fields', description: 'Opponent name, location, and description are required', variant: 'destructive' })
      return
    }

    try {
      setSubmitting(true)
      const res = await fetch('/api/social/scouting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opponentName: formOpponentName.trim(),
          location: formLocation.trim(),
          description: formDescription.trim(),
          fightDate: formFightDate || null,
          budget: parseFloat(formBudget) || 0,
          opponentInfo: {
            weightClass: formWeightClass,
            record: '',
            notableFights: [],
            style: formStyle,
          },
        }),
      })

      if (!res.ok) throw new Error('Failed to create')

      toast({ title: 'Posted!', description: 'Your fight post is now live' })
      setShowCreateForm(false)
      setFormOpponentName('')
      setFormLocation('')
      setFormDescription('')
      setFormFightDate('')
      setFormBudget('')
      setFormWeightClass('')
      setFormStyle('')
      fetchRequests()
    } catch {
      toast({ title: 'Error', description: 'Failed to create post', variant: 'destructive' })
    } finally {
      setSubmitting(false)
    }
  }

  const paidRequests = requests.filter(r => r.budget > 0)
  const freeRequests = requests.filter(r => !r.budget || r.budget === 0)

  if (!PREVIEW_ENABLED) {
    return (
      <SectionShell>
        <SectionHeader
          icon={Target}
          eyebrow="Opponent scouting"
          title="Scout your next opponent"
          subtitle="Post upcoming fights with opponent tape. Verified coaches send back a video game plan."
        />
        <Card className="border-border/60 bg-card">
          <CardContent className="flex flex-col items-center gap-4 p-10 text-center sm:p-12">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Target className="h-7 w-7" />
            </div>
            <div className="max-w-md space-y-2">
              <CardTitle className="text-xl">Scouting is on the Coaches page</CardTitle>
              <CardDescription>
                Upload your clips and opponent footage — coaches deliver video breakdowns with escrow protection.
              </CardDescription>
            </div>
            <Button asChild size="lg" className="gap-2">
              <Link href="/marketplace/scout">
                Scout an opponent
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </SectionShell>
    )
  }

  return (
    <SectionShell>
      <SectionHeader
        icon={Target}
        eyebrow="Pre-Fight"
        title="Opponent Scouting"
        subtitle="Post upcoming fights, get opponent breakdowns from the community"
        action={
          <Button onClick={() => setShowCreateForm(!showCreateForm)} className="h-10">
            <Plus className="h-4 w-4 mr-2" />
            Post a Fight
          </Button>
        }
      />

        {showCreateForm && (
          <Card className="mb-8 bg-card/50 backdrop-blur-sm border-primary/30">
            <CardContent className="p-6">
              <h2 className="text-xl font-semibold mb-4">Post Your Upcoming Fight</h2>
              <form onSubmit={handleCreatePost} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1 block">Opponent Name *</label>
                    <Input
                      placeholder="Who are you fighting?"
                      value={formOpponentName}
                      onChange={(e) => setFormOpponentName(e.target.value)}
                      className="bg-background/50"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1 block">Location *</label>
                    <Input
                      placeholder="Event location"
                      value={formLocation}
                      onChange={(e) => setFormLocation(e.target.value)}
                      className="bg-background/50"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1 block">Fight Date</label>
                    <Input
                      type="date"
                      value={formFightDate}
                      onChange={(e) => setFormFightDate(e.target.value)}
                      className="bg-background/50"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1 block">Budget ($)</label>
                    <Input
                      type="number"
                      min="0"
                      step="5"
                      placeholder="0 = free advice, or set a budget"
                      value={formBudget}
                      onChange={(e) => setFormBudget(e.target.value)}
                      className="bg-background/50"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1 block">Weight Class</label>
                    <Input
                      placeholder="e.g. Lightweight, Welterweight"
                      value={formWeightClass}
                      onChange={(e) => setFormWeightClass(e.target.value)}
                      className="bg-background/50"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-muted-foreground mb-1 block">Opponent Style</label>
                    <Input
                      placeholder="e.g. Southpaw, Aggressive"
                      value={formStyle}
                      onChange={(e) => setFormStyle(e.target.value)}
                      className="bg-background/50"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium text-muted-foreground mb-1 block">Description *</label>
                  <textarea
                    placeholder="Tell the community about your fight. What do you need help with? What do you know about your opponent?"
                    value={formDescription}
                    onChange={(e) => setFormDescription(e.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-input bg-background/50 px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex gap-3 justify-end">
                  <Button type="button" variant="outline" onClick={() => setShowCreateForm(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting} className="bg-primary text-primary-foreground">
                    {submitting ? 'Posting...' : 'Post Fight'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

      <Card className="mb-6 border-border/50 bg-card/50 backdrop-blur-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            {statusFilters.map((s) => (
              <Button
                key={s}
                variant={statusFilter === s ? 'default' : 'outline'}
                size="sm"
                onClick={() => setStatusFilter(s)}
                className="h-8"
              >
                {statusLabels[s]}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {(() => {
        const scoutingStats = [
          { label: 'Total Posts', value: requests.length, accent: 'text-primary' },
          { label: 'Open Requests', value: requests.filter(r => r.status === 'open').length, accent: 'text-green-400' },
          { label: 'Paid Breakdowns', value: paidRequests.length, accent: 'text-yellow-400' },
          { label: 'Free Advice', value: freeRequests.length, accent: 'text-blue-400' },
        ]
        const allZero = scoutingStats.every(s => s.value === 0)
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            {scoutingStats.map((stat, i) => (
              <Card key={i} className="border-border/50 bg-card/40">
                <CardContent className="p-4">
                  <div className={`text-2xl font-bold ${allZero ? 'text-muted-foreground/60' : stat.accent}`}>
                    {allZero ? '—' : stat.value}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{stat.label}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        )
      })()}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="border-border/40 bg-card/30 animate-pulse">
              <CardContent className="p-6 h-40" />
            </Card>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <EmptySectionState
          icon={Target}
          title="No fight posts yet"
          description="Be the first to post about your upcoming fight and get community breakdowns or paid coach analysis."
          action={
            <Button onClick={() => setShowCreateForm(true)} className="h-10">
              <Plus className="h-4 w-4 mr-2" />
              Post a Fight
            </Button>
          }
        />
      ) : (
          <div className="space-y-8">
            {paidRequests.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <DollarSign className="h-5 w-5 text-yellow-400" />
                  Paid Breakdown Requests
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {paidRequests.map((request) => (
                    <div key={request.id} className="relative">
                      <Badge className="absolute top-3 right-3 z-10 bg-yellow-500/20 text-yellow-400 border-yellow-500/30">
                        ${request.budget} Budget
                      </Badge>
                      <ScoutingCard request={request} currentUserId={user?.id} onRefresh={fetchRequests} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {freeRequests.length > 0 && (
              <div>
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <Eye className="h-5 w-5 text-blue-400" />
                  Community Posts — Free Advice
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {freeRequests.map((request) => (
                    <ScoutingCard key={request.id} request={request} currentUserId={user?.id} onRefresh={fetchRequests} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
    </SectionShell>
  )
}
