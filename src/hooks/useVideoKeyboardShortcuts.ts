'use client'

import { useEffect, useCallback } from 'react'

type VideoShortcutsOptions = {
  videoRef: React.RefObject<HTMLVideoElement | null>
  enabled?: boolean
  onPlayPause?: () => void
  seekSeconds?: number
}

/**
 * Power-user keyboard shortcuts for video controls:
 * - Space: Play/Pause
 * - ArrowLeft: Seek backward
 * - ArrowRight: Seek forward
 * - F: Toggle fullscreen (when video is focused)
 */
export function useVideoKeyboardShortcuts({
  videoRef,
  enabled = true,
  onPlayPause,
  seekSeconds = 5,
}: VideoShortcutsOptions) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || !videoRef.current) return

      // Ignore when typing in inputs
      const target = e.target as HTMLElement
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return
      }

      switch (e.code) {
        case 'Space':
          e.preventDefault()
          if (onPlayPause) onPlayPause()
          else if (videoRef.current) {
            if (videoRef.current.paused) videoRef.current.play().catch(() => {})
            else videoRef.current.pause()
          }
          break
        case 'ArrowLeft':
          e.preventDefault()
          videoRef.current.currentTime = Math.max(
            0,
            videoRef.current.currentTime - seekSeconds
          )
          break
        case 'ArrowRight':
          e.preventDefault()
          videoRef.current.currentTime = Math.min(
            videoRef.current.duration,
            videoRef.current.currentTime + seekSeconds
          )
          break
        case 'KeyF':
          if (document.fullscreenElement) {
            document.exitFullscreen()
          } else {
            videoRef.current.parentElement?.requestFullscreen()
          }
          break
      }
    },
    [enabled, videoRef, onPlayPause, seekSeconds]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
