'use client'

import { resolveAssetHref } from '@/lib/storage/assetRef'

type Props = {
  src: string
  title?: string
  className?: string
}

export function isLikelyVideoRef(value: string): boolean {
  const v = String(value || '').trim()
  if (v.startsWith('asset:')) return true
  return /\.(mp4|mov|webm|m4v)(\?|$)/i.test(v)
}

export function CoachFeedbackVideo({ src, title, className }: Props) {
  const href = resolveAssetHref(src)
  return (
    <div className={className}>
      {title && <p className="text-sm font-medium mb-2">{title}</p>}
      <div className="rounded-lg overflow-hidden bg-black/90 border border-border/60">
        <video
          src={href}
          controls
          playsInline
          preload="metadata"
          className="w-full max-h-[min(70vh,520px)] object-contain"
        />
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-primary hover:underline mt-2 inline-block"
      >
        Open video in new tab
      </a>
    </div>
  )
}
