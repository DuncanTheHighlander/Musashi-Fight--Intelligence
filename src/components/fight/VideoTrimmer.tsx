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
  DEFAULT_UPLOAD_TRIM_SEC,
  defaultUploadTrimWindow,
  forceNormalPlaybackRate,
  probeVideoDuration,
  trimVideoFile,
  type TrimValidation,
} from '@/lib/videoTrim'

export type VideoTrimResult = {
  file: File
  durationSec: number
  selectedStartSec: number
  selectedEndSec: number
}

export type VideoTrimFallback = {
  startSec: number
  endSec: number
}

type Props = {
  file: File
  maxSec: number
  onConfirm: (result: VideoTrimResult) => void
  onFallback: (window: VideoTrimFallback) => void
  onCancel: () => void
}

const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export default function VideoTrimmer({ file, maxSec, onConfirm, onFallback, onCancel }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewStopRef = useRef<number | null>(null)
  const scrubTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Object URL lifecycle tied to `file` via effect (NOT useState initializer):
  // under StrictMode/remounts the state survives while the cleanup revokes the
  // URL, leaving the player pointed at a dead blob (media error 4).
  const [url, setUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [durationResolved, setDurationResolved] = useState(false)
  const [win, setWin] = useState(() => defaultUploadTrimWindow(0, maxSec))
  const [processing, setProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [scrubHint, setScrubHint] = useState<'start' | 'end' | null>(null)

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
      void 0
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
      const next = defaultUploadTrimWindow(d, maxSec)
      setWin(next)
      // Show the first frame of the selection as soon as duration is known.
      requestAnimationFrame(() => seekPreview(next.start))
    })
    return () => { cancelled = true }
  }, [file, maxSec, seekPreview])

  // When metadata loads on the visible player, snap to selection start.
  const onPreviewLoaded = () => {
    const v = videoRef.current
    if (v) forceNormalPlaybackRate(v)
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
    forceNormalPlaybackRate(v)
    v.currentTime = win.start
    void v.play().catch(() => {
      setError('Could not preview this clip in the browser. Try MP4 (H.264) or a different file.')
    })
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
    if (previewStopRef.current) {
      cancelAnimationFrame(previewStopRef.current)
      previewStopRef.current = null
    }
    try {
      // The encode pass plays the selection on THIS visible player and records
      // it via a canvas — phones only decode video that's actually on screen,
      // and won't open a second decoder session on the same source.
      const validationBox: { current: TrimValidation | null } = { current: null }
      const trimmed = await trimVideoFile(file, win.start, win.end, setProgress, {
        hostVideo: videoRef.current,
        onValidated: (validation) => { validationBox.current = validation },
      })
      const outputDurationSec = validationBox.current?.durationSec ?? 0
      if (!(outputDurationSec > 0)) {
        throw new Error('The trimmed clip duration could not be verified.')
      }
      onConfirm({
        file: trimmed,
        durationSec: outputDurationSec,
        selectedStartSec: win.start,
        selectedEndSec: win.end,
      })
    } catch (e) {
      try { seekPreview(win.start) } catch { void 0 }
      setError(e instanceof Error ? e.message : 'Could not trim the clip.')
      setProcessing(false)
    }
  }

  const windowLen = Math.max(0, win.end - win.start)
  const fallbackWindow = duration > 0
    ? { startSec: win.start, endSec: win.end }
    : { startSec: 0, endSec: defaultUploadTrimWindow(0, maxSec).end }

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !processing) onCancel() }}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Trim your clip</DialogTitle>
          <DialogDescription>
            This clip is {duration ? fmt(duration) : '…'} long.{' '}
            {maxSec > DEFAULT_UPLOAD_TRIM_SEC
              ? `We start with a ${DEFAULT_UPLOAD_TRIM_SEC}s review window so phone uploads stay fast. Your plan allows up to ${maxSec}s if you expand it.`
              : `Pick the ${maxSec}s that matter, then we’ll trim it for you.`}
          </DialogDescription>
        </DialogHeader>

        <video
          ref={videoRef}
          src={url ?? undefined}
          className="w-full rounded-lg bg-black aspect-video"
          controls={!processing}
          muted
          playsInline
          preload="auto"
          onLoadedData={onPreviewLoaded}
        />
        <p className="text-xs text-muted-foreground">
          Drag Start/End to choose the window — the preview updates as you drag.
          {scrubHint === 'start' ? ' Showing start frame.' : scrubHint === 'end' ? ' Showing end frame.' : null}
        </p>

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

        {(error || (durationResolved && !duration)) && !processing ? (
          <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 p-3 space-y-2">
            <p className="text-sm text-foreground">
              This phone could not make a verified local clip. You can upload the original and let the server cut the selected window instead.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => onFallback(fallbackWindow)}>
              Use original + server trim
            </Button>
          </div>
        ) : null}

        {processing && (
          <div className="space-y-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              Trimming {Math.round(progress * 100)}% — your selection plays above while it&apos;s
              recorded. Keep this screen open.
            </p>
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
