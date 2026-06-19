import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { getActivityStats, getRecentActivity } from '@/lib/musashiLibrary'

export async function GET(req: Request) {
  try {
    await requireUser(req)

    const [stats, recentActivity] = await Promise.all([
      getActivityStats(),
      getRecentActivity(20),
    ])

    return NextResponse.json({ stats, recentActivity })
    
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 })
  }
}
