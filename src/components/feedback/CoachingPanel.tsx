'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import type { CoachingPayload } from '@/lib/validators/llm-output.validator'

/**
 * Quota / guard state surfaced from the AI routes (see `src/lib/ai/aiGuard.ts`).
 * When set, this takes visual precedence over the normal coaching display.
 */
export type CoachingQuotaState =
  | { kind: 'auth' }
  | { kind: 'rate_limited'; retryAfterSec?: number }
  | { kind: 'quota_exhausted' }
  | { kind: 'kill_switch'; hint?: string }

export type CoachingPanelProps = Readonly<{
  payload: CoachingPayload | null
  llmIssues?: Array<{ code: string; message: string }>
  overlayCount?: number
  /** When present, replaces the coaching display with a polished status card. */
  quotaState?: CoachingQuotaState | null
  /** Enables the thumbs up/down rating row. Requires a saved analysis id. */
  ratingContext?: {
    ledgerId: string
    aiModel?: string | null
    discipline?: string | null
  } | null
}>

const ACTOR_COLORS: Record<string, { bg: string; border: string; text: string; icon: string }> = {
  A: { bg: 'bg-blue-500/15', border: 'border-blue-400/40', text: 'text-blue-200', icon: 'bg-blue-500' },
  B: { bg: 'bg-red-500/15', border: 'border-red-400/40', text: 'text-red-200', icon: 'bg-red-500' },
}

function QuotaStateCard({ state }: { state: CoachingQuotaState }) {
  const map = {
    auth: {
      title: 'Sign in to use live coaching',
      body: 'Tactical analysis is a paid feature. Sign in to unlock the AI coach for your uploaded clips.',
      cta: { href: '/login', label: 'Sign in' },
      accent: 'cyan',
    },
    rate_limited: {
      title: 'Slow down a moment',
      body:
        state.kind === 'rate_limited' && state.retryAfterSec
          ? `Too many AI requests in the last minute. Coaching resumes in ${state.retryAfterSec}s.`
          : 'Too many AI requests in the last minute. Coaching will resume automatically.',
      cta: null as null | { href: string; label: string },
      accent: 'amber',
    },
    quota_exhausted: {
      title: 'Daily AI quota reached',
      body:
        'You used your free coaching credits for today. Upgrade for higher daily limits, or come back tomorrow — your local skeleton tracking and tactics overlays still work.',
      cta: { href: '/pricing', label: 'See plans' } as { href: string; label: string },
      accent: 'cyan',
    },
    kill_switch: {
      title: 'Live coaching temporarily paused',
      body:
        state.kind === 'kill_switch' && state.hint
          ? state.hint
          : 'An admin has paused live AI calls. The CV pipeline and overlays still work — coaching will return shortly.',
      cta: null as null | { href: string; label: string },
      accent: 'amber',
    },
  } as const

  const cfg = map[state.kind]
  const accentBorder = cfg.accent === 'cyan' ? 'border-cyan-500/30' : 'border-amber-500/30'
  const accentGrad = cfg.accent === 'cyan' ? 'from-cyan-950/60 via-slate-900/80 to-slate-950/60' : 'from-amber-950/40 via-slate-900/80 to-slate-950/60'
  const accentDot = cfg.accent === 'cyan' ? 'bg-cyan-500/10' : 'bg-amber-500/10'
  const accentText = cfg.accent === 'cyan' ? 'text-cyan-100' : 'text-amber-100'
  const accentBadge = cfg.accent === 'cyan' ? 'bg-cyan-400/20 text-cyan-300' : 'bg-amber-400/20 text-amber-200'

  return (
    <div className="space-y-4">
      <div className={`relative overflow-hidden rounded-2xl border ${accentBorder} bg-gradient-to-br ${accentGrad} p-5 backdrop-blur-xl`}>
        <div className={`absolute -right-8 -top-8 h-32 w-32 rounded-full ${accentDot} blur-3xl`} />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-black shadow-[0_0_12px_rgba(34,211,238,0.2)] ${accentBadge}`}>
              AI
            </div>
            <div className={`text-sm font-bold tracking-wide ${accentText}`}>{cfg.title.toUpperCase()}</div>
          </div>
          <div className="mt-3 text-[15px] font-medium leading-relaxed text-white/90">
            {cfg.body}
          </div>
          {cfg.cta && (
            <div className="mt-4">
              <Link
                href={cfg.cta.href}
                className={`inline-flex items-center rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition hover:bg-white/5 ${
                  cfg.accent === 'cyan'
                    ? 'border-cyan-400/40 text-cyan-100'
                    : 'border-amber-400/40 text-amber-100'
                }`}
              >
                {cfg.cta.label} &rarr;
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FighterBadge({ actorId }: { actorId?: string }) {
  if (!actorId) return null
  const c = ACTOR_COLORS[actorId] || { bg: 'bg-zinc-700/30', border: 'border-zinc-500/40', text: 'text-zinc-300', icon: 'bg-zinc-500' }
  return (
    <span className={`mr-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-bold tracking-wide ${c.bg} ${c.border} ${c.text}`}>
      <span className={`inline-block h-2 w-2 rounded-full ${c.icon} shadow-[0_0_6px_rgba(255,255,255,0.3)]`} />
      {actorId === 'A' ? 'BLUE' : 'RED'}
    </span>
  )
}

function SeverityDot({ score }: { score: number }) {
  const color = score >= 0.8 ? 'bg-red-400' : score >= 0.6 ? 'bg-amber-400' : 'bg-emerald-400'
  return <span className={`inline-block h-2 w-2 rounded-full ${color} shadow-[0_0_6px_rgba(255,255,255,0.2)]`} />
}

/** Thumbs up/down on the whole analysis. Ratings land in coaching_feedback for admin review. */
function RatingRow({ context }: { context: NonNullable<CoachingPanelProps['ratingContext']> }) {
  const [rated, setRated] = useState<1 | -1 | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (rating: 1 | -1) => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      const res = await fetch('/api/fight/coaching-feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ledgerId: context.ledgerId,
          rating,
          aiModel: context.aiModel ?? null,
          discipline: context.discipline ?? null,
        }),
      })
      const data = (await res.json().catch(() => null)) as { success?: boolean } | null
      if (!res.ok || !data?.success) throw new Error('rating failed')
      setRated(rating)
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-zinc-700/40 bg-zinc-900/50 px-4 py-2.5">
      <span className="text-xs font-medium text-zinc-400">
        {rated ? 'Thanks — your rating helps the coach improve.' : 'Was this coaching useful?'}
      </span>
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit(1)}
          aria-label="Coaching was useful"
          className={`rounded-lg border px-2.5 py-1 text-sm transition ${
            rated === 1
              ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-200'
              : 'border-zinc-600/50 text-zinc-300 hover:border-emerald-400/40 hover:text-emerald-200'
          } ${busy ? 'opacity-50' : ''}`}
        >
          &#128077;
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void submit(-1)}
          aria-label="Coaching was not useful"
          className={`rounded-lg border px-2.5 py-1 text-sm transition ${
            rated === -1
              ? 'border-red-400/60 bg-red-500/20 text-red-200'
              : 'border-zinc-600/50 text-zinc-300 hover:border-red-400/40 hover:text-red-200'
          } ${busy ? 'opacity-50' : ''}`}
        >
          &#128078;
        </button>
      </div>
      {failed && <span className="text-[11px] text-amber-400">Couldn&apos;t save — try again</span>}
    </div>
  )
}

export function CoachingPanel({ payload, llmIssues, overlayCount, quotaState, ratingContext }: CoachingPanelProps) {
  const [expandedCue, setExpandedCue] = useState<string | null>(null)

  if (quotaState) {
    return <QuotaStateCard state={quotaState} />
  }

  if (!payload) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-zinc-700/50 bg-gradient-to-br from-zinc-900/80 to-zinc-800/40 p-5 backdrop-blur-xl">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-500/30 to-cyan-700/20 text-lg">
              <span role="img" aria-label="coach">&#x1F3AF;</span>
            </div>
            <div>
              <div className="text-sm font-bold text-white">Tactical Coaching</div>
              <div className="mt-0.5 text-xs text-zinc-400">
                Play the video — Musashi will deliver tactical analysis with on-screen callouts
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Main Diagnosis — Hero Card */}
      <div className="relative overflow-hidden rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-cyan-950/60 via-slate-900/80 to-slate-950/60 p-5 backdrop-blur-xl">
        <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-cyan-500/10 blur-3xl" />
        <div className="relative">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-400/20 text-xs font-black text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.3)]">
              AI
            </div>
            <div className="text-sm font-bold tracking-wide text-cyan-100">FIGHT DIAGNOSIS</div>
            {overlayCount != null && overlayCount > 0 && (
              <span className="ml-auto rounded-full bg-cyan-500/20 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300">
                {overlayCount} on-screen callouts
              </span>
            )}
          </div>
          <div className="mt-3 text-[15px] font-medium leading-relaxed text-white/95">
            {payload.mainDiagnosis}
          </div>
        </div>
      </div>

      {/* Style Notes */}
      {Array.isArray((payload as any).styleNotes) && (payload as any).styleNotes.length > 0 && (
        <div className="rounded-2xl border border-purple-500/25 bg-gradient-to-br from-purple-950/40 to-slate-900/40 p-4 backdrop-blur-xl">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-300">
            <span className="inline-block h-1 w-6 rounded-full bg-gradient-to-r from-purple-400 to-purple-600" />
            Fighting Style
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {((payload as any).styleNotes as string[]).map((note, idx) => (
              <span key={idx} className="inline-flex items-center rounded-full border border-purple-500/20 bg-purple-500/10 px-3 py-1 text-xs font-medium text-purple-100/90">
                {note}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Quick Cues — Tactical Cards */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Tactical Cues</span>
          <span className="rounded-full bg-zinc-700/50 px-2 py-0.5 text-[10px] font-bold text-zinc-300">{payload.quickCues.length}</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {payload.quickCues.slice(0, 8).map((cue) => {
            const isExpanded = expandedCue === cue.id
            return (
              <button
                key={cue.id}
                type="button"
                onClick={() => setExpandedCue(isExpanded ? null : cue.id)}
                className="group rounded-2xl border border-zinc-700/50 bg-gradient-to-br from-zinc-900/80 to-zinc-800/30 p-4 text-left transition-all duration-200 hover:border-cyan-500/30 hover:shadow-[0_0_20px_rgba(34,211,238,0.08)]"
              >
                <div className="flex items-start gap-2">
                  <SeverityDot score={cue.confidence.score} />
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5">
                      <FighterBadge actorId={cue.actorId} />
                    </div>
                    <div className="mt-1.5 text-sm font-bold leading-snug text-white">{cue.quickCue}</div>
                  </div>
                </div>

                {cue.keyMistake && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg bg-amber-500/8 p-2">
                    <span className="mt-0.5 text-xs text-amber-400">&#x26A0;</span>
                    <span className="text-xs font-medium text-amber-200/90">{cue.keyMistake}</span>
                  </div>
                )}

                {cue.whyItMatters && (
                  <div className="mt-2 text-xs leading-relaxed text-zinc-400">
                    <span className="font-semibold text-zinc-300">Why it matters: </span>{cue.whyItMatters}
                  </div>
                )}

                {cue.whatToDoInstead && (
                  <div className="mt-2 flex items-start gap-2 rounded-lg bg-emerald-500/8 p-2">
                    <span className="mt-0.5 text-xs text-emerald-400">&#x2714;</span>
                    <span className="text-xs font-medium text-emerald-200/90">{cue.whatToDoInstead}</span>
                  </div>
                )}

                {isExpanded && cue.expanded && (
                  <div className="mt-3 rounded-xl border border-zinc-700/30 bg-zinc-800/40 p-3 text-xs leading-relaxed text-zinc-300">
                    {cue.expanded}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
                  <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 font-bold text-cyan-300">
                    {(cue.confidence.score * 100).toFixed(0)}% confidence
                  </span>
                  {cue.t && (
                    <span className="rounded-full bg-zinc-700/50 px-2 py-0.5 font-medium text-zinc-400">
                      {(cue.t.startMs / 1000).toFixed(1)}s – {(cue.t.endMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  {!isExpanded && cue.expanded && (
                    <span className="rounded-full bg-zinc-700/40 px-2 py-0.5 text-zinc-500 group-hover:text-cyan-400 transition-colors">
                      click to expand
                    </span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Corrections */}
      {payload.suggestedCorrections?.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">Corrections</span>
          </div>
          <div className="space-y-3">
            {payload.suggestedCorrections.slice(0, 6).map((c, idx) => (
              <div key={idx} className="rounded-2xl border border-zinc-700/50 bg-gradient-to-r from-zinc-900/80 to-zinc-800/30 p-4">
                <div className="flex items-start gap-2">
                  <FighterBadge actorId={c.actorId} />
                  <span className="text-sm font-bold text-white">{c.title}</span>
                </div>
                <div className="mt-3 space-y-2">
                  <div className="flex items-start gap-2 rounded-lg bg-amber-500/8 p-2.5">
                    <span className="mt-0.5 text-xs text-amber-400">&#x26A0;</span>
                    <span className="text-xs font-medium text-amber-200/90">{c.why}</span>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg bg-emerald-500/8 p-2.5">
                    <span className="mt-0.5 text-xs text-emerald-400">&#x2714;</span>
                    <span className="text-xs font-medium text-emerald-200/90">{c.doInstead}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Rate this coaching — feeds the coaching_feedback learning loop */}
      {ratingContext?.ledgerId && (
        // Re-mount (and reset the rating state) when a new analysis arrives.
        <RatingRow key={ratingContext.ledgerId} context={ratingContext} />
      )}

      {/* Validator Warnings (collapsed by default) */}
      {llmIssues && llmIssues.length > 0 && (
        <details className="group rounded-2xl border border-yellow-500/20 bg-yellow-500/5 p-3">
          <summary className="cursor-pointer text-xs font-semibold text-yellow-300/80">
            {llmIssues.length} validator warnings (click to expand)
          </summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-zinc-400">
            {llmIssues.slice(0, 6).map((i, idx) => (
              <li key={idx}>
                <span className="font-medium text-zinc-300">{i.code}</span>: {i.message}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
