import { NextResponse } from 'next/server'
import { getSupabaseServerConfig } from '@/lib/supabase/server'
import { requireUser } from '@/lib/musashiAuth'

/**
 * Worker-backed route: checks Supabase config from Secrets Store.
 * Shogun-only; service role key stays server-side.
 */
export async function GET(request: Request) {
  try {
    await requireUser(request, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const config = await getSupabaseServerConfig()
  if (!config) {
    return NextResponse.json({ configured: false }, { status: 503 })
  }

  return NextResponse.json({
    configured: true,
  })
}
