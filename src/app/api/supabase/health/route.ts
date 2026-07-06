import { NextResponse } from 'next/server'
import { getSupabaseServerConfig } from '@/lib/supabase/server'

/**
 * Example Worker-backed route: checks Supabase config from Secrets Store.
 * Service role key stays server-side; client only sees connection status.
 */
export async function GET() {
  const config = await getSupabaseServerConfig()
  if (!config) {
    return NextResponse.json({ configured: false }, { status: 503 })
  }

  return NextResponse.json({
    configured: true,
    url: config.url,
  })
}
