/**
 * CoachBeltBadge — emoji-style SVG of a tied martial-arts belt, colored and
 * decorated to match a coach's rank from coachRank.ts (stripes for the kyu
 * belts, degree pips on the rank bar for black, split coloring for coral/red).
 */
'use client'

import { cn } from '@/lib/utils'
import type { BeltColorKey, CoachRank } from '@/lib/marketplace/coachRank'

type Palette = { body: string; knot: string; stroke: string; bar: string; pip: string }

const PALETTES: Record<BeltColorKey, Palette> = {
  white: { body: '#f1f5f9', knot: '#e2e8f0', stroke: '#cbd5e1', bar: '#e2e8f0', pip: '#475569' },
  gray: { body: '#6b7280', knot: '#4b5563', stroke: '#374151', bar: '#4b5563', pip: '#f9fafb' },
  yellow: { body: '#facc15', knot: '#eab308', stroke: '#ca8a04', bar: '#eab308', pip: '#3f2d00' },
  blue: { body: '#2563eb', knot: '#1d4ed8', stroke: '#1e40af', bar: '#1d4ed8', pip: '#ffffff' },
  purple: { body: '#7c3aed', knot: '#6d28d9', stroke: '#5b21b6', bar: '#6d28d9', pip: '#ffffff' },
  brown: { body: '#6b4423', knot: '#533520', stroke: '#3d2716', bar: '#533520', pip: '#ffffff' },
  black: { body: '#1f2937', knot: '#111827', stroke: '#000000', bar: '#dc2626', pip: '#ffffff' },
  coral: { body: '#111827', knot: '#dc2626', stroke: '#000000', bar: '#dc2626', pip: '#ffffff' },
  red: { body: '#dc2626', knot: '#b91c1c', stroke: '#7f1d1d', bar: '#ffffff', pip: '#dc2626' },
}

type BeltInfo = Pick<CoachRank, 'beltKey' | 'beltLabel' | 'stripes' | 'degree' | 'label'>

/** Pips drawn on the rank bar: stripes for kyu belts, degree for dan belts. */
function pipCount(info: BeltInfo): number {
  if (info.stripes > 0) return Math.min(info.stripes, 4)
  if (info.beltKey === 'black') return Math.min(info.degree, 8)
  return 0 // coral/red carry their meaning in the color itself
}

function BeltSvg({ info, size }: { info: BeltInfo; size: number }) {
  const p = PALETTES[info.beltKey]
  const pips = pipCount(info)
  // Rank bar spans the right band tip; pips are evenly spaced inside it.
  const barX = 41
  const barW = 18
  const marks = Array.from({ length: pips }, (_, i) => barX + 2.5 + i * ((barW - 4) / Math.max(pips, 1)))

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 56"
      role="img"
      aria-label={info.label}
      style={{ display: 'block' }}
    >
      {/* hanging tails */}
      <rect x="25" y="32" width="6.5" height="20" rx="3" fill={p.knot} stroke={p.stroke} strokeWidth="1" />
      <rect x="32.5" y="32" width="6.5" height="20" rx="3" fill={p.body} stroke={p.stroke} strokeWidth="1" />
      {/* left + right bands */}
      <rect x="2" y="20" width="24" height="13" rx="4" fill={p.body} stroke={p.stroke} strokeWidth="1.5" />
      <rect x="38" y="20" width="24" height="13" rx="4" fill={p.body} stroke={p.stroke} strokeWidth="1.5" />
      {/* rank bar on the right tip */}
      <rect x={barX} y="20.5" width={barW} height="12" rx="2" fill={p.bar} stroke={p.stroke} strokeWidth="0.75" />
      {marks.map((mx, i) => (
        <rect key={i} x={mx} y="22.5" width="1.8" height="8" rx="0.9" fill={p.pip} />
      ))}
      {/* central knot, drawn last so it sits on top */}
      <rect x="22" y="15" width="20" height="21" rx="5" fill={p.knot} stroke={p.stroke} strokeWidth="1.5" />
      <rect x="26" y="19" width="12" height="13" rx="3" fill={p.body} opacity="0.45" />
    </svg>
  )
}

export function CoachBeltBadge({
  rank,
  size = 40,
  showLabel = true,
  className,
}: {
  rank: BeltInfo
  size?: number
  showLabel?: boolean
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BeltSvg info={rank} size={size} />
      {showLabel && (
        <span className="font-semibold leading-tight">
          {rank.label}
        </span>
      )}
    </span>
  )
}
