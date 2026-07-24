/**
 * Admin business metrics — revenue, conversion, API usage estimates.
 * Pure helpers are unit-tested; DB aggregation lives in computeBusinessMetrics().
 */

import { getDb } from '@/lib/db'
import { FREE_LIFETIME_VIDEOS } from '@/lib/musashiUsage'

/** Display/plan amounts in cents (must stay in sync with setup-stripe.mjs). */
export const PLAN_MONTHLY_CENTS = 1900
export const PLAN_6MO_CENTS = 9900
export const PLAN_YEARLY_CENTS = 17900

/** Rough COGS estimates (cents) per billable AI action — tunable via env later. */
export const EST_COST_CENTS = {
  analyze: 10, // ~$0.10 multimodal clip
  chat: 2,
  reflex: 1,
  track: 3, // cloud pose / track path
} as const

export type MonthBucket = {
  month: string // YYYY-MM
  proMrrCents: number
  marketplaceFeeCents: number
  marketplaceGmvCents: number
  estApiCostCents: number
  analyzeCount: number
  chatCount: number
}

export type BusinessMetrics = {
  generatedAt: string
  revenue: {
    activeProCount: number
    estimatedMrrCents: number
    estimatedArrCents: number
    marketplaceFeeCentsAllTime: number
    marketplaceGmvCentsAllTime: number
    /** Pro MRR + marketplace fees this calendar month */
    thisMonthTotalCents: number
    /** Last 12 calendar months */
    byMonth: MonthBucket[]
  }
  conversion: {
    totalUsers: number
    freeStarters: number
    freeExhausted: number
    activePro: number
    convertedFromFree: number
    /** convertedFromFree / freeStarters */
    conversionRate: number | null
    /** converted among exhausted free */
    exhaustedToProRate: number | null
  }
  apiUsage: {
    last30d: {
      analyze: number
      chat: number
      reflex: number
      track: number
      estCostCents: number
    }
    prior30d: {
      analyze: number
      chat: number
      reflex: number
      track: number
      estCostCents: number
    }
    growthPct: number | null
  }
  notes: string[]
}

export function monthKey(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export function lastNMonthKeys(n: number, from = new Date()): string[] {
  const keys: string[] = []
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1))
  for (let i = 0; i < n; i++) {
    keys.push(monthKey(d))
    d.setUTCMonth(d.getUTCMonth() - 1)
  }
  return keys.reverse()
}

/** Monthly recurring contribution in cents for a Stripe price id. */
export function mrrCentsForPriceId(
  priceId: string | null | undefined,
  env: {
    monthly?: string
    sixMo?: string
    yearly?: string
  } = {},
): number {
  const id = String(priceId || '').trim()
  if (!id) return PLAN_MONTHLY_CENTS
  const monthly = String(env.monthly || process.env.MUSASHI_STRIPE_PRICE_ID_PRO || '').trim()
  const sixMo = String(env.sixMo || process.env.MUSASHI_STRIPE_PRICE_ID_PRO_6MO || '').trim()
  const yearly = String(env.yearly || process.env.MUSASHI_STRIPE_PRICE_ID_PRO_YEARLY || '').trim()
  if (sixMo && id === sixMo) return Math.round(PLAN_6MO_CENTS / 6)
  if (yearly && id === yearly) return Math.round(PLAN_YEARLY_CENTS / 12)
  if (monthly && id === monthly) return PLAN_MONTHLY_CENTS
  // Unknown price — assume monthly Pro list price
  return PLAN_MONTHLY_CENTS
}

export function estimateApiCostCents(counts: {
  analyze?: number
  chat?: number
  reflex?: number
  track?: number
}): number {
  return (
    Math.max(0, Number(counts.analyze || 0)) * EST_COST_CENTS.analyze +
    Math.max(0, Number(counts.chat || 0)) * EST_COST_CENTS.chat +
    Math.max(0, Number(counts.reflex || 0)) * EST_COST_CENTS.reflex +
    Math.max(0, Number(counts.track || 0)) * EST_COST_CENTS.track
  )
}

export function growthPercent(current: number, prior: number): number | null {
  if (prior <= 0) return current > 0 ? 100 : null
  return Math.round(((current - prior) / prior) * 1000) / 10
}

export function conversionRate(converted: number, starters: number): number | null {
  if (starters <= 0) return null
  return Math.round((converted / starters) * 1000) / 10
}

type SubRow = { price_id: string | null; status: string; updated_at: string | null; created_at: string | null }
type FeeRow = { month: string; fee_cents: number; gmv_cents: number }
type UsageRow = { day: string; analyze_count: number; chat_count: number; reflex_count: number; track_count: number }
type UserConvRow = {
  id: string
  free_videos_used: number
  is_pro: number
  videos_analyzed: number
}

export async function computeBusinessMetrics(): Promise<BusinessMetrics> {
  const db = getDb()
  const now = new Date()
  const nowIso = now.toISOString()
  const months = lastNMonthKeys(12, now)
  const thisMonth = monthKey(now)

  const notes: string[] = [
    'Pro revenue is estimated MRR from active Stripe subscriptions (not Stripe cash receipts).',
    'API cost is an internal estimate from action counts × fixed cents/action.',
  ]

  // Active Pro subscriptions
  let subs: SubRow[] = []
  try {
    const { results } = await db
      .prepare(
        `SELECT price_id, status, updated_at, created_at
         FROM musashi_stripe_subscriptions
         WHERE status IN ('active', 'trialing')
           AND (current_period_end IS NULL OR current_period_end >= ?)`,
      )
      .bind(nowIso)
      .all()
    subs = (results || []) as SubRow[]
  } catch {
    notes.push('Subscription table query failed — Pro MRR may be zero.')
  }

  const estimatedMrrCents = subs.reduce(
    (sum, s) => sum + mrrCentsForPriceId(s.price_id),
    0,
  )
  const activeProCount = subs.length

  // Marketplace fees + GMV by month (succeeded PLATFORM_FEE is negative in ledger; use ABS)
  const feeByMonth = new Map<string, { fee: number; gmv: number }>()
  try {
    const { results } = await db
      .prepare(
        `SELECT
           substr(COALESCE(created_at, ''), 1, 7) AS month,
           COALESCE(SUM(CASE WHEN type = 'PLATFORM_FEE' AND status = 'succeeded' THEN ABS(amount_cents) ELSE 0 END), 0) AS fee_cents,
           COALESCE(SUM(CASE WHEN type IN ('HOLD', 'CAPTURE') AND status = 'succeeded' AND amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS gmv_cents
         FROM marketplace_transactions
         WHERE created_at IS NOT NULL AND length(created_at) >= 7
         GROUP BY substr(COALESCE(created_at, ''), 1, 7)`,
      )
      .bind()
      .all()
    for (const r of (results || []) as FeeRow[]) {
      if (!r.month) continue
      feeByMonth.set(r.month, {
        fee: Number(r.fee_cents || 0),
        gmv: Number(r.gmv_cents || 0),
      })
    }
  } catch {
    notes.push('Marketplace ledger not available — marketplace revenue may be zero.')
  }

  let marketplaceFeeCentsAllTime = 0
  let marketplaceGmvCentsAllTime = 0
  for (const v of feeByMonth.values()) {
    marketplaceFeeCentsAllTime += v.fee
    marketplaceGmvCentsAllTime += v.gmv
  }

  // Usage by day for last ~60 days (growth) and by month for chart
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  let usageRows: UsageRow[] = []
  try {
    const { results } = await db
      .prepare(
        `SELECT day,
                COALESCE(SUM(analyze_count), 0) AS analyze_count,
                COALESCE(SUM(chat_count), 0) AS chat_count,
                COALESCE(SUM(reflex_count), 0) AS reflex_count,
                COALESCE(SUM(track_count), 0) AS track_count
         FROM musashi_usage_daily
         WHERE day >= ?
         GROUP BY day`,
      )
      .bind(sixtyDaysAgo)
      .all()
    usageRows = (results || []) as UsageRow[]
  } catch {
    notes.push('Usage daily table query failed — API usage may be zero.')
  }

  const usageByMonth = new Map<string, { analyze: number; chat: number; reflex: number; track: number }>()
  const sumWindow = (startDay: string, endDay: string) => {
    let analyze = 0
    let chat = 0
    let reflex = 0
    let track = 0
    for (const r of usageRows) {
      if (r.day >= startDay && r.day <= endDay) {
        analyze += Number(r.analyze_count || 0)
        chat += Number(r.chat_count || 0)
        reflex += Number(r.reflex_count || 0)
        track += Number(r.track_count || 0)
      }
    }
    return { analyze, chat, reflex, track }
  }

  for (const r of usageRows) {
    const mk = String(r.day || '').slice(0, 7)
    if (!mk) continue
    const cur = usageByMonth.get(mk) || { analyze: 0, chat: 0, reflex: 0, track: 0 }
    cur.analyze += Number(r.analyze_count || 0)
    cur.chat += Number(r.chat_count || 0)
    cur.reflex += Number(r.reflex_count || 0)
    cur.track += Number(r.track_count || 0)
    usageByMonth.set(mk, cur)
  }

  const dayStr = (d: Date) => d.toISOString().slice(0, 10)
  const end = dayStr(now)
  const start30 = dayStr(new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
  const start60 = dayStr(new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000))
  const endPrior = dayStr(new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000))

  const last30 = sumWindow(start30, end)
  const prior30 = sumWindow(start60, endPrior)
  const last30Cost = estimateApiCostCents(last30)
  const prior30Cost = estimateApiCostCents(prior30)

  const byMonth: MonthBucket[] = months.map((m) => {
    const fee = feeByMonth.get(m) || { fee: 0, gmv: 0 }
    const usage = usageByMonth.get(m) || { analyze: 0, chat: 0, reflex: 0, track: 0 }
    // Snapshot MRR attributed to "current" month only for thisMonth; historical months
    // show marketplace + API cost (we don't have historical subscription snapshots yet).
    const proMrrCents = m === thisMonth ? estimatedMrrCents : 0
    return {
      month: m,
      proMrrCents,
      marketplaceFeeCents: fee.fee,
      marketplaceGmvCents: fee.gmv,
      estApiCostCents: estimateApiCostCents(usage),
      analyzeCount: usage.analyze,
      chatCount: usage.chat,
    }
  })

  const thisMonthBucket = byMonth.find((b) => b.month === thisMonth)
  const thisMonthTotalCents =
    (thisMonthBucket?.proMrrCents || 0) + (thisMonthBucket?.marketplaceFeeCents || 0)

  // Conversion funnel from users + lifetime free usage
  let totalUsers = 0
  let freeStarters = 0
  let freeExhausted = 0
  let activePro = 0
  let convertedFromFree = 0
  let exhaustedPro = 0
  try {
    const { results } = await db
      .prepare(
        `SELECT
           u.id,
           COALESCE(lt.free_videos_used, 0) AS free_videos_used,
           COALESCE(v.consumed_count, 0) AS videos_analyzed,
           CASE
             WHEN u.role = 'shogun' THEN 1
             WHEN u.comp_pro_until IS NOT NULL AND u.comp_pro_until >= ? THEN 1
             WHEN s.user_id IS NOT NULL THEN 1
             ELSE 0
           END AS is_pro
         FROM musashi_users u
         LEFT JOIN musashi_video_lifetime lt ON lt.user_id = u.id
         LEFT JOIN (
           SELECT user_id, COUNT(*) AS consumed_count
           FROM musashi_video_analysis_sessions
           WHERE state = 'consumed'
           GROUP BY user_id
         ) v ON v.user_id = u.id
         LEFT JOIN (
           SELECT DISTINCT user_id
           FROM musashi_stripe_subscriptions
           WHERE status IN ('active', 'trialing')
             AND (current_period_end IS NULL OR current_period_end >= ?)
         ) s ON s.user_id = u.id
         WHERE u.role != 'shogun'`,
      )
      .bind(nowIso, nowIso)
      .all()

    for (const u of (results || []) as UserConvRow[]) {
      totalUsers += 1
      const freeUsed = Number(u.free_videos_used || 0)
      const analyzed = Number(u.videos_analyzed || 0)
      const isPro = Number(u.is_pro || 0) === 1
      const startedFree = freeUsed > 0 || analyzed > 0
      if (startedFree) freeStarters += 1
      if (freeUsed >= FREE_LIFETIME_VIDEOS) freeExhausted += 1
      if (isPro) {
        activePro += 1
        if (startedFree) convertedFromFree += 1
        if (freeUsed >= FREE_LIFETIME_VIDEOS) exhaustedPro += 1
      }
    }
  } catch {
    notes.push('Conversion query failed — check video session / lifetime migrations.')
  }

  return {
    generatedAt: nowIso,
    revenue: {
      activeProCount,
      estimatedMrrCents,
      estimatedArrCents: estimatedMrrCents * 12,
      marketplaceFeeCentsAllTime,
      marketplaceGmvCentsAllTime,
      thisMonthTotalCents,
      byMonth,
    },
    conversion: {
      totalUsers,
      freeStarters,
      freeExhausted,
      activePro,
      convertedFromFree,
      conversionRate: conversionRate(convertedFromFree, freeStarters),
      exhaustedToProRate: conversionRate(exhaustedPro, freeExhausted),
    },
    apiUsage: {
      last30d: {
        analyze: last30.analyze,
        chat: last30.chat,
        reflex: last30.reflex,
        track: last30.track,
        estCostCents: last30Cost,
      },
      prior30d: {
        analyze: prior30.analyze,
        chat: prior30.chat,
        reflex: prior30.reflex,
        track: prior30.track,
        estCostCents: prior30Cost,
      },
      growthPct: growthPercent(last30Cost, prior30Cost),
    },
    notes,
  }
}
