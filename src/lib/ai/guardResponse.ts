/**
 * Map HTTP guard responses from aiGuard / enforceVideoAnalysis into UI state.
 */

export type CoachingQuotaState =
  | { kind: 'auth' }
  | { kind: 'rate_limited'; retryAfterSec?: number }
  | { kind: 'quota_exhausted'; hint?: string }
  | { kind: 'free_video_exhausted'; hint?: string }
  | { kind: 'weekly_video_exhausted'; hint?: string }
  | { kind: 'video_duration_exceeded'; hint?: string; maxSec?: number }
  | { kind: 'kill_switch'; hint?: string }

type GuardBody = { code?: string; hint?: string; error?: string } | null

const GUARD_STATUSES = new Set([401, 402, 429, 503])

export const isGuardHttpStatus = (status: number): boolean => GUARD_STATUSES.has(status)

export const parseGuardResponse = async (
  res: Response,
): Promise<CoachingQuotaState | null> => {
  if (!isGuardHttpStatus(res.status)) return null

  const guardBody = (await res.json().catch(() => null)) as GuardBody
  const retryAfter = Number(res.headers.get('Retry-After') || '') || undefined

  if (res.status === 401) return { kind: 'auth' }

  if (res.status === 429) return { kind: 'rate_limited', retryAfterSec: retryAfter }

  if (res.status === 503 && guardBody?.code === 'AI_KILL_SWITCH') {
    return { kind: 'kill_switch', hint: guardBody.hint }
  }

  if (res.status === 402) {
    switch (guardBody?.code) {
      case 'FREE_VIDEO_QUOTA':
        return { kind: 'free_video_exhausted', hint: guardBody.hint }
      case 'WEEKLY_VIDEO_QUOTA':
        return { kind: 'weekly_video_exhausted', hint: guardBody.hint }
      case 'VIDEO_DURATION_EXCEEDED':
        return { kind: 'video_duration_exceeded', hint: guardBody.hint }
      case 'DAILY_QUOTA':
      default:
        return { kind: 'quota_exhausted', hint: guardBody?.hint }
    }
  }

  if (res.status === 503) {
    return { kind: 'kill_switch', hint: guardBody?.hint }
  }

  return null
}
