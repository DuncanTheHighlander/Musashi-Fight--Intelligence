'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Trophy, Award, Crown } from 'lucide-react'
import { SectionHeader, SectionShell } from '@/components/ui/section-header'
import { CoachLeaderboard } from '@/components/marketplace/CoachLeaderboard'
import { ComingSoonSection } from './ComingSoonSection'

const PREVIEW_ENABLED = process.env.NEXT_PUBLIC_MUSASHI_PREVIEW_FEATURES === '1'

// What a coach's belt is earned on (see lib/marketplace/coachRank.ts).
const SCORE_FACTORS = [
  { label: 'Review Quality', detail: 'Coach + job reviews', accent: 'bg-primary/10 border-primary/20 text-primary' },
  { label: 'Engagement', detail: 'Jobs · sales · reviews', accent: 'bg-blue-500/10 border-blue-500/20 text-blue-400' },
  { label: 'Prep Feeling', detail: 'Pre/post-competition — weighted high', accent: 'bg-green-500/10 border-green-500/20 text-green-400' },
  { label: 'Results', detail: 'Win rate — weighted lower', accent: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400' },
]

export default function CoachesSection() {
  if (!PREVIEW_ENABLED) {
    return (
      <ComingSoonSection
        title="Coaches"
        icon={Crown}
        description="Browse top-ranked coaches and analysts in the Musashi network."
        details="Coming soon. Coach onboarding is in progress."
      />
    )
  }

  return (
    <SectionShell maxWidth="5xl">
      <SectionHeader
        icon={Trophy}
        iconAccent="gold"
        eyebrow="Musashi Coach Rank"
        title="Coach Rankings"
        subtitle="A BJJ-style rank ladder. Ranked by review quality and how prepared students feel going into competition — the feeling of preparation is weighted above raw win/loss results."
      />

      <Card className="mb-6 border-border/50 bg-card/40">
        <CardContent className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            <Award className="h-3.5 w-3.5" />
            How Ranks Are Earned
          </h3>
          <div className="grid grid-cols-2 gap-2.5 text-xs md:grid-cols-4">
            {SCORE_FACTORS.map((f) => (
              <div key={f.label} className={`rounded-lg border p-2.5 text-center ${f.accent}`}>
                <div className="text-sm font-bold">{f.label}</div>
                <div className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">{f.detail}</div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
            Ranks run White → Gray → Yellow → Blue → Purple → Brown (with stripes), then Black 1st–8th
            degree, Coral 9th, and Red 10th. Senior ranks require sustained volume — they&apos;re earned, not bought.
          </p>
        </CardContent>
      </Card>

      <CoachLeaderboard />
    </SectionShell>
  )
}
