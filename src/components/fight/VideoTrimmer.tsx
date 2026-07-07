'use client'

/**
 * Shown when an uploaded clip is longer than the user's tier limit. Lets the
 * user pick which window (<= maxSec) to keep, then re-encodes just that segment
 * client-side and hands the trimmed File back.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Loader2, Scissors, Play } from 'lucide-react'
import {
  clampTrimWindow,
  defaultTrimWindow,
  probeVideoDuration,
  trimVideoFile,
} from '@/lib/videoTrim'

type Props = {
  file: File
  maxSec: number
  onConfirm: (trimmed: File) => void
  onCancel: () => void
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function VideoTrimmer({ file, maxSec, onConfirm, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewStopRef = useRef<number | null>(null)
  const [url] = useState(() => URL.createObjectURL(file))
  const [duration, setDuration] = useState(0)
  const [win, setWin] = useState({ start: 0, end: maxSec })
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => () => URL.revokeObjectURL(url), [url])

  useEffect(() => {
    let cancelled = false
    void probeVideoDuration(file).then((d) => {
      if (cancelled) return
      setDuration(d)
      setWin(defaultTrimWindow(d, maxSec))
    })
    return () => { cancelled = true }
  }, [file, maxSec])

  const setHandle = (which: 'start' | 'end', value: number) => {
    setWin((prev) => {
      const next = which === 'start' ? { start: value, end: prev.end } : { start: prev.start, end: value }
      return clampTrimWindow(next.start, next.end, duration, maxSec, which)
    })
  }

  const previewSelection = useCallback(() => {
    const v = videoRef.current
    if (!v) return
    if (previewStopRef.current) cancelAnimationFrame(previewStopRef.current)
    v.currentTime = win.start
    void v.play()
    const tick = () => {
      if (v.currentTime >= win.end) { v.pause(); return }
      previewStopRef.current = requestAnimationFrame(tick)
    }
    previewStopRef.current = requestAnimationFrame(tick)
  }, [win.start, win.end])

  const handleTrim = async () => {
    setProcessing(true)
    setError(null)
    setProgress(0)
    try {
      const trimmed = await trimVideoFile(file, win.start, win.end, setProgress)
      onConfirm(trimmed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not trim the clip.')
      setProcessing(false)
    }
  }

  const windowLen = Math.max(0, win.end - win.start)

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !processing) onCancel() }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trim your clip</DialogTitle>
          <DialogDescription>
            This clip is {duration ? fmt(duration) : '…'} long. Analysis uses up to {maxSec}s —
            pick the {maxSec}s that matter, then we&apos;ll trim it for you.
          </DialogDescription>
        </DialogHeader>

        <video
          ref={videoRef}
          src={url}
          className="w-full rounded-lg bg-black aspect-video"
          controls={!processing}
          muted
          playsInline
        />

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
              disabled={processing || !duration}
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
              disabled={processing || !duration}
              onChange={(e) => setHandle('end', Number(e.target.value))}
              className="mt-1 w-full accent-primary"
            />
          </label>

          <Button type="button" variant="outline" size="sm" onClick={previewSelection} disabled={processing || !duration}>
            <Play className="mr-2 h-4 w-4" /> Preview selection
          </Button>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {processing && (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">Trimming… {Math.round(progress * 100)}% (runs in real time)</p>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={processing}>
            Cancel
          </Button>
          <Button type="button" onClick={handleTrim} disabled={processing || !duration || windowLen < 1}>
            {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Scissors className="mr-2 h-4 w-4" />}
            Trim &amp; analyze
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
