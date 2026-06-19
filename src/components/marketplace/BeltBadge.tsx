/**
 * BeltBadge — small colored badge that renders the analyst's belt tier.
 * Matches BJJ-style belt progression: white < blue < purple < brown < black < red.
 */
'use client'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

export type BeltTier = 'white' | 'blue' | 'purple' | 'brown' | 'black' | 'red'

const BELT_STYLES: Record<BeltTier, string> = {
  white:  'bg-white text-gray-900 border-gray-300',
  blue:   'bg-blue-600 text-white border-blue-700',
  purple: 'bg-purple-600 text-white border-purple-700',
  brown:  'bg-[#6b4423] text-white border-[#533520]',
  black:  'bg-black text-white border-gray-900',
  red:    'bg-red-600 text-white border-red-800',
}

const BELT_LABEL: Record<BeltTier, string> = {
  white:  'White',
  blue:   'Blue',
  purple: 'Purple',
  brown:  'Brown',
  black:  'Black',
  red:    'Coral',
}

export function BeltBadge({
  tier,
  showLabel = true,
  className,
}: {
  tier: BeltTier
  showLabel?: boolean
  className?: string
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-semibold border-2 uppercase tracking-wide',
        BELT_STYLES[tier],
        className,
      )}
    >
      {showLabel ? `${BELT_LABEL[tier]} Belt` : BELT_LABEL[tier]}
    </Badge>
  )
}
