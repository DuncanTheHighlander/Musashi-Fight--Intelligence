import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/musashiAuth'

export async function GET(req: Request) {
  if (process.env.MUSASHI_DISABLE_AUTH === '1') {
    return NextResponse.json(
      {
        user: {
          id: 'dev',
          email: 'dev@local',
          display_name: 'Dev',
          role: 'shogun',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      { status: 200 }
    )
  }

  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ user: null }, { status: 401 })
    }
    return NextResponse.json({
      user: {
        ...user,
        display_name: user.display_name || user.email?.split('@')[0] || 'User',
      },
    }, { status: 200 })
  } catch (err) {
    console.error('Auth me error:', err)
    return NextResponse.json({ user: null }, { status: 401 })
  }
}
