'use client'

/**
 * Lightweight analysis-window picker. Stores start/end timestamps only —
 * never calls canvas/MediaRecorder re-encode (recordSegmentFromHost / trimVideoFile).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Play } from 'lucide-react'
import {
  clampTrimWindow,
  defaultTrimWindow,
  probeVideoDuration,
} from '@/lib/videoTrim'

export type ClipTimeWindow = { startSec: number; endSec: number }

type Props = {
  file: File
  maxSec: number
  onConfirm: (window: ClipTimeWindow) => void
  onCancel: () => void
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function ClipTimeWindowSlider({ file, maxSec, onConfirm, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewStopRef = useRef<number | null>(null)
  const scrubTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [durationResolved, setDurationResolved] = useState(false)
  const [win, setWin] = useState({ start: 0, end: maxSec })
  const [scrubHint, setScrubHint] = useState<'start' | 'end' | null>(null)
  const [previewNote, setPreviewNote] = useState<string | null>(null)

  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => {
      URL.revokeObjectURL(u)
      if (scrubTimerRef.current) clearTimeout(scrubTimerRef.current)
      if (previewStopRef.current) cancelAnimationFrame(previewStopRef.current)
    }
  }, [file])

  const seekPreview = useCallback((timeSec: number) => {
    const v = videoRef.current
    if (!v) return
    if (previewStopRef.current) {
      cancelAnimationFrame(previewStopRef.current)
      previewStopRef.current = null
    }
    try {
      v.pause()
    } catch {
      void 0
    }
    const t = Math.max(0, Math.min(timeSec, Number.isFinite(v.duration) ? v.duration : timeSec))
    try {
      v.currentTime = t
    } catch {
      // Seek can fail on some phones — selection remains usable without preview.
      setPreviewNote('Preview seek unavailable on this device — your selection is still saved.')
    }
  }, [])

  const scheduleScrub = useCallback((timeSec: number, which: 'start' | 'end') => {
    setScrubHint(which)
    if (scrubTimerRef.current) clearTimeout(scrubTimerRef.current)
    scrubTimerRef.current = setTimeout(() => {
      seekPreview(timeSec)
    }, 60)
  }, [seekPreview])

  useEffect(() => {
    let cancelled = false
    void probeVideoDuration(file).then((d) => {
      if (cancelled) return
      setDuration(d)
      setDurationResolved(true)
      const next = defaultTrimWindow(d, maxSec)
      setWin(next)
      requestAnimationFrame(() => seekPreview(next.start))
    })
    return () => { cancelled = true }
  }, [file, maxSec, seekPreview])

  const onPreviewLoaded = () => {
    if (duration > 0) seekPreview(win.start)
  }

  const setHandle = (which: 'start' | 'end', value: number) => {
    setWin((prev) => {
      const next = which === 'start' ? { start: value, end: prev.end } : { start: prev.start, end: value }
      const clamped = clampTrimWindow(next.start, next.end, duration, maxSec, which)
      scheduleScrub(which === 'start' ? clamped.start : clamped.end, which)
      return clamped
    })
  }

  const previewSelection = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (previewStopRef.current) cancelAnimationFrame(previewStopRef.current)
    try {
      v.currentTime = win.start
    } catch {
      setPreviewNote('Preview seek unavailable on this device — your selection is still saved.')
      return
    }
    void v.play().catch(() => {
      setPreviewNote('Could not preview on this device — your selection is still saved.')
    })
    const tick = () => {
      if (v.currentTime >= win.end) { v.pause(); return }
      previewStopRef.current = requestAnimationFrame(tick)
    }
    previewStopRef.current = requestAnimationFrame(tick)
  }, [win.start, win.end])

  const handleConfirm = () => {
    if (previewStopRef.current) {
      cancelAnimationFrame(previewStopRef.current)
      previewStopRef.current = null
    }
    onConfirm({ startSec: win.start, endSec: win.end })
  }

  const windowLen = Math.max(0, win.end - win.start)

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel() }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Select analysis window</DialogTitle>
          <DialogDescription>
            This clip is {duration ? fmt(duration) : '…'} long. Analysis uses up to {maxSec}s —
            pick the {maxSec}s that matter. The original file is uploaded; no re-encoding.
          </DialogDescription>
        </DialogHeader>

        <video
          ref={videoRef}
          src={url ?? undefined}
          className="w-full rounded-lg bg-black aspect-video"
          muted
          playsInline
          preload="metadata"
          onLoadedData={onPreviewLoaded}
        />
        <p className="text-xs text-muted-foreground">
          Drag Start/End to choose the window.
          {scrubHint === 'start' ? ' Showing start frame.' : scrubHint === 'end' ? ' Showing end frame.' : null}
        </p>
        {previewNote && <p className="text-xs text-muted-foreground">{previewNote}</p>}
        {durationResolved && !duration ? (
          <p className="text-xs text-muted-foreground">
            This phone cannot preview this file, but the server can still make a safe first-{maxSec}s clip for analysis.
          </p>
        ) : null}

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Selection: {fmt(win.start)} → {fmt(win.end)}</span>
            <span className={windowLen > maxSec ? 'text-destructive' : 'text-muted-foreground'}>
              {windowLen.toFixed(1)}s / {maxSec}s
            </span>
          </div>

          <label className="block text-xs text-muted-foreground">
            Start
            <input
              type="range"
              min={0}
              max={Math.max(0, duration)}
              step={0.1}
              value={win.start}
              disabled={!duration}
              onChange={(e) => setHandle('start', Number(e.target.value))}
              className="mt-1 w-full accent-primary"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            End
            <input
              type="range"
              min={0}
              max={Math.max(0, duration)}
              step={0.1}
              value={win.end}
              disabled={!duration}
              onChange={(e) => setHandle('end', Number(e.target.value))}
              className="mt-1 w-full accent-primary"
            />
          </label>

          <Button type="button" variant="outline" size="sm" onClick={previewSelection} disabled={!duration}>
            <Play className="mr-2 h-4 w-4" /> Preview selection
          </Button>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={!duration || windowLen < 1}>
            Use this window
          </Button>
          {durationResolved && !duration ? (
            <Button type="button" onClick={() => onConfirm({ startSec: 0, endSec: maxSec })}>
              Use first {maxSec}s
            </Button>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
