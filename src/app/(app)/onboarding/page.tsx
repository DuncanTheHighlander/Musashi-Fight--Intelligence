'use client'

/**
 * /onboarding - the post-signup front door. New users pick a path (train, coach,
 * or both) and set up the matching profile. Reuses POST /api/social/profiles
 * (fighter) and PATCH /api/social/analyst/profile (coach). Coaches enter Musashi
 * Coach Rank at White automatically once their analyst profile is enabled.
 */

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/hooks/use-toast'
import { useAuth } from '@/hooks/useAuth'
import { parseApiResponse } from '@/lib/safeJson'
import { Dumbbell, Swords, Sparkles, Check, ArrowRight, Loader2 } from 'lucide-react'

type Path = 'train' | 'coach' | 'both'
type Step = 'path' | 'fighter' | 'coach' | 'done'

const DISCIPLINES: Array<[value: string, label: string]> = [
  ['boxing', 'Boxing'],
  ['kickboxing', 'Kickboxing'],
  ['muay_thai', 'Muay Thai'],
  ['mma', 'MMA'],
  ['bjj', 'BJJ'],
  ['wrestling', 'Wrestling'],
  ['karate', 'Karate'],
  ['taekwondo', 'Taekwondo'],
  ['other', 'Other'],
]

const WEIGHT_CLASSES = [
  'Strawweight', 'Flyweight', 'Bantamweight', 'Featherweight', 'Lightweight',
  'Welterweight', 'Middleweight', 'Light Heavyweight', 'Heavyweight', 'Other',
]

const selectClass =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function OnboardingPage() {
  const router = useRouter()
  const { user } = useAuth()
  const { toast } = useToast()

  const [checkingStatus, setCheckingStatus] = useState(true)

  useEffect(() => {
    if (!user) {
      setCheckingStatus(false)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/auth/onboarding-status', { credentials: 'include' })
        if (!res.ok) return
        const data = (await res.json()) as { complete?: boolean; redirectTo?: string }
        if (!cancelled && data.complete) {
          router.replace(data.redirectTo || '/')
        }
      } catch {
        /* stay on onboarding */
      } finally {
        if (!cancelled) setCheckingStatus(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [user, router])

  const [step, setStep] = useState<Step>('path')
  const [path, setPath] = useState<Path>('train')
  const [saving, setSaving] = useState(false)

  // Shared / fighter fields
  const [displayName, setDisplayName] = useState(user?.display_name || '')
  const [discipline, setDiscipline] = useState('boxing')
  const [weightClass, setWeightClass] = useState('Lightweight')
  const [stance, setStance] = useState('orthodox')
  const [bio, setBio] = useState('')

  // Coach fields
  const [specialties, setSpecialties] = useState<string[]>([])
  const [turnaroundHours, setTurnaroundHours] = useState(72)
  const [rateUsd, setRateUsd] = useState('')

  const choosePath = (p: Path) => {
    setPath(p)
    setStep(p === 'coach' ? 'coach' : 'fighter')
  }

  const toggleSpecialty = (v: string) =>
    setSpecialties((cur) => (cur.includes(v) ? cur.filter((s) => s !== v) : [...cur, v]))

  async function saveFighter() {
    if (!displayName.trim()) {
      toast({ title: 'Add a display name', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/social/profiles', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: displayName.trim(), discipline, weightClass, stance, bio }),
      })
      // "Profile already exists" is fine - treat as done for this path.
      if (!res.ok) {
        const data: { error?: string } = await parseApiResponse<{ error?: string }>(res).catch(() => ({}))
        const message = data.error || 'Could not save your profile'
        if (!message.toLowerCase().includes('already')) {
          throw new Error(message)
        }
      }
      setStep(path === 'both' ? 'coach' : 'done')
    } catch (err) {
      toast({ title: 'Setup failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  async function saveCoach() {
    if (!displayName.trim()) {
      toast({ title: 'Add a display name', variant: 'destructive' })
      return
    }
    setSaving(true)
    try {
      const rateCents = Math.max(0, Math.round(Number(rateUsd) * 100)) || 0
      const res = await fetch('/api/social/analyst/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          isAnalystEnabled: true,
          bio,
          specialties: specialties.length ? specialties : [discipline],
          turnaroundHours,
          directHireRateCents: rateCents,
        }),
      })
      const data = await parseApiResponse<{ error?: string }>(res)
      if (!res.ok) {
        throw new Error(data.error || 'Could not save your coach profile')
      }
      setStep('done')
    } catch (err) {
      toast({ title: 'Setup failed', description: err instanceof Error ? err.message : 'Unknown error', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="container mx-auto max-w-2xl px-4 py-10 lg:py-14">
      {checkingStatus ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin" />
          <p className="text-sm">Checking your profile…</p>
        </div>
      ) : (
      <>
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Welcome to Musashi</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A couple of quick details and you&apos;re in.
        </p>
      </div>

      {step === 'path' && (
        <div className="grid gap-4 sm:grid-cols-3">
          <PathCard
            icon={Dumbbell}
            title="I'm here to train"
            desc="Upload clips, get AI breakdowns, and hire coaches."
            onClick={() => choosePath('train')}
          />
          <PathCard
            icon={Swords}
            title="I coach fighters"
            desc="Take jobs, sell breakdowns, and earn your Coach Rank."
            onClick={() => choosePath('coach')}
          />
          <PathCard
            icon={Sparkles}
            title="Both"
            desc="Train and coach on the same account."
            onClick={() => choosePath('both')}
          />
        </div>
      )}

      {step === 'fighter' && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <StepLabel>{path === 'both' ? 'Step 1 of 2 - Your fighter profile' : 'Your fighter profile'}</StepLabel>
            <Field label="Display name">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Fighter name" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Discipline">
                <select className={selectClass} value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
                  {DISCIPLINES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </Field>
              <Field label="Weight class">
                <select className={selectClass} value={weightClass} onChange={(e) => setWeightClass(e.target.value)}>
                  {WEIGHT_CLASSES.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Stance">
              <select className={selectClass} value={stance} onChange={(e) => setStance(e.target.value)}>
                <option value="orthodox">Orthodox</option>
                <option value="southpaw">Southpaw</option>
                <option value="switch">Switch</option>
              </select>
            </Field>
            <Field label="Bio (optional)">
              <Input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="A line about your game" />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setStep('path')} disabled={saving}>Back</Button>
              <Button onClick={saveFighter} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Continue <ArrowRight className="ml-1.5 h-4 w-4" /></>}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'coach' && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <StepLabel>{path === 'both' ? 'Step 2 of 2 - Your coach profile' : 'Your coach profile'}</StepLabel>
            <Field label="Display name">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Coach name" />
            </Field>
            <Field label="Specialties">
              <div className="flex flex-wrap gap-2">
                {DISCIPLINES.map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => toggleSpecialty(v)}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      specialties.includes(v)
                        ? 'border-primary bg-primary/15 text-primary'
                        : 'border-border text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Turnaround (hours)">
                <Input type="number" min={1} value={turnaroundHours} onChange={(e) => setTurnaroundHours(Number(e.target.value))} />
              </Field>
              <Field label="Direct-hire rate (USD, optional)">
                <Input type="number" min={0} value={rateUsd} onChange={(e) => setRateUsd(e.target.value)} placeholder="e.g. 65" />
              </Field>
            </div>
            <Field label="Bio (optional)">
              <Input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="How you help fighters" />
            </Field>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setStep(path === 'both' ? 'fighter' : 'path')} disabled={saving}>Back</Button>
              <Button onClick={saveCoach} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <>Finish <Check className="ml-1.5 h-4 w-4" /></>}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 'done' && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15">
              <Check className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">You&apos;re all set</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {path === 'train'
                  ? 'Head to the Fight Lab to upload your first clip.'
                  : 'Your coach profile is live. New coaches start at Foundation Coach (White Rank).'}
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => router.push('/')}>Go to Fight Lab</Button>
              <Button variant="outline" onClick={() => router.push('/marketplace')}>Open Marketplace</Button>
              {path !== 'train' && (
                <Button variant="outline" onClick={() => router.push('/coaches')}>View Coach Rankings</Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      </>
      )}
    </div>
  )
}

function PathCard({
  icon: Icon, title, desc, onClick,
}: { icon: typeof Dumbbell; title: string; desc: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="text-left">
      <Card className="h-full transition-all hover:border-primary/60 hover:shadow-md">
        <CardContent className="flex h-full flex-col gap-2 p-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground">{desc}</div>
        </CardContent>
      </Card>
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function StepLabel({ children }: { children: React.ReactNode }) {
  return <Badge variant="secondary" className="mb-1">{children}</Badge>
}
