import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getDb } from '@/lib/db'

const parseJsonArray = (value: any): string[] => {
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item))
    }
    return []
  } catch {
    return []
  }
}

const mapProductRow = (row: any) => ({
  id: row.id,
  creatorId: row.creator_id,
  creatorName: row.creator_name ?? '',
  creatorAvatar: row.creator_avatar ?? '',
  title: row.title,
  description: row.description,
  type: row.type as 'technique' | 'breakdown' | 'training' | 'coaching',
  price: Number(row.price),
  currency: row.currency,
  videoUrl: row.video_url ?? '',
  thumbnailUrl: row.thumbnail_url ?? '',
  duration: Number(row.duration || 0),
  tags: parseJsonArray(row.tags),
  isPublished: Boolean(row.is_published),
  salesCount: Number(row.sales_count || 0),
  rating: Number(row.rating || 0),
  reviewCount: Number(row.review_count || 0),
  // Real creator performance — pulled from the JOINed performance_metrics +
  // fight_sessions counts in the SQL above. Previously the section component
  // fabricated these with Math.random() on every render; we now return the
  // actual aggregated values (or zeros if the creator has no sessions yet).
  creatorPerformance: {
    avgPowerIndex: Number(row.creator_avg_power || 0),
    avgHandSpeedBwps: Number(row.creator_hand_speed || 0),
    totalSessions: Number(row.creator_sessions || 0),
  },
  // Performance-based effectiveness metrics
  effectivenessMetrics: {
    techniqueSuccessRate: Number(row.technique_success_rate || 0),
    avgImprovementRate: Number(row.avg_improvement_rate || 0),
    userSkillLevel: row.user_skill_level as 'beginner' | 'intermediate' | 'advanced' | 'pro',
    realWorldApplication: Number(row.real_world_application || 0),
    biomechanicalEfficiency: Number(row.biomechanical_efficiency || 0),
    totalPractitioners: Number(row.total_practitioners || 0),
    verifiedResults: Boolean(row.verified_results)
  },
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() || ''
    const type = searchParams.get('type')
    const priceMin = Number(searchParams.get('priceMin') || '0')
    const priceMaxRaw = searchParams.get('priceMax')
    const priceMax = priceMaxRaw ? Number(priceMaxRaw) : null
    const onlyPublished = searchParams.get('published') !== 'false'
    const limit = Math.min(Number(searchParams.get('limit') || 30), 100)

    const db = getDb()
    const params: any[] = []

    let query = `
      SELECT
        cp.*,
        fp.display_name as creator_name,
        fp.social_links as creator_social_links,
        fp.is_verified as creator_verified,
        -- Creator performance metrics for credibility
        COALESCE(pm.avg_power_index, 0) as creator_avg_power,
        COALESCE(pm.avg_hand_speed_bwps, 0) as creator_hand_speed,
        COUNT(DISTINCT fs.id) as creator_sessions,
        -- Content effectiveness aggregation
        COALESCE(cp.technique_success_rate, 0) as technique_success_rate,
        COALESCE(cp.avg_improvement_rate, 0) as avg_improvement_rate,
        COALESCE(cp.total_practitioners, 0) as total_practitioners
      FROM content_products cp
      JOIN fighter_profiles fp ON fp.user_id = cp.creator_id
      LEFT JOIN performance_metrics pm ON fp.user_id = pm.user_id
      LEFT JOIN fight_sessions fs ON fp.user_id = fs.user_id AND fs.status = 'completed'
      WHERE 1=1
    `

    if (onlyPublished) {
      query += ' AND cp.is_published = true'
    }

    if (type && ['technique', 'breakdown', 'training', 'coaching'].includes(type)) {
      query += ' AND cp.type = ?'
      params.push(type)
    }

    if (search) {
      const searchLower = search.toLowerCase()
      query += ' AND (LOWER(cp.title) LIKE ? OR LOWER(cp.description) LIKE ? OR LOWER(fp.display_name) LIKE ?)'
      params.push(`%${searchLower}%`, `%${searchLower}%`, `%${searchLower}%`)
    }

    if (Number.isFinite(priceMin) && priceMin > 0) {
      query += ' AND cp.price >= ?'
      params.push(priceMin)
    }

    if (priceMax != null && Number.isFinite(priceMax)) {
      query += ' AND cp.price <= ?'
      params.push(priceMax)
    }

    query += ' ORDER BY cp.is_published DESC, cp.verified_results DESC, cp.rating DESC, creator_avg_power DESC, cp.created_at DESC LIMIT ?'
    params.push(limit)

    const records = await db.prepare(query).bind(...params).all()
    const products = (records.results || []).map(row => {
      const product = mapProductRow(row)
      // Add effectiveness metrics from aggregated data
      product.effectivenessMetrics = {
        techniqueSuccessRate: Number(row.technique_success_rate || 0),
        avgImprovementRate: Number(row.avg_improvement_rate || 0),
        userSkillLevel: 'intermediate' as const, // Will be determined from user feedback
        realWorldApplication: Number(row.total_practitioners || 0) / Math.max(Number(row.sales_count || 1), 1),
        biomechanicalEfficiency: Number(row.creator_avg_power || 0) / 10, // Normalized power index
        totalPractitioners: Number(row.total_practitioners || 0),
        verifiedResults: Boolean(row.verified_results)
      }
      return product
    })

    return NextResponse.json({ products })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to fetch marketplace listings' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json() as Record<string, any>

    const title = String(body?.title || '').trim()
    const description = String(body?.description || '').trim()
    const type = String(body?.type || '').trim() as 'technique' | 'breakdown' | 'training' | 'coaching'
    const price = Number(body?.price ?? 0)

    if (!title || !description || !['technique', 'breakdown', 'training', 'coaching'].includes(type)) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (!Number.isFinite(price) || price < 0) {
      return NextResponse.json({ error: 'Invalid price' }, { status: 400 })
    }

    const tags = Array.isArray(body?.tags) ? body.tags.map((tag: any) => String(tag)) : []
    const videoUrl = body?.videoUrl ? String(body.videoUrl) : ''
    const thumbnailUrl = body?.thumbnailUrl ? String(body.thumbnailUrl) : ''
    const duration = Number(body?.duration ?? 0)
    const currency = String(body?.currency || 'USD').toUpperCase()
    const isDraft = Boolean(body?.draft)

    const db = getDb()
    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    await db
      .prepare(
        `INSERT INTO content_products (
          id, creator_id, title, description, type, price, currency,
          video_url, thumbnail_url, duration, tags, is_published,
          sales_count, rating, review_count, 
          technique_success_rate, avg_improvement_rate, user_skill_level,
          real_world_application, biomechanical_efficiency, total_practitioners, 
          verified_results, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        user.id,
        title,
        description,
        type,
        price,
        currency,
        videoUrl,
        thumbnailUrl,
        Number.isFinite(duration) ? duration : 0,
        JSON.stringify(tags),
        !isDraft,
        0, // technique_success_rate
        0, // avg_improvement_rate
        'intermediate', // user_skill_level
        0, // real_world_application
        0, // biomechanical_efficiency
        0, // total_practitioners
        false, // verified_results
        now,
        now
      )
      .run()

    return NextResponse.json({ id })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to create product' }, { status: 500 })
  }
}
