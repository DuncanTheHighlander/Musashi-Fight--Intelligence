'use client'

/**
 * /coaches — public belt-ranking leaderboard for the unified coach population.
 * Ranked by review quality + student preparation (pre/post-competition feeling
 * weighted above actual results). See lib/marketplace/coachRank.ts.
 */

import { CoachLeaderboard } from '@/components/marketplace/CoachLeaderboard'
import { SectionHeader } from '@/components/ui/section-header'
import { Trophy } from 'lucide-react'

export default function CoachesPage() {
  return (
    <div className="container mx-auto max-w-4xl px-4 py-8 lg:px-6 lg:py-10">
      <SectionHeader
        icon={Trophy}
        eyebrow="Musashi Coach Rank"
        title="Coach Rankings"
        subtitle="Find trusted coaches faster. Ranked by review quality and how prepared their students feel going into competition — preparation is weighted above raw win/loss results."
      />
      <CoachLeaderboard />
    </div>
  )
}
