import { NextResponse } from 'next/server'
import { seedDefaultKnowledge } from '@/lib/learningPipeline'

export async function POST(req: Request) {
  try {
    // Only allow seeding from admin (Shogun) or in development
    const isDev = process.env.NODE_ENV === 'development'

    if (!isDev) {
      // In production, require Shogun auth
      const { requireUser } = await import('@/lib/musashiAuth')
      await requireUser(req, { role: 'shogun' })
    }

    await seedDefaultKnowledge()

    return NextResponse.json({
      success: true,
      message: 'Knowledge base seeded with fight techniques across all disciplines',
    })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') {
      return NextResponse.json({ error: 'Login required' }, { status: 401 })
    }
    if (code === 'FORBIDDEN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }
    return NextResponse.json(
      { error: 'Failed to seed knowledge base', details: code },
      { status: 500 }
    )
  }
}
