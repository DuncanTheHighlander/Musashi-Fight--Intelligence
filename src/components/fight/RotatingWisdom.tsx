'use client'

/**
 * Rotating quote/tip line for the "Preparing your clip" boot overlay. See
 * docs/LOADING_SCREEN_SPEC.md. Purely presentational — never blocks or reads
 * the tracking progress it sits beneath.
 */
import { useEffect, useMemo, useState } from 'react'
import { pickWisdom } from '@/lib/wisdom'
import { cn } from '@/lib/utils'

const ROTATE_MS = 6000

export default function RotatingWisdom({ sport }: { sport?: string | null }) {
  const playlist = useMemo(() => pickWisdom(sport, Date.now()), [sport])
  const [index, setIndex] = useState(0)
  const [reducedMotion, setReducedMotion] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReducedMotion(mq.matches)
    const onChange = () => setReducedMotion(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (playlist.length <= 1) return
    const id = setInterval(() => setIndex((i) => (i + 1) % playlist.length), ROTATE_MS)
    return () => clearInterval(id)
  }, [playlist.length])

  const line = playlist[index] ?? playlist[0]
  if (!line) return null

  return (
    <p
      key={index}
      aria-live="polite"
      className={cn(
        'max-w-sm text-xs text-white/55',
        !reducedMotion && 'animate-in fade-in duration-700',
      )}
    >
      &ldquo;{line.text}&rdquo;
      {(line.author || line.source) && (
        <span className="mt-1 block text-white/35">
          — {[line.author, line.source].filter(Boolean).join(', ')}
        </span>
      )}
    </p>
  )
}
