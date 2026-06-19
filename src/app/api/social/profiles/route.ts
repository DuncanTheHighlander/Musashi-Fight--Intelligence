import { NextResponse } from 'next/server'
import { enforceUsage } from '@/lib/musashiUsage'
import { getDb } from '@/lib/db'

const parseJson = <T>(value: any, fallback: T): T => {
  if (typeof value !== 'string') return fallback
  try {
    const parsed = JSON.parse(value)
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

const mapProfileRow = (row: any) => ({
  id: row.id,
  userId: row.user_id,
  displayName: row.display_name,
  bio: row.bio,
  location: parseJson(row.location, { city: '', state: '', country: '' }),
  weightClass: row.weight_class,
  discipline: row.discipline,
  record: parseJson(row.record, { wins: 0, losses: 0, draws: 0, kos: 0 }),
  stance: row.stance,
  team: row.team,
  socialLinks: parseJson(row.social_links, {}),
  isVerified: Boolean(row.is_verified),
  isPro: Boolean(row.is_pro),
  followers: Number(row.followers || 0),
  // Performance metrics from kinematics data
  performanceStats: parseJson(row.performance_stats, {
    avgHandSpeedBwps: 0,
    maxHandSpeedBwps: 0,
    avgPowerIndex: 0,
    maxPowerIndex: 0,
    totalSessions: 0,
    accuracy: 0,
    techniqueDiversity: 0,
    consistencyScore: 0,
    ranking: 0
  }),
  skillVerification: parseJson(row.skill_verification, {
    verifiedSkills: [],
    verificationLevel: 'none',
    lastVerified: null
  }),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export async function GET(req: Request) {
  try {
    await enforceUsage(req, 'chat')

    const { searchParams } = new URL(req.url)
    const search = searchParams.get('search')?.trim() ?? ''
    const discipline = searchParams.get('discipline')?.trim() ?? 'all'
    const location = searchParams.get('location')?.trim() ?? ''
    const verifiedOnly = searchParams.get('verified') === 'true'
    const limit = Math.min(Number(searchParams.get('limit') || 30), 100)

    const db = getDb()
    const where: string[] = []
    const params: any[] = []

    if (search) {
      where.push('(fp.display_name LIKE ? OR fp.bio LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }

    if (discipline !== 'all') {
      where.push('fp.discipline = ?')
      params.push(discipline)
    }

    if (location) {
      where.push('(fp.location LIKE ?)')
      params.push(`%${location}%`)
    }

    if (verifiedOnly) {
      where.push('fp.is_verified = 1')
    }

    const query = `
      SELECT fp.*, 
             COALESCE(pm.avg_hand_speed_bwps, 0) as avg_hand_speed,
             COALESCE(pm.max_hand_speed_bwps, 0) as max_hand_speed,
             COALESCE(pm.avg_power_index, 0) as avg_power,
             COALESCE(pm.max_power_index, 0) as max_power,
             COUNT(DISTINCT fs.id) as total_sessions
      FROM fighter_profiles fp
      LEFT JOIN performance_metrics pm ON fp.user_id = pm.user_id
      LEFT JOIN fight_sessions fs ON fp.user_id = fs.user_id AND fs.status = 'completed'
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      GROUP BY fp.id
      ORDER BY fp.is_verified DESC, pm.avg_power_index DESC, fp.followers DESC, fp.updated_at DESC
      LIMIT ?
    `
    params.push(limit)

    const rows = await db.prepare(query).bind(...params).all()
    const profiles = (rows.results || []).map(row => {
      const profile = mapProfileRow(row)
      // Add performance stats from aggregated data
      profile.performanceStats = {
        avgHandSpeedBwps: Number(row.avg_hand_speed || 0),
        maxHandSpeedBwps: Number(row.max_hand_speed || 0),
        avgPowerIndex: Number(row.avg_power || 0),
        maxPowerIndex: Number(row.max_power || 0),
        totalSessions: Number(row.total_sessions || 0),
        accuracy: 0, // Will be calculated from technique analysis
        techniqueDiversity: 0, // Will be calculated from technique analysis
        consistencyScore: 0, // Will be calculated from performance variance
        ranking: 0 // Will be calculated based on performance metrics
      }
      return profile
    })

    return NextResponse.json({ profiles })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to fetch profiles' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await enforceUsage(req, 'chat')
    const body = await req.json() as Record<string, any>

    const displayName = String(body?.displayName || '').trim()
    const discipline = String(body?.discipline || '').trim()
    const weightClass = String(body?.weightClass || '').trim()

    if (!displayName || !discipline || !weightClass) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const db = getDb()
    const existing = await db
      .prepare('SELECT id FROM fighter_profiles WHERE user_id = ?')
      .bind(user.id)
      .first()

    if (existing) {
      return NextResponse.json({ error: 'Profile already exists' }, { status: 400 })
    }

    const now = new Date().toISOString()
    await db
      .prepare(
        `INSERT INTO fighter_profiles (
          id, user_id, display_name, bio, location, weight_class, discipline,
          record, stance, team, social_links, is_verified, is_pro, followers, 
          performance_stats, skill_verification, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?)`
      )
      .bind(
        `profile_${user.id}`,
        user.id,
        displayName,
        String(body?.bio || ''),
        JSON.stringify(body?.location || {}),
        weightClass,
        discipline,
        JSON.stringify(body?.record || { wins: 0, losses: 0, draws: 0, kos: 0 }),
        String(body?.stance || 'orthodox'),
        String(body?.team || ''),
        JSON.stringify(body?.socialLinks || {}),
        JSON.stringify({
          avgHandSpeedBwps: 0,
          maxHandSpeedBwps: 0,
          avgPowerIndex: 0,
          maxPowerIndex: 0,
          totalSessions: 0,
          accuracy: 0,
          techniqueDiversity: 0,
          consistencyScore: 0,
          ranking: 0
        }),
        JSON.stringify({
          verifiedSkills: [],
          verificationLevel: 'none',
          lastVerified: null
        }),
        now,
        now
      )
      .run()

    return NextResponse.json({ success: true })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to create profile' }, { status: 500 })
  }
}
