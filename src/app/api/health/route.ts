import { NextResponse } from 'next/server'

/**
 * Lightweight health check.
 *
 * Returns 200 with a JSON status payload as long as the route runs.
 * Surfaces configuration presence (Gemini key set, D1 binding present,
 * kill switch state, auth mode) WITHOUT making any AI call. Cheap enough
 * to wire into uptime monitoring.
 *
 * Returns 200 even when optional services are unset, so the caller can
 * distinguish "service up, AI off" from "service down". For a stricter
 * readiness check, gate on `ai.ready === true`.
 */
export async function GET() {
  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY)
  const dbBound = Boolean(
    (process.env.DB as unknown as { prepare?: unknown } | undefined)?.prepare
  )
  const killSwitch = process.env.MUSASHI_AI_KILL_SWITCH === '1'
  const offlineMode =
    process.env.OFFLINE_MODE === '1' || process.env.GEMINI_DRY_RUN === '1'
  const authDisabled = process.env.MUSASHI_DISABLE_AUTH === '1'

  return NextResponse.json(
    {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'musashi',
      version: process.env.NEXT_PUBLIC_APP_VERSION || 'dev',
      auth: { bypass: authDisabled },
      db: { bound: dbBound },
      ai: {
        ready: geminiConfigured && !killSwitch && !offlineMode,
        geminiConfigured,
        killSwitch,
        offlineMode,
      },
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store, must-revalidate' },
    }
  )
}
