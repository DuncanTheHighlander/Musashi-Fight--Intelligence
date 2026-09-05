import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
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

const arrayFromMaybe = (value: any): string[] => {
  const parsed = parseJson(value, [])
  return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
}

const newId = () => {
  try {
    return crypto.randomUUID()
  } catch {
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`
  }
}

type ScoutingRequestRow = {
  id: string
  author_id: string
  opponent_name: string
  opponent_info: string
  fight_date: string | null
  performance_metrics?: string
  technique_analysis?: string
  avg_hand_speed?: number
  max_hand_speed?: number
  avg_power?: number
  max_power?: number
  technique_count?: number
  location: string
  description: string
  videos: string | null
  tags: string | null
  status: string
  response_count: number
  budget?: number | null
  visibility?: string | null
  opponent_videos?: string | null
  created_at: string
  updated_at: string
  author_name: string | null
}

const mapRequestRow = (row: ScoutingRequestRow) => ({
  id: row.id,
  authorId: row.author_id,
  authorName: row.author_name ?? '',
  opponentName: row.opponent_name,
  opponentInfo: parseJson(row.opponent_info, {
    weightClass: '',
    record: '',
    notableFights: [] as string[],
    style: '',
  }),
  fightDate: row.fight_date,
  location: row.location,
  description: row.description,
  videos: arrayFromMaybe(row.videos),
  tags: arrayFromMaybe(row.tags),
  status: row.status as 'open' | 'in_progress' | 'completed',
  responseCount: Number(row.response_count || 0),
  // Performance metrics from analysis
  performanceMetrics: parseJson(row.performance_metrics, {
    avgHandSpeedBwps: 0,
    maxHandSpeedBwps: 0,
    avgPowerIndex: 0,
    maxPowerIndex: 0,
    techniqueDiversity: 0,
    accuracy: 0,
    fightingIQ: 0,
    weaknesses: [] as string[],
    strengths: [] as string[]
  }),
  techniqueAnalysis: parseJson(row.technique_analysis, {
    commonTechniques: [] as string[],
    techniqueFrequency: {},
    timingPatterns: [] as string[],
    rangePreferences: [] as string[],
    defensivePatterns: [] as string[]
  }),
  budget: Number(row.budget ?? 0),
  visibility: (row.visibility as 'public' | 'targeted') || 'public',
  opponentVideos: arrayFromMaybe(row.opponent_videos),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export async function GET(req: Request) {
  try {
    await requireUser(req)

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const limit = Math.min(Number(searchParams.get('limit') || 25), 100)

    const db = getDb()

    let query = `
      SELECT sr.*, u.display_name as author_name,
        (SELECT COUNT(1) FROM analysis_responses ar WHERE ar.request_id = sr.id) as response_count,
        -- Performance metrics aggregation
        COALESCE(pm.avg_hand_speed_bwps, 0) as avg_hand_speed,
        COALESCE(pm.max_hand_speed_bwps, 0) as max_hand_speed,
        COALESCE(pm.avg_power_index, 0) as avg_power,
        COALESCE(pm.max_power_index, 0) as max_power,
        COUNT(DISTINCT ta.technique_name) as technique_count
      FROM scouting_requests sr
      JOIN fighter_profiles u ON u.user_id = sr.author_id
      LEFT JOIN performance_metrics pm ON sr.author_id = pm.user_id
      LEFT JOIN technique_analysis ta ON sr.author_id = ta.user_id
      WHERE 1=1
    `
    const params: any[] = []

    if (status && ['open', 'in_progress', 'completed'].includes(status)) {
      query += ' AND sr.status = ?'
      params.push(status)
    }

    query += ' ORDER BY sr.created_at DESC LIMIT ?'
    params.push(limit)

    const results = await db.prepare(query).bind(...params).all<ScoutingRequestRow>()
    const requests = (results.results || []).map(row => {
      const request = mapRequestRow(row)
      // Add performance metrics from aggregated data
      request.performanceMetrics = {
        avgHandSpeedBwps: Number(row.avg_hand_speed || 0),
        maxHandSpeedBwps: Number(row.max_hand_speed || 0),
        avgPowerIndex: Number(row.avg_power || 0),
        maxPowerIndex: Number(row.max_power || 0),
        techniqueDiversity: Number(row.technique_count || 0),
        accuracy: 0, // Will be calculated from technique success rates
        fightingIQ: 0, // Will be calculated from strategic analysis
        weaknesses: [], // Will be populated from AI analysis
        strengths: [] // Will be populated from AI analysis
      }
      return request
    })

    return NextResponse.json({ requests })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to fetch scouting requests' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(req)
    const body = await req.json() as Record<string, any>

    const opponentName = String(body?.opponentName || '').trim()
    const location = String(body?.location || '').trim()
    const description = String(body?.description || '').trim()

    if (!opponentName || !location || !description) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const opponentInfo = body?.opponentInfo ?? {}
    const fightDate = body?.fightDate ? String(body.fightDate) : null
    const videos = Array.isArray(body?.videos) ? body.videos.map(String) : []
    const tags = Array.isArray(body?.tags) ? body.tags.map((t: any) => String(t)) : []
    const budget = Math.max(0, Number(body?.budget) || 0)
    const visibility = body?.visibility === 'targeted' ? 'targeted' : 'public'
    const opponentVideos = Array.isArray(body?.opponentVideos) ? body.opponentVideos.map(String) : []

    const db = getDb()
    const id = newId()
    const now = new Date().toISOString()

    await db
      .prepare(
        `INSERT INTO scouting_requests (
          id, author_id, opponent_name, opponent_info, fight_date, location,
          description, videos, tags, status, response_count, performance_metrics, 
          technique_analysis, budget, visibility, opponent_videos, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', 0, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        user.id,
        opponentName,
        JSON.stringify({
          weightClass: String(opponentInfo?.weightClass || ''),
          record: String(opponentInfo?.record || ''),
          notableFights: Array.isArray(opponentInfo?.notableFights) ? opponentInfo.notableFights : [],
          style: String(opponentInfo?.style || ''),
        }),
        fightDate,
        location,
        description,
        JSON.stringify(videos),
        JSON.stringify(tags),
        JSON.stringify({
          avgHandSpeedBwps: 0,
          maxHandSpeedBwps: 0,
          avgPowerIndex: 0,
          maxPowerIndex: 0,
          techniqueDiversity: 0,
          accuracy: 0,
          fightingIQ: 0,
          weaknesses: [],
          strengths: []
        }),
        JSON.stringify({
          commonTechniques: [],
          techniqueFrequency: {},
          timingPatterns: [],
          rangePreferences: [],
          defensivePatterns: []
        }),
        budget,
        visibility,
        JSON.stringify(opponentVideos),
        now,
        now
      )
      .run()

    return NextResponse.json({ id })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    if (code === 'FORBIDDEN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    return NextResponse.json({ error: 'Failed to create scouting request' }, { status: 500 })
  }
}
