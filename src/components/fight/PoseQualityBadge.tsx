'use client'

import { cn } from '@/lib/utils'
import type { PoseEngineInfo } from '@/lib/pose/poseQuality'
import { AlertTriangle, Zap, XCircle } from 'lucide-react'

type PoseQualityBadgeProps = {
  info: PoseEngineInfo
  blocked?: boolean
  overrideActive?: boolean
  onOverride?: () => void
}

type BadgeVariant = 'rtmpose' | 'fallback' | 'weak'

function resolveVariant(info: PoseEngineInfo): BadgeVariant {
  if (info.quality?.recommendation === 'request_better_clip') return 'weak'
  if (info.fallback || info.engine.includes('mediapipe')) return 'fallback'
  return 'rtmpose'
}

function badgeCopy(info: PoseEngineInfo, variant: BadgeVariant): string {
  const quality = info.quality?.overall?.toUpperCase() ?? 'UNKNOWN'
  if (variant === 'weak') return 'Tracking weak — re-shoot recommended'
  if (variant === 'fallback') return 'MediaPipe fallback · analyze with caution'
  return `RTMPose cloud · quality ${quality}`
}

export function PoseQualityBadge({
  info,
  blocked = false,
  overrideActive = false,
  onOverride,
}: PoseQualityBadgeProps) {
  const variant = resolveVariant(info)
  const label = badgeCopy(info, variant)

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-wide shadow-md backdrop-blur-sm',
          variant === 'rtmpose' && 'border-emerald-400/40 bg-emerald-500/20 text-emerald-100',
          variant === 'fallback' && 'border-amber-400/40 bg-amber-500/20 text-amber-100',
          variant === 'weak' && 'border-red-400/40 bg-red-500/20 text-red-100',
        )}
        aria-live="polite"
      >
        {variant === 'rtmpose' ? (
          <Zap className="h-3 w-3 shrink-0" aria-hidden />
        ) : variant === 'fallback' ? (
          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
        ) : (
          <XCircle className="h-3 w-3 shrink-0" aria-hidden />
        )}
        <span>{label}</span>
      </div>
      {blocked && !overrideActive && onOverride && (
        <button
          type="button"
          onClick={onOverride}
          className="rounded-md border border-white/20 bg-black/60 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm hover:bg-black/75"
        >
          Analyze anyway
        </button>
      )}
      {blocked && overrideActive && (
        <span className="rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-100">
          Quality override active
        </span>
      )}
    </div>
  )
}
