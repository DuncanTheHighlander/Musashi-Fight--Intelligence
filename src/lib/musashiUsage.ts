import { assertEmailVerified, requireUser, type MusashiRole } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'
import { resolveQuotaDurationSec } from '@/lib/gemini/videoFilePart'
import { VIDEO_DURATION_TOLERANCE_SEC } from '@/lib/videoTierLimits'

export type MusashiAction = 'analyze' | 'chat' | 'reflex' | 'track'

/** Max clip length for free-tier AI video analysis (seconds). */
export const FREE_MAX_VIDEO_SEC = 10
/** Max clip length for Pro AI video analysis (seconds). */
export const PRO_MAX_VIDEO_SEC = 30
/** Lifetime free AI video analyses before upgrade required. */
export const FREE_LIFETIME_VIDEOS = 3
/**
 * Pro weekly AI video analyses.
 * Rationale: at ~$0.08–0.12 per 30s multimodal pipeline (Gemini + optional cloud pose),
 * 10/week ≈ $1.00/week COGS on ~$4.75/week revenue share at $19/mo — safe margin with
 * headroom for token spikes while allowing ~1–2 training clips per day.
 */
export const PRO_WEEKLY_VIDEOS = 10
/** Shogun / admin bypass ceiling (seconds). */
export const SHOGUN_MAX_VIDEO_SEC = 600

/**
 * Follow-up AI questions allowed per analyzed clip.
 * The initial Full Clip Analysis is NOT counted here — only chat/strategy
 * questions that reference an already-uploaded clip. Bounds per-clip COGS:
 * each clip-grounded question re-sends video context to Gemini.
 */
export const FREE_QUESTIONS_PER_CLIP = 3
export const PRO_QUESTIONS_PER_CLIP = 15

type Limits = {
  perMinute: number
  dailyAnalyze: number
  dailyChat: number
  dailyReflex: number
  dailyTrack: number
}

const paidLimits: Limits = {
  perMinute: 60,
  dailyAnalyze: 250,
  dailyChat: 3000,
  dailyReflex: 3000,
  dailyTrack: 3000,
}

const defaultLimitsForRole = (role: MusashiRole): Limits => {
  if (role === 'shogun') {
    return {
      perMinute: 240,
      dailyAnalyze: 10_000,
      dailyChat: 50_000,
      dailyReflex: 50_000,
      dailyTrack: 50_000,
    }
  }

  return {
    perMinute: 30,
    dailyAnalyze: 60,
    dailyChat: 600,
    dailyReflex: 600,
    dailyTrack: 600,
  }
}

const getDayKey = (): string => {
  return new Date().toISOString().slice(0, 10)
}

const getMinuteBucket = (): number => {
  return Math.floor(Date.now() / 60_000)
}

const loadOverrides = async (userId: string): Promise<Partial<Limits>> => {
  const db = getDb()
  const row = await db
    .prepare(
      'SELECT daily_analyze_limit, daily_chat_limit, daily_reflex_limit, daily_track_limit, per_minute_limit FROM musashi_user_limits WHERE user_id = ?'
    )
    .bind(userId)
    .first()

  if (!row) return {}

  const out: Partial<Limits> = {}
  if (row.per_minute_limit != null) out.perMinute = Number(row.per_minute_limit)
  if (row.daily_analyze_limit != null) out.dailyAnalyze = Number(row.daily_analyze_limit)
  if (row.daily_chat_limit != null) out.dailyChat = Number(row.daily_chat_limit)
  if (row.daily_reflex_limit != null) out.dailyReflex = Number(row.daily_reflex_limit)
  if (row.daily_track_limit != null) out.dailyTrack = Number(row.daily_track_limit)
  return out
}

const resolveLimits = async (userId: string, role: MusashiRole): Promise<Limits> => {
  let base = defaultLimitsForRole(role)
  if (role === 'user') {
    if (await isProSubscriber(userId, role)) {
      base = paidLimits
    }
  }
  const overrides = await loadOverrides(userId)
  return {
    perMinute: Number.isFinite(overrides.perMinute as number) ? Math.max(1, overrides.perMinute as number) : base.perMinute,
    dailyAnalyze: Number.isFinite(overrides.dailyAnalyze as number)
      ? Math.max(0, overrides.dailyAnalyze as number)
      : base.dailyAnalyze,
    dailyChat: Number.isFinite(overrides.dailyChat as number) ? Math.max(0, overrides.dailyChat as number) : base.dailyChat,
    dailyReflex: Number.isFinite(overrides.dailyReflex as number)
      ? Math.max(0, overrides.dailyReflex as number)
      : base.dailyReflex,
    dailyTrack: Number.isFinite(overrides.dailyTrack as number) ? Math.max(0, overrides.dailyTrack as number) : base.dailyTrack,
  }
}

const enforceRateLimit = async (userId: string, perMinute: number, bucketMinute = getMinuteBucket()) => {
  const db = getDb()
  const bucket = bucketMinute

  const row = await db
    .prepare('SELECT count FROM musashi_rate_limit_minute WHERE user_id = ? AND bucket_minute = ?')
    .bind(userId, bucket)
    .first()

  const count = row?.count != null ? Number(row.count) : 0
  if (count >= perMinute) {
    throw new Error('RATE_LIMIT')
  }

  const now = new Date().toISOString()
  await db
    .prepare(
      'INSERT INTO musashi_rate_limit_minute (user_id, bucket_minute, count, updated_at) VALUES (?, ?, 1, ?) ON CONFLICT(user_id, bucket_minute) DO UPDATE SET count = count + 1, updated_at = excluded.updated_at'
    )
    .bind(userId, bucket, now)
    .run()
}

/** Separate bucket namespace for expensive cloud pose proxy calls. */
const CLOUD_POSE_BUCKET_OFFSET = 1_000_000_000

export const cloudPosePerMinuteLimit = (): number => {
  const configured = Number(process.env.MUSASHI_POSE_PROXY_PER_MINUTE)
  if (Number.isFinite(configured) && configured > 0) return Math.trunc(configured)
  return 6
}

export const enforceCloudPoseRateLimit = async (userId: string): Promise<void> => {
  await enforceRateLimit(userId, cloudPosePerMinuteLimit(), getMinuteBucket() + CLOUD_POSE_BUCKET_OFFSET)
}

const usageColumnForAction = (action: MusashiAction) => {
  if (action === 'analyze') return 'analyze_count'
  if (action === 'chat') return 'chat_count'
  if (action === 'reflex') return 'reflex_count'
  return 'track_count'
}

const dailyLimitForAction = (limits: Limits, action: MusashiAction) => {
  if (action === 'analyze') return limits.dailyAnalyze
  if (action === 'chat') return limits.dailyChat
  if (action === 'reflex') return limits.dailyReflex
  return limits.dailyTrack
}

const enforceDailyUsage = async (userId: string, limits: Limits, action: MusashiAction) => {
  const db = getDb()
  const day = getDayKey()
  const col = usageColumnForAction(action)

  const row = await db
    .prepare(`SELECT ${col} as c FROM musashi_usage_daily WHERE user_id = ? AND day = ?`)
    .bind(userId, day)
    .first()

  const count = row?.c != null ? Number(row.c) : 0
  const max = dailyLimitForAction(limits, action)

  if (count >= max) {
    throw new Error('DAILY_QUOTA')
  }

  const now = new Date().toISOString()

  await db
    .prepare(
      'INSERT INTO musashi_usage_daily (user_id, day, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET updated_at = excluded.updated_at'
    )
    .bind(userId, day, now)
    .run()

  await db
    .prepare(`UPDATE musashi_usage_daily SET ${col} = ${col} + 1, updated_at = ? WHERE user_id = ? AND day = ?`)
    .bind(now, userId, day)
    .run()
}

const getWeekStartKey = (): string => {
  const now = new Date()
  const day = now.getUTCDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diff))
  return monday.toISOString().slice(0, 10)
}

export const isProSubscriber = async (userId: string, role: MusashiRole): Promise<boolean> => {
  if (role === 'shogun') return true
  try {
    const db = getDb()
    const nowIso = new Date().toISOString()
    const comp = await db
      .prepare('SELECT comp_pro_until FROM musashi_users WHERE id = ?')
      .bind(userId)
      .first<{ comp_pro_until: string | null }>()
    if (comp?.comp_pro_until && String(comp.comp_pro_until) >= nowIso) return true

    const row = await db
      .prepare(
        "SELECT stripe_subscription_id FROM musashi_stripe_subscriptions WHERE user_id = ? AND status IN ('active','trialing') AND (current_period_end IS NULL OR current_period_end >= ?) LIMIT 1"
      )
      .bind(userId, nowIso)
      .first()
    return Boolean(row?.stripe_subscription_id)
  } catch {
    return false
  }
}

type VideoTierLimits = {
  maxDurationSec: number
  weeklyVideos: number
  lifetimeFreeVideos: number
}

const loadVideoOverrides = async (userId: string): Promise<Partial<VideoTierLimits>> => {
  const db = getDb()
  const row = await db
    .prepare('SELECT weekly_video_limit, max_video_duration_sec FROM musashi_user_limits WHERE user_id = ?')
    .bind(userId)
    .first()

  if (!row) return {}
  const out: Partial<VideoTierLimits> = {}
  if (row.max_video_duration_sec != null) out.maxDurationSec = Number(row.max_video_duration_sec)
  if (row.weekly_video_limit != null) out.weeklyVideos = Number(row.weekly_video_limit)
  return out
}

export const resolveVideoTierLimits = async (userId: string, role: MusashiRole): Promise<VideoTierLimits> => {
  if (role === 'shogun') {
    return {
      maxDurationSec: SHOGUN_MAX_VIDEO_SEC,
      weeklyVideos: 10_000,
      lifetimeFreeVideos: FREE_LIFETIME_VIDEOS,
    }
  }

  const isPro = await isProSubscriber(userId, role)
  const overrides = await loadVideoOverrides(userId)
  const baseMaxSec = isPro ? PRO_MAX_VIDEO_SEC : FREE_MAX_VIDEO_SEC
  const baseWeekly = isPro ? PRO_WEEKLY_VIDEOS : 0

  let bonusCredits = 0
  try {
    const db = getDb()
    const bonus = await db
      .prepare('SELECT COALESCE(bonus_video_credits, 0) AS c FROM musashi_users WHERE id = ?')
      .bind(userId)
      .first<{ c: number }>()
    bonusCredits = Math.max(0, Number(bonus?.c || 0))
  } catch {
    bonusCredits = 0
  }

  return {
    maxDurationSec: Number.isFinite(overrides.maxDurationSec as number)
      ? Math.max(1, overrides.maxDurationSec as number)
      : baseMaxSec,
    weeklyVideos: Number.isFinite(overrides.weeklyVideos as number)
      ? Math.max(0, overrides.weeklyVideos as number)
      : baseWeekly,
    lifetimeFreeVideos: FREE_LIFETIME_VIDEOS + bonusCredits,
  }
}

export type VideoAnalysisOpts = {
  clipDurationSec: number
  /** Stable id for this clip (e.g. Gemini file URI) — dedupes follow-up coaching. */
  clipKey: string
}

/**
 * Enforce per-tier video duration + lifetime (free) / weekly (Pro) quotas.
 * Skips increment when the same clipKey was already charged for this user.
 */
export const enforceVideoAnalysis = async (
  userId: string,
  role: MusashiRole,
  opts: VideoAnalysisOpts
): Promise<void> => {
  if (process.env.MUSASHI_DISABLE_AUTH === '1' && process.env.NODE_ENV !== 'production') return

  const clipDurationSec = Number(opts.clipDurationSec)
  const clipKey = String(opts.clipKey || '').trim().slice(0, 256)
  if (!clipKey || !Number.isFinite(clipDurationSec) || clipDurationSec <= 0) {
    throw new Error('VIDEO_CONTEXT_REQUIRED')
  }

  const limits = await resolveVideoTierLimits(userId, role)
  // Tolerance: a clip trimmed to exactly the cap measures a frame or two over
  // (MediaRecorder overshoot) — hard-rejecting it would 402 every just-trimmed
  // clip and the AI would never see the video.
  if (clipDurationSec > limits.maxDurationSec + VIDEO_DURATION_TOLERANCE_SEC) {
    throw new Error('VIDEO_DURATION_EXCEEDED')
  }

  const db = getDb()
  const alreadyConsumed = await db
    .prepare('SELECT 1 AS ok FROM musashi_video_clips_consumed WHERE user_id = ? AND clip_key = ?')
    .bind(userId, clipKey)
    .first()
  if (alreadyConsumed) return

  const isPro = role === 'shogun' || (await isProSubscriber(userId, role))
  const now = new Date().toISOString()

  if (!isPro) {
    const row = await db
      .prepare('SELECT free_videos_used FROM musashi_video_lifetime WHERE user_id = ?')
      .bind(userId)
      .first()
    const used = row?.free_videos_used != null ? Number(row.free_videos_used) : 0
    if (used >= limits.lifetimeFreeVideos) {
      throw new Error('FREE_VIDEO_QUOTA')
    }

    await db
      .prepare(
        `INSERT INTO musashi_video_lifetime (user_id, free_videos_used, updated_at)
         VALUES (?, 1, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           free_videos_used = free_videos_used + 1,
           updated_at = excluded.updated_at`
      )
      .bind(userId, now)
      .run()
  } else if (role !== 'shogun') {
    const weekStart = getWeekStartKey()
    const row = await db
      .prepare('SELECT video_count FROM musashi_video_weekly WHERE user_id = ? AND week_start = ?')
      .bind(userId, weekStart)
      .first()
    const count = row?.video_count != null ? Number(row.video_count) : 0
    if (count >= limits.weeklyVideos) {
      throw new Error('WEEKLY_VIDEO_QUOTA')
    }

    await db
      .prepare(
        `INSERT INTO musashi_video_weekly (user_id, week_start, video_count, updated_at)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(user_id, week_start) DO UPDATE SET
           video_count = video_count + 1,
           updated_at = excluded.updated_at`
      )
      .bind(userId, weekStart, now)
      .run()
  }

  await db
    .prepare(
      'INSERT OR IGNORE INTO musashi_video_clips_consumed (user_id, clip_key, consumed_at) VALUES (?, ?, ?)'
    )
    .bind(userId, clipKey, now)
    .run()
}

/** Per-clip follow-up question ceiling for a user's tier. */
export const questionsPerClipForTier = (isPro: boolean): number =>
  isPro ? PRO_QUESTIONS_PER_CLIP : FREE_QUESTIONS_PER_CLIP

/**
 * Extract the clip key a chat/strategy question is grounded on, or null if the
 * question isn't tied to an uploaded clip (plain text chat is unmetered here).
 */
export const extractChatClipKey = (action: string, body: Record<string, unknown>): string | null => {
  if (action !== 'chat' && action !== 'strategy') return null
  const ctx = body?.context as Record<string, unknown> | undefined
  // The first native-video breakdown is paid for by the video-analysis credit.
  // Do not also spend one of the per-clip follow-up questions on that request.
  if (ctx?.initialVideoAnalysis === true) return null
  if (!ctx?.videoFileUri) return null
  const clipKey = String(ctx.videoFileUri).trim().slice(0, 256)
  return clipKey || null
}

/**
 * Enforce the per-clip follow-up question cap. Increments a (user, clip) counter
 * and throws `CLIP_QUESTION_LIMIT` once the tier ceiling is reached. Shogun is
 * unlimited; local/dev (auth disabled) is a no-op.
 */
export const enforceClipQuestionLimit = async (
  userId: string,
  role: MusashiRole,
  clipKey: string
): Promise<void> => {
  if (process.env.MUSASHI_DISABLE_AUTH === '1' && process.env.NODE_ENV !== 'production') return
  if (role === 'shogun') return

  const key = String(clipKey || '').trim().slice(0, 256)
  if (!key) return

  const isPro = await isProSubscriber(userId, role)
  const limit = questionsPerClipForTier(isPro)

  const db = getDb()
  const row = await db
    .prepare('SELECT question_count FROM musashi_clip_questions WHERE user_id = ? AND clip_key = ?')
    .bind(userId, key)
    .first()

  const used = row?.question_count != null ? Number(row.question_count) : 0
  if (used >= limit) {
    throw new Error('CLIP_QUESTION_LIMIT')
  }

  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO musashi_clip_questions (user_id, clip_key, question_count, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id, clip_key) DO UPDATE SET
         question_count = question_count + 1,
         updated_at = excluded.updated_at`
    )
    .bind(userId, key, now)
    .run()
}

/** Map `/api/fight` action names to the correct daily + per-minute quota bucket. */
export const fightActionToQuotaBucket = (action: string): MusashiAction => {
  switch (action) {
    case 'upload_video':
    case 'analyze_frame':
    case 'analyze_frames':
    case 'analyze_video_stream':
    case 'strategy':
      return 'analyze'
    case 'reflex':
      return 'reflex'
    case 'track':
      return 'track'
    case 'presets':
      return 'chat'
    case 'chat':
    default:
      return 'chat'
  }
}

/** Whether this fight-hub action can start a billable AI video analysis session. */
export const fightActionConsumesVideoQuota = (action: string, body: Record<string, unknown>): boolean => {
  if (['analyze_frame', 'analyze_frames', 'analyze_video_stream'].includes(action)) return true
  if (action === 'chat' || action === 'strategy') {
    const ctx = body?.context as Record<string, unknown> | undefined
    return Boolean(
      ctx?.nativeVideo &&
        ctx?.videoFileUri &&
        typeof ctx?.clipDuration === 'number' &&
        Number(ctx.clipDuration) > 0
    )
  }
  return false
}

export const extractFightVideoQuotaContext = (
  action: string,
  body: Record<string, unknown>,
  formData: FormData | null
): VideoAnalysisOpts | null => {
  if (action === 'analyze_video_stream') {
    const clipDurationSec = resolveQuotaDurationSec({
      clipDurationSec: Number(body?.clipDuration),
      startSec: Number(body?.startSec),
      endSec: Number(body?.endSec),
    })
    const clipKey = String(
      body?.videoFileUri ||
        (body?.clip as { sourceId?: string } | undefined)?.sourceId ||
        '',
    ).trim()
    if (!clipKey || !Number.isFinite(clipDurationSec) || clipDurationSec <= 0) return null
    return { clipDurationSec, clipKey }
  }

  if (['analyze_frame', 'analyze_frames'].includes(action) && formData) {
    const clipDurationSec = resolveQuotaDurationSec({
      clipDurationSec: Number(formData.get('clipDuration') || formData.get('clipDurationSec') || 0),
      startSec: Number(formData.get('startSec')),
      endSec: Number(formData.get('endSec')),
    })
    const clipKey = String(
      formData.get('videoFileUri') || formData.get('clipKey') || formData.get('sessionId') || ''
    ).trim()
    if (!clipKey || !Number.isFinite(clipDurationSec) || clipDurationSec <= 0) return null
    return { clipDurationSec, clipKey }
  }

  if (action === 'chat' || action === 'strategy') {
    const ctx = body?.context as Record<string, unknown> | undefined
    if (!ctx?.nativeVideo || !ctx?.videoFileUri) return null
    const clipDurationSec = resolveQuotaDurationSec({
      clipDurationSec: Number(ctx.clipDuration),
      startSec: Number(ctx.startSec),
      endSec: Number(ctx.endSec),
    })
    const clipKey = String(ctx.videoFileUri || ctx.sourceId || '').trim()
    if (!clipKey || !Number.isFinite(clipDurationSec) || clipDurationSec <= 0) return null
    return { clipDurationSec, clipKey }
  }

  return null
}

/** Shared helper for standalone analyze routes (`/api/fight/analyze`, etc.). */
export const maybeEnforceVideoFromAnalyzeRequest = async (
  user: { id: string; role: MusashiRole } | null,
  opts: { clipDurationMs?: number; videoFileUri?: string; sourceId?: string; enabled?: boolean }
): Promise<void> => {
  if (!user || opts.enabled === false) return
  const clipKey = String(opts.videoFileUri || opts.sourceId || '').trim()
  const clipDurationSec = Number(opts.clipDurationMs ?? 0) / 1000
  if (!clipKey || !Number.isFinite(clipDurationSec) || clipDurationSec <= 0) return
  await enforceVideoAnalysis(user.id, user.role, { clipDurationSec, clipKey })
}

export const enforceUsage = async (req: Request, action: MusashiAction) => {
  if (process.env.MUSASHI_DISABLE_AUTH === '1' && process.env.NODE_ENV !== 'production') {
    return {
      id: 'dev',
      email: 'dev@local',
      display_name: 'Dev User',
      role: 'shogun' as MusashiRole,
      emailVerifiedAt: null,
      passwordUpdatedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  const user = await requireUser(req)
  // AI quotas only apply after the account is eligible to use AI. Rejected
  // verification attempts must not burn rate-limit or daily-usage counters.
  assertEmailVerified(user)
  const limits = await resolveLimits(user.id, user.role)

  await enforceRateLimit(user.id, limits.perMinute)
  await enforceDailyUsage(user.id, limits, action)

  return user
}
