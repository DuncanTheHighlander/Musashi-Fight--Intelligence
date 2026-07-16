import { NextResponse } from 'next/server'
import { isGeminiConfigured } from '@/lib/cloudflare/secrets'
import { readSecretEnv } from '@/lib/env'
import { isR2SigningConfigured, resolveStorageMode } from '@/lib/storage/r2'
import { getWorkerUploadsBucket } from '@/lib/storage/workerR2'

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
  const timestamp = new Date().toISOString()
  const isProd = process.env.NODE_ENV === 'production'
  const storageMode = resolveStorageMode()
  const storageSigningConfigured = isR2SigningConfigured()
  const storageBindingAvailable = storageMode === 'r2'
    ? Boolean(await getWorkerUploadsBucket())
    : storageMode === 'mock'
  const storage = {
    mode: storageMode,
    signingConfigured: storageSigningConfigured,
    bindingAvailable: storageBindingAvailable,
    directUploadReady: storageMode === 'r2' && storageSigningConfigured,
    workerProxyReady: storageMode === 'r2' && storageBindingAvailable,
    largeOriginalReady: storageMode === 'r2' && storageSigningConfigured,
    ready: storageMode === 'mock' || storageSigningConfigured || storageBindingAvailable,
  }
  const videoIngestion = {
    normalizerConfigured: Boolean(readSecretEnv('MUSASHI_VIDEO_NORMALIZER_URL')),
    normalizerAuthConfigured: Boolean(readSecretEnv('MUSASHI_POSE_CLOUD_TOKEN')),
  }

  if (isProd) {
    const geminiConfigured = await isGeminiConfigured()
    const killSwitch = process.env.MUSASHI_AI_KILL_SWITCH === '1'
    const offlineMode =
      process.env.OFFLINE_MODE === '1' || process.env.GEMINI_DRY_RUN === '1'

    return NextResponse.json(
      {
        status: 'ok',
        timestamp,
        service: 'musashi',
        version: process.env.NEXT_PUBLIC_APP_VERSION || 'worker',
        ai: { ready: geminiConfigured && !killSwitch && !offlineMode },
        storage,
        videoIngestion: {
          ...videoIngestion,
          ready: videoIngestion.normalizerConfigured && videoIngestion.normalizerAuthConfigured && geminiConfigured && !killSwitch && !offlineMode,
        },
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, must-revalidate' },
      }
    )
  }

  const geminiConfigured = await isGeminiConfigured()
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
      timestamp,
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
      storage,
      videoIngestion: {
        ...videoIngestion,
        ready: videoIngestion.normalizerConfigured && videoIngestion.normalizerAuthConfigured && geminiConfigured && !killSwitch && !offlineMode,
      },
    },
    {
      status: 200,
      headers: { 'Cache-Control': 'no-store, must-revalidate' },
    }
  )
}
