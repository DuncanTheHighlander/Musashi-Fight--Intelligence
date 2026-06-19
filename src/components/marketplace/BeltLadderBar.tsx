'use client'

/**
 * BeltLadderBar — the full Musashi Coach Rank progression (lowest → highest)
 * shown as a key above the leaderboard. Leads with the public Coach Title;
 * the belt colour is shown as the rank detail beneath.
 */

import { CoachBeltBadge } from '@/components/marketplace/CoachBeltBadge'
import {
  BELT_SUMMARY,
  coachTitle,
  COACH_RANK_SYSTEM_NAME,
  COACH_RANK_BLURB,
} from '@/lib/marketplace/coachRank'

export function BeltLadderBar() {
  return (
    <div className="mb-6 rounded-lg border border-border/50 bg-card/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {COACH_RANK_SYSTEM_NAME}
        </span>
        <span className="text-[11px] text-muted-foreground">Lowest → Highest</span>
      </div>

      <div className="flex items-end gap-1 overflow-x-auto pb-1">
        {BELT_SUMMARY.map((rank) => (
          <div
            key={rank.beltKey}
            className="flex min-w-[74px] flex-1 flex-col items-center gap-1 text-center"
          >
            <CoachBeltBadge rank={rank} size={38} showLabel={false} />
            <span className="text-[11px] font-medium leading-tight">{coachTitle(rank)}</span>
            <span className="text-[10px] leading-tight text-muted-foreground">
              {rank.beltLabel} Rank
            </span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">{COACH_RANK_BLURB}</p>
    </div>
  )
}
