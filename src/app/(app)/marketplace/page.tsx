'use client'

/**
 * /marketplace — top-level landing page for the fighter↔analyst gig marketplace.
 * Three tabs: Open Bounties, Analysts, My Jobs.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { parseApiResponse } from '@/lib/safeJson'
import { Briefcase, Plus, Settings2, Shield } from 'lucide-react'
import { JobCard, type JobCardData } from '@/components/marketplace/JobCard'
import { AnalystCard, type AnalystCardData } from '@/components/marketplace/AnalystCard'
import { SectionHeader, EmptySectionState } from '@/components/ui/section-header'

export default function MarketplacePage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { toast } = useToast()

  const [activeTab, setActiveTab] = useState<'bounties' | 'analysts' | 'mine'>('bounties')
  const [bounties, setBounties] = useState<JobCardData[]>([])
  const [myJobs, setMyJobs] = useState<JobCardData[]>([])
  const [analysts, setAnalysts] = useState<AnalystCardData[]>([])
  const [loading, setLoading] = useState(false)
  const [bountiesError, setBountiesError] = useState(false)
  const [analystsError, setAnalystsError] = useState(false)
  const [myJobsError, setMyJobsError] = useState(false)

  const fetchBounties = useCallback(async () => {
    setBountiesError(false)
    try {
      const res = await fetch('/api/social/jobs?status=FUNDED&jobType=open_bounty&limit=50', {
        credentials: 'include',
      })
      const data = await parseApiResponse<{ jobs: JobCardData[] }>(res)
      setBounties(data.jobs || [])
    } catch (err) {
      setBountiesError(true)
      toast({
        title: 'Failed to load bounties',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }, [toast])

  const fetchMyJobs = useCallback(async () => {
    setMyJobsError(false)
    try {
      const res = await fetch('/api/social/jobs?mine=1&limit=50', { credentials: 'include' })
      const data = await parseApiResponse<{ jobs: JobCardData[] }>(res)
      setMyJobs(data.jobs || [])
    } catch (err) {
      setMyJobsError(true)
      toast({
        title: 'Failed to load your jobs',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }, [toast])

  const fetchAnalysts = useCallback(async () => {
    setAnalystsError(false)
    try {
      const res = await fetch('/api/social/analysts?sort=belt&limit=50', {
        credentials: 'include',
      })
      const data = await parseApiResponse<{ analysts: AnalystCardData[] }>(res)
      setAnalysts(data.analysts || [])
    } catch (err) {
      setAnalystsError(true)
      toast({
        title: 'Failed to load analysts',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }, [toast])

  useEffect(() => {
    if (authLoading) return
    setLoading(true)
    Promise.all([fetchBounties(), fetchAnalysts(), user ? fetchMyJobs() : Promise.resolve()])
      .finally(() => setLoading(false))
  }, [authLoading, user, fetchBounties, fetchAnalysts, fetchMyJobs])

  return (
    <div className="container mx-auto max-w-6xl px-4 py-8 lg:px-6 lg:py-10">
      <SectionHeader
        icon={Briefcase}
        eyebrow="Bounties & Analysts"
        title="Hire a Coach"
        subtitle="Post a fight for analysis, or browse expert coaches ranked by belt tier."
        action={
          <>
            <Button asChild variant="outline" className="h-10">
              <Link href="/marketplace/settings">
                <Settings2 className="h-4 w-4 mr-2" />
                Analyst Settings
              </Link>
            </Button>
            {user?.role === 'shogun' && (
              <Button asChild variant="outline" className="h-10">
                <Link href="/admin/disputes">
                  <Shield className="h-4 w-4 mr-2" />
                  Disputes
                </Link>
              </Button>
            )}
            <Button
              className="h-10"
              onClick={() => {
                if (!user) {
                  router.push('/login')
                  return
                }
                router.push('/marketplace/jobs/new')
              }}
            >
              <Plus className="h-4 w-4 mr-2" />
              Post a Bounty
            </Button>
          </>
        }
      />

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="bounties">Open Bounties</TabsTrigger>
          <TabsTrigger value="analysts">Analysts</TabsTrigger>
          <TabsTrigger value="mine" disabled={!user}>My Jobs</TabsTrigger>
        </TabsList>

        <TabsContent value="bounties" className="mt-6">
          {loading ? (
            <SkeletonGrid />
          ) : bountiesError ? (
            <EmptySectionState
              icon={Briefcase}
              title="Could not load bounties"
              description="Check your connection and try again."
              action={
                <Button variant="outline" onClick={() => { setLoading(true); fetchBounties().finally(() => setLoading(false)) }}>
                  Retry
                </Button>
              }
            />
          ) : bounties.length === 0 ? (
            <EmptySectionState
              icon={Briefcase}
              title="No open bounties right now"
              description="Be the first to post — set a budget and any verified analyst can claim it."
              action={
                user && (
                  <Button onClick={() => router.push('/marketplace/jobs/new')}>
                    <Plus className="h-4 w-4 mr-2" />
                    Post the first bounty
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {bounties.map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="analysts" className="mt-6">
          {loading ? (
            <SkeletonGrid />
          ) : analystsError ? (
            <EmptySectionState
              icon={Shield}
              title="Could not load analysts"
              description="Check your connection and try again."
              action={
                <Button variant="outline" onClick={() => { setLoading(true); fetchAnalysts().finally(() => setLoading(false)) }}>
                  Retry
                </Button>
              }
            />
          ) : analysts.length === 0 ? (
            <EmptySectionState
              icon={Shield}
              title="No active analysts yet"
              description="Enable analyst mode in settings to appear here as an available coach."
              action={
                user && (
                  <Button asChild variant="outline">
                    <Link href="/marketplace/settings">Become an Analyst</Link>
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {analysts.map((a) => (
                <AnalystCard key={a.userId} analyst={a} />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="mine" className="mt-6">
          {!user ? (
            <EmptySectionState icon={Briefcase} title="Log in to see your jobs" description="Sign in or create an account to post bounties and track work." />
          ) : loading ? (
            <SkeletonGrid />
          ) : myJobsError ? (
            <EmptySectionState
              icon={Briefcase}
              title="Could not load your jobs"
              description="Check your connection and try again."
              action={
                <Button variant="outline" onClick={() => { setLoading(true); fetchMyJobs().finally(() => setLoading(false)) }}>
                  Retry
                </Button>
              }
            />
          ) : myJobs.length === 0 ? (
            <EmptySectionState
              icon={Briefcase}
              title="You have no jobs yet"
              description="Post a bounty, or claim one from the Open Bounties tab to get started."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {myJobs.map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <Skeleton key={i} className="h-44 rounded-lg" />
      ))}
    </div>
  )
}
