'use client'

/**
 * /marketplace/settings — analyst opt-in + direct-hire configuration.
 */

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import { useAuth } from '@/hooks/useAuth'
import { useToast } from '@/hooks/use-toast'
import { parseApiResponse } from '@/lib/safeJson'
import { formatCents, centsFromDollars, dollarsFromCents } from '@/lib/currency'
import { ArrowLeft, Save } from 'lucide-react'
import { BeltBadge, type BeltTier } from '@/components/marketplace/BeltBadge'

type Profile = {
  userId: string
  isAnalystEnabled: boolean
  bio: string
  specialties: string[]
  languages: string[]
  turnaroundHours: number
  directHireEnabled: boolean
  directHireRateCents: number
  beltTier: BeltTier
  beltScore: number
  avgOverall: number
  jobsCompleted: number
  jobsCancelled: number
  jobsDisputed: number
  reviewCount: number
  totalEarnedCents: number
  currentCapacity: number
  maxCapacity: number
  stripePayoutsEnabled: boolean
}

export default function AnalystSettingsPage() {
  const { user, loading: authLoading } = useAuth()
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [profile, setProfile] = useState<Profile | null>(null)

  // Form state (initialized from profile once loaded)
  const [enabled, setEnabled] = useState(false)
  const [bio, setBio] = useState('')
  const [specialties, setSpecialties] = useState('')
  const [languages, setLanguages] = useState('')
  const [turnaround, setTurnaround] = useState('72')
  const [directHireEnabled, setDirectHireEnabled] = useState(false)
  const [directHireRate, setDirectHireRate] = useState('0')
  const [maxCapacity, setMaxCapacity] = useState('3')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/social/analyst/profile', { credentials: 'include' })
      const data = await parseApiResponse<{ profile: Profile }>(res)
      setProfile(data.profile)
      setEnabled(data.profile.isAnalystEnabled)
      setBio(data.profile.bio || '')
      setSpecialties(data.profile.specialties.join(', '))
      setLanguages(data.profile.languages.join(', '))
      setTurnaround(String(data.profile.turnaroundHours))
      setDirectHireEnabled(data.profile.directHireEnabled)
      setDirectHireRate(String(dollarsFromCents(data.profile.directHireRateCents)))
      setMaxCapacity(String(data.profile.maxCapacity))
    } catch (err) {
      toast({
        title: 'Failed to load profile',
        description: err instanceof Error ? err.message : 'Unknown',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => { if (!authLoading && user) load() }, [authLoading, user, load])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/social/analyst/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          isAnalystEnabled: enabled,
          bio,
          specialties: specialties.split(',').map((s) => s.trim()).filter(Boolean),
          languages: languages.split(',').map((s) => s.trim()).filter(Boolean),
          turnaroundHours: Number(turnaround) || 72,
          directHireEnabled,
          directHireRateCents: centsFromDollars(directHireRate),
          maxCapacity: Number(maxCapacity) || 3,
        }),
      })
      await parseApiResponse(res)
      toast({ title: 'Settings saved' })
      await load()
    } catch (err) {
      toast({
        title: 'Save failed',
        description: err instanceof Error ? err.message : 'Unknown',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (!authLoading && !user) {
    return (
      <div className="container mx-auto max-w-2xl px-4 py-12">
        <Card><CardContent className="py-10 text-center">Please log in.</CardContent></Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto max-w-3xl px-4 py-8 space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/marketplace">
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to marketplace
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Analyst Settings</CardTitle>
          <p className="text-sm text-muted-foreground">
            Opt in to claim bounties and accept direct hires. Your belt tier updates automatically
            as you complete work and collect reviews.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading || !profile ? (
            <Skeleton className="h-72 w-full" />
          ) : (
            <>
              {/* Stats panel */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat label="Belt" value={<BeltBadge tier={profile.beltTier} showLabel={false} />} />
                <Stat label="Jobs" value={String(profile.jobsCompleted)} />
                <Stat label="Rating" value={profile.avgOverall.toFixed(1)} />
                <Stat label="Earned" value={formatCents(profile.totalEarnedCents)} />
              </div>

              <Separator />

              {/* Opt-in toggle */}
              <ToggleRow
                label="Analyst mode"
                description="When on, your profile appears on the analyst leaderboard and you can claim open bounties."
                checked={enabled}
                onChange={setEnabled}
              />

              <div>
                <label className="text-sm font-medium mb-1.5 block">Bio</label>
                <Textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  rows={4}
                  placeholder="Short bio shown on your public profile..."
                />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Specialties</label>
                  <Input
                    value={specialties}
                    onChange={(e) => setSpecialties(e.target.value)}
                    placeholder="boxing, mma, bjj"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Comma-separated tags.</p>
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Languages</label>
                  <Input
                    value={languages}
                    onChange={(e) => setLanguages(e.target.value)}
                    placeholder="en, es"
                  />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Turnaround (hours)</label>
                  <Input
                    type="number"
                    min={1}
                    max={720}
                    value={turnaround}
                    onChange={(e) => setTurnaround(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium mb-1.5 block">Max concurrent jobs</label>
                  <Input
                    type="number"
                    min={1}
                    max={10}
                    value={maxCapacity}
                    onChange={(e) => setMaxCapacity(e.target.value)}
                  />
                </div>
              </div>

              <Separator />

              <ToggleRow
                label="Accept direct hires"
                description={
                  profile.beltTier === 'white'
                    ? 'Requires blue belt or higher — complete more jobs to unlock.'
                    : 'Fighters can book you instantly at your set rate (no bidding).'
                }
                checked={directHireEnabled}
                onChange={setDirectHireEnabled}
                disabled={profile.beltTier === 'white'}
              />

              {directHireEnabled && (
                <div className="max-w-xs">
                  <label className="text-sm font-medium mb-1.5 block">Direct hire rate (USD)</label>
                  <Input
                    type="number"
                    min={5}
                    step="0.01"
                    value={directHireRate}
                    onChange={(e) => setDirectHireRate(e.target.value)}
                  />
                </div>
              )}

              <div className="rounded-md bg-amber-500/10 border border-amber-500/30 p-3 text-xs text-amber-700 dark:text-amber-400">
                <strong>Payouts:</strong> Stripe Connect onboarding isn&apos;t wired yet. Your earnings
                accumulate in the ledger and will be paid out once Connect is live.
              </div>

              <div className="flex justify-end">
                <Button onClick={save} disabled={saving}>
                  <Save className="h-4 w-4 mr-1" />
                  {saving ? 'Saving...' : 'Save changes'}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-muted/40 p-3 text-center">
      <div className="text-base font-semibold flex items-center justify-center">{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  )
}

function ToggleRow({
  label, description, checked, onChange, disabled,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          disabled
            ? 'bg-muted cursor-not-allowed opacity-50'
            : checked
            ? 'bg-primary'
            : 'bg-muted'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  )
}
