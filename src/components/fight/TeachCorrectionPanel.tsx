'use client'

import React, { useCallback, useState } from 'react'

export type TeachTimeMode = 'evidence' | 'manual' | 'whole_clip' | 'none'

export type TeachContext = {
  surface: 'coach_card' | 'chat'
  responseRef?: string | null
  cardSection?: string | null
  originalText: string
  evidenceStartMs?: number | null
  evidenceEndMs?: number | null
  sport: string
  focusTarget?: string | null
  clipId?: string | null
  ledgerId?: string | null
  clipDurationMs?: number | null
}

type PreviewState = {
  draftId: string
  summary: string
  startMs: number | null
  endMs: number | null
  wholeClip: boolean
}

function startOneShotDictate(onText: (t: string) => void, onError?: (msg: string) => void) {
  type SpeechRec = {
    lang: string
    interimResults: boolean
    continuous: boolean
    onresult: ((ev: {
      results: ArrayLike<{ 0?: { transcript?: string }; isFinal?: boolean }>
    }) => void) | null
    onerror: ((ev: { error?: string }) => void) | null
    onend: (() => void) | null
    start: () => void
    stop: () => void
  }
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRec
    webkitSpeechRecognition?: new () => SpeechRec
  }
  const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition
  if (!Ctor) {
    onError?.('Voice input not supported in this browser')
    return
  }
  const rec = new Ctor()
  rec.lang = navigator.language || 'en-US'
  rec.interimResults = false
  rec.continuous = false
  rec.onresult = (ev) => {
    const t = ev.results?.[0]?.[0]?.transcript
    if (t) onText(t)
  }
  rec.onerror = (ev) => onError?.(ev.error || 'Voice failed')
  try {
    rec.start()
  } catch {
    onError?.('Voice failed to start')
  }
}

const ERROR_CHIPS = [
  { id: 'wrong_technique', label: 'Wrong technique' },
  { id: 'wrong_fighter', label: 'Wrong fighter' },
  { id: 'wrong_timestamp', label: 'Wrong timestamp' },
  { id: 'missed_action', label: 'Missed action' },
  { id: 'too_vague', label: 'Too vague' },
  { id: 'other', label: 'Other' },
] as const

/** All-users thumbs-down reason chips → coaching_feedback only. */
export function ThumbsDownReasonPanel({
  onSubmit,
  onCancel,
  busy,
}: {
  onSubmit: (args: { categories: string[]; text: string }) => void
  onCancel: () => void
  busy?: boolean
}) {
  const [selected, setSelected] = useState<string[]>([])
  const [text, setText] = useState('')

  const toggle = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-red-500/30 bg-zinc-950/80 p-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">What was wrong?</div>
      <div className="flex flex-wrap gap-1.5">
        {ERROR_CHIPS.map((c) => (
          <button
            key={c.id}
            type="button"
            disabled={busy}
            onClick={() => toggle(c.id)}
            className={`rounded-full border px-2 py-0.5 text-[11px] ${
              selected.includes(c.id)
                ? 'border-red-400/60 bg-red-500/20 text-red-100'
                : 'border-zinc-600/50 text-zinc-300 hover:border-red-400/40'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Optional note…"
        rows={2}
        className="w-full resize-none rounded-lg border border-zinc-700/50 bg-zinc-900/80 px-2 py-1.5 text-xs text-zinc-100"
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="text-[11px] text-zinc-400 hover:text-zinc-200">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onSubmit({ categories: selected, text })}
          className="rounded-lg border border-red-400/50 bg-red-500/15 px-2.5 py-1 text-[11px] font-semibold text-red-100"
        >
          Submit
        </button>
      </div>
    </div>
  )
}

/** Shogun-only Teach panel: structure → preview → approve. */
export function TeachCorrectionPanel({
  ctx,
  onClose,
  onApproved,
}: {
  ctx: TeachContext
  onClose: () => void
  onApproved?: () => void
}) {
  const [text, setText] = useState('')
  const [timeMode, setTimeMode] = useState<TeachTimeMode>(
    ctx.evidenceStartMs != null || ctx.evidenceEndMs != null ? 'evidence' : 'none',
  )
  const [manualStart, setManualStart] = useState(
    ctx.evidenceStartMs != null ? String((ctx.evidenceStartMs / 1000).toFixed(1)) : '0',
  )
  const [manualEnd, setManualEnd] = useState(
    ctx.evidenceEndMs != null ? String((ctx.evidenceEndMs / 1000).toFixed(1)) : '2',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clarify, setClarify] = useState<string | null>(null)
  const [clarifyAnswer, setClarifyAnswer] = useState('')
  const [preview, setPreview] = useState<PreviewState | null>(null)

  const resolveWindow = useCallback(() => {
    if (timeMode === 'whole_clip') return { wholeClip: true, noTimestamp: false, startMs: null, endMs: null }
    if (timeMode === 'none') return { wholeClip: false, noTimestamp: true, startMs: null, endMs: null }
    if (timeMode === 'evidence') {
      return {
        wholeClip: false,
        noTimestamp: false,
        startMs: ctx.evidenceStartMs ?? null,
        endMs: ctx.evidenceEndMs ?? ctx.evidenceStartMs ?? null,
      }
    }
    const s = Math.max(0, Math.round(Number(manualStart) * 1000))
    const e = Math.max(s, Math.round(Number(manualEnd) * 1000))
    return {
      wholeClip: false,
      noTimestamp: false,
      startMs: Number.isFinite(s) ? s : null,
      endMs: Number.isFinite(e) ? e : null,
    }
  }, [timeMode, manualStart, manualEnd, ctx.evidenceStartMs, ctx.evidenceEndMs])

  const structure = async (withClarify?: string) => {
    if (!text.trim() && !withClarify) return
    setBusy(true)
    setError(null)
    try {
      const win = resolveWindow()
      const res = await fetch('/api/fight/teach-correction/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: ctx.surface,
          responseRef: ctx.responseRef,
          cardSection: ctx.cardSection,
          sport: ctx.sport,
          focusTarget: ctx.focusTarget,
          clipId: ctx.clipId,
          ledgerId: ctx.ledgerId,
          originalText: ctx.originalText,
          correctionText: text.trim() || ctx.originalText.slice(0, 80),
          clipDurationMs: ctx.clipDurationMs,
          clarificationAnswer: withClarify || clarifyAnswer || null,
          ...win,
        }),
      })
      const data = (await res.json().catch(() => null)) as {
        success?: boolean
        error?: string
        needsClarification?: boolean
        clarificationQuestion?: string
        draftId?: string
        preview?: { summary?: string; startMs?: number | null; endMs?: number | null; wholeClip?: boolean }
      } | null
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Structure failed')
      if (data.needsClarification) {
        setClarify(data.clarificationQuestion || 'Can you clarify?')
        return
      }
      setClarify(null)
      if (data.draftId && data.preview) {
        setPreview({
          draftId: data.draftId,
          summary: data.preview.summary || 'Ready to approve',
          startMs: data.preview.startMs ?? null,
          endMs: data.preview.endMs ?? null,
          wholeClip: Boolean(data.preview.wholeClip),
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const decide = async (reject: boolean) => {
    if (!preview) return
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/fight/teach-correction/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: preview.draftId, reject }),
      })
      const data = (await res.json().catch(() => null)) as { success?: boolean; error?: string } | null
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Save failed')
      if (!reject) onApproved?.()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-xl border border-cyan-500/35 bg-zinc-950/90 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-bold uppercase tracking-wide text-cyan-200">Teach Musashi</div>
        <button type="button" onClick={onClose} className="text-[11px] text-zinc-500 hover:text-zinc-300">
          Close
        </button>
      </div>

      {!ctx.ledgerId && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100">
          Analysis wasn&apos;t saved — correction will attach to clip only.
        </div>
      )}

      {!preview ? (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="What should Musashi have said? (e.g. wrist ride, not front headlock)"
            rows={3}
            className="w-full resize-none rounded-lg border border-zinc-700/50 bg-zinc-900/80 px-2 py-1.5 text-xs text-zinc-100"
          />
          <button
            type="button"
            onClick={() =>
              startOneShotDictate(
                (t) => setText((prev) => (prev ? `${prev.trim()} ${t}` : t)),
                (msg) => setError(msg),
              )
            }
            className="text-[11px] text-cyan-300/90 hover:text-cyan-200"
          >
            Dictate
          </button>

          <div className="space-y-1">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Time window</div>
            <div className="flex flex-wrap gap-1">
              {(
                [
                  ['evidence', 'Card window'],
                  ['manual', 'Manual range'],
                  ['whole_clip', 'Whole clip'],
                  ['none', 'No timestamp'],
                ] as const
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTimeMode(mode)}
                  disabled={mode === 'evidence' && ctx.evidenceStartMs == null && ctx.evidenceEndMs == null}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    timeMode === mode
                      ? 'border-cyan-400/60 bg-cyan-500/20 text-cyan-100'
                      : 'border-zinc-600/50 text-zinc-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {timeMode === 'manual' && (
              <div className="flex items-center gap-2 text-[11px] text-zinc-300">
                <label className="flex items-center gap-1">
                  Start (s)
                  <input
                    value={manualStart}
                    onChange={(e) => setManualStart(e.target.value)}
                    className="w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5"
                  />
                </label>
                <label className="flex items-center gap-1">
                  End (s)
                  <input
                    value={manualEnd}
                    onChange={(e) => setManualEnd(e.target.value)}
                    className="w-16 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5"
                  />
                </label>
              </div>
            )}
          </div>

          {clarify && (
            <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
              <div className="text-[11px] text-amber-100">{clarify}</div>
              <input
                value={clarifyAnswer}
                onChange={(e) => setClarifyAnswer(e.target.value)}
                className="w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
                placeholder="Your clarification"
              />
              <button
                type="button"
                disabled={busy || !clarifyAnswer.trim()}
                onClick={() => void structure(clarifyAnswer.trim())}
                className="text-[11px] font-semibold text-cyan-200"
              >
                Continue
              </button>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              disabled={busy || !text.trim()}
              onClick={() => void structure()}
              className="rounded-lg border border-cyan-400/50 bg-cyan-500/15 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 disabled:opacity-40"
            >
              {busy ? 'Structuring…' : 'Preview'}
            </button>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <div className="rounded-lg border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-2 text-xs text-cyan-50">
            {preview.summary}
          </div>
          <div className="text-[10px] text-zinc-500">Nothing is active until you Approve.</div>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setPreview(null)}
              className="text-[11px] text-zinc-400 hover:text-zinc-200"
            >
              Edit
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(true)}
              className="rounded-lg border border-zinc-600/50 px-2.5 py-1 text-[11px] text-zinc-300"
            >
              Reject
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(false)}
              className="rounded-lg border border-emerald-400/50 bg-emerald-500/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-100"
            >
              Approve
            </button>
          </div>
        </div>
      )}

      {error && <div className="text-[11px] text-amber-400">{error}</div>}
    </div>
  )
}
