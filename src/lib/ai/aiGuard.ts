import { NextResponse } from 'next/server'
import { enforceUsage, type MusashiAction } from '@/lib/musashiUsage'
import type { MusashiUser } from '@/lib/musashiAuth'
import { assertEmailVerified, requireUser } from '@/lib/musashiAuth'

/**
 * Shared "wallet gate" for every AI-spending route.
 *
 * Why this file exists:
 *   `src/lib/musashiUsage.ts` already implements per-user quotas (per-minute
 *   + per-day, free vs paid tiers, per-user overrides). It is wired into
 *   `/api/fight` but NOT into `/api/coach`, `/api/fight/analyze`,
 *   `/api/fight/analyze-burst`, or `/api/fight/analyze-strategy` — which are
 *   exactly the endpoints that spend the most Gemini tokens. This module
 *   plugs that gap with a single call-site.
 *
 * Responsibilities:
 *   1. Honor the global env kill switch `MUSASHI_AI_KILL_SWITCH=1`. Flipping
 *      this in production halts every AI call without a code redeploy.
 *   2. Call `enforceUsage(req, action)` when D1 is bound.
 *   3. Gracefully degrade to an in-memory per-IP burst limiter when D1 is
 *      not bound (local dev) — same pattern as `src/middleware.ts`.
 *   4. Translate the thrown sentinel errors into structured NextResponse
 *      objects with the right HTTP status. Route handlers stay tiny.
 */

export type AiGuardOk = { ok: true; user: MusashiUser | null }
export type AiGuardErr = { ok: false; response: NextResponse }
export type AiGuardResult = AiGuardOk | AiGuardErr

const KILL_SWITCH = (): boolean => process.env.MUSASHI_AI_KILL_SWITCH === '1'

const hasDbBinding = (): boolean => {
  const db = process.env.DB as unknown as { prepare?: unknown } | undefined
  return typeof db?.prepare === 'function'
}

const isAuthDisabled = (): boolean =>
  process.env.MUSASHI_DISABLE_AUTH === '1' && process.env.NODE_ENV !== 'production'

// In-memory burst limiter — only used when D1 is unavailable. Per-IP,
// per-action, 60-second rolling window. Intentionally tiny: this is a
// safety net for local dev, NOT a substitute for the D1-backed quota.
const FALLBACK_WINDOW_MS = 60_000
const FALLBACK_LIMIT_PER_ACTION: Record<MusashiAction, number> = {
  analyze: 12,
  chat: 30,
  reflex: 30,
  track: 30,
}
type FallbackEntry = { count: number; resetAt: number }
const fallbackMap = new Map<string, FallbackEntry>()
let fallbackLastSweep = 0

const sweepFallbackMap = (now: number) => {
  if (now - fallbackLastSweep < FALLBACK_WINDOW_MS) return
  fallbackLastSweep = now
  for (const [k, v] of fallbackMap) {
    if (now > v.resetAt) fallbackMap.delete(k)
  }
}

const ipFromRequest = (req: Request): string => {
  const fwd = req.headers.get('x-forwarded-for') || ''
  const first = fwd.split(',')[0]?.trim()
  return first || req.headers.get('x-real-ip') || 'unknown'
}

const fallbackBurstCheck = (req: Request, action: MusashiAction): boolean => {
  const now = Date.now()
  sweepFallbackMap(now)
  const key = `${ipFromRequest(req)}::${action}`
  const limit = FALLBACK_LIMIT_PER_ACTION[action]
  const entry = fallbackMap.get(key)
  if (!entry || now > entry.resetAt) {
    fallbackMap.set(key, { count: 1, resetAt: now + FALLBACK_WINDOW_MS })
    return true
  }
  entry.count++
  return entry.count <= limit
}

const errorResponse = (
  body: Record<string, unknown>,
  status: number,
  headers?: Record<string, string>
): NextResponse => {
  return NextResponse.json(body, { status, headers })
}

/**
 * Run the full guard. Returns either `{ ok: true, user }` or
 * `{ ok: false, response }` — callers should `return result.response` if not
 * ok. The user object is `null` when running in `MUSASHI_DISABLE_AUTH=1`
 * mode and no D1 is available (pure local dev).
 */
export const aiGuard = async (
  req: Request,
  action: MusashiAction
): Promise<AiGuardResult> => {
  // 1. Global kill switch beats everything else.
  if (KILL_SWITCH()) {
    return {
      ok: false,
      response: errorResponse(
        {
          error: 'AI temporarily disabled',
          code: 'AI_KILL_SWITCH',
          hint: 'A site admin has paused all AI calls. Try again later.',
        },
        503,
        { 'Retry-After': '300' }
      ),
    }
  }

  // 2. Prefer the real D1-backed enforceUsage path when available. This is
  //    the production path. enforceUsage already short-circuits to a
  //    'shogun' dev user when MUSASHI_DISABLE_AUTH=1.
  if (hasDbBinding()) {
    try {
      const user = await enforceUsage(req, action)
      return { ok: true, user: user as MusashiUser }
    } catch (err) {
      return { ok: false, response: aiErrorResponse(err) }
    }
  }

  // 3. No D1: still enforce auth (unless explicitly disabled), but use the
  //    in-memory burst limiter for cost protection. This is local-dev only;
  //    production always has DB bound on Cloudflare.
  let user: MusashiUser | null = null
  if (!isAuthDisabled()) {
    try {
      user = (await requireUser(req)) as MusashiUser
    } catch (err) {
      return { ok: false, response: aiErrorResponse(err) }
    }
  }

  if (!fallbackBurstCheck(req, action)) {
    return {
      ok: false,
      response: errorResponse(
        {
          error: 'Too many requests in the last minute. Slow down.',
          code: 'RATE_LIMIT',
          action,
        },
        429,
        { 'Retry-After': '60' }
      ),
    }
  }

  return { ok: true, user }
}

/**
 * Translate the sentinel errors thrown by enforceUsage / requireUser into a
 * structured NextResponse. Exported so existing handlers can use it from
 * their own try/catch blocks if they prefer.
 */
export const aiErrorResponse = (err: unknown): NextResponse => {
  const message = err instanceof Error ? err.message : String(err)

  if (message === 'RATE_LIMIT') {
    return errorResponse(
      { error: 'Rate limit exceeded (per minute). Wait a moment.', code: 'RATE_LIMIT' },
      429,
      { 'Retry-After': '30' }
    )
  }

  if (message === 'DAILY_QUOTA') {
    return errorResponse(
      {
        error: 'Daily AI quota exhausted.',
        code: 'DAILY_QUOTA',
        hint: 'Upgrade your plan or wait until tomorrow.',
      },
      402
    )
  }

  if (message === 'VIDEO_DURATION_EXCEEDED') {
    return errorResponse(
      {
        error: 'Clip exceeds your plan max length.',
        code: 'VIDEO_DURATION_EXCEEDED',
        hint: 'Free: 10s max. Pro: 30s max. Trim your clip or upgrade.',
      },
      402
    )
  }

  if (message === 'FREE_VIDEO_QUOTA') {
    return errorResponse(
      {
        error: 'Free video analysis limit reached.',
        code: 'FREE_VIDEO_QUOTA',
        hint: 'Free includes 2 AI videos (10s max). Upgrade to Pro for weekly 30s clips. Marketplace stays available.',
      },
      402
    )
  }

  if (message === 'WEEKLY_VIDEO_QUOTA') {
    return errorResponse(
      {
        error: 'Weekly Pro video limit reached.',
        code: 'WEEKLY_VIDEO_QUOTA',
        hint: 'Pro includes 10 AI videos per week (30s max). Resets Monday UTC.',
      },
      402
    )
  }

  if (message === 'CLIP_QUESTION_LIMIT') {
    return errorResponse(
      {
        error: 'Question limit reached for this clip.',
        code: 'CLIP_QUESTION_LIMIT',
        hint: 'Free: 3 questions per clip. Pro: 15 per clip. Upgrade or analyze a new clip for more.',
      },
      402
    )
  }

  if (message === 'VIDEO_CONTEXT_REQUIRED') {
    return errorResponse(
      {
        error: 'Missing clip duration or clip id for video analysis.',
        code: 'VIDEO_CONTEXT_REQUIRED',
      },
      400
    )
  }

  // requireUser throws plain "Unauthorized" or "Invalid session" strings.
  if (/unauthorized|invalid session|no session/i.test(message)) {
    return errorResponse({ error: 'Unauthorized', code: 'UNAUTHORIZED' }, 401)
  }

  return errorResponse({ error: message || 'AI guard failed', code: 'AI_GUARD' }, 500)
}
