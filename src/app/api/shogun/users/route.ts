import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { listAdminUsers } from '@/lib/adminUsers'

export async function GET(req: Request) {
  try {
    await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const users = await listAdminUsers()
  return NextResponse.json({ users })
}
