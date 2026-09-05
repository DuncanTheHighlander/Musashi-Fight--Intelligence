import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import { writeAdminAudit } from '@/lib/adminRuntime'

/**
 * Best-effort Cloudflare cache purge. Requires CF_ZONE_ID + CF_API_TOKEN.
 * Prefer targeted URL purge; full purge only when body.everything === true.
 */
export async function POST(req: Request) {
  let admin
  try {
    admin = await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const zoneId = String(process.env.CF_ZONE_ID || process.env.CLOUDFLARE_ZONE_ID || '').trim()
  const token = String(process.env.CF_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || '').trim()
  if (!zoneId || !token) {
    return NextResponse.json(
      {
        error: 'Cache purge not configured',
        hint: 'Set CF_ZONE_ID and CF_API_TOKEN Worker secrets to enable CDN purge.',
      },
      { status: 501 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { everything?: boolean; urls?: string[] }
  const everything = Boolean(body?.everything)
  const urls = Array.isArray(body?.urls) ? body.urls.filter((u) => typeof u === 'string').slice(0, 30) : []

  const payload = everything
    ? { purge_everything: true }
    : urls.length
      ? { files: urls }
      : {
          files: [
            process.env.MUSASHI_APP_URL || 'https://app.duncanazsmith.workers.dev',
            `${(process.env.MUSASHI_APP_URL || 'https://app.duncanazsmith.workers.dev').replace(/\/$/, '')}/shogun`,
          ],
        }

  const resp = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const data = (await resp.json().catch(() => ({}))) as { success?: boolean; errors?: unknown }

  await writeAdminAudit({
    adminUserId: admin.id,
    action: everything ? 'system.cache_purge_everything' : 'system.cache_purge',
    targetType: 'system',
    targetId: 'cloudflare_cache',
    after: { success: data.success, payload },
    result: data.success ? 'ok' : 'error',
  })

  if (!resp.ok || !data.success) {
    return NextResponse.json({ error: 'Cloudflare purge failed', details: data.errors || null }, { status: 502 })
  }
  return NextResponse.json({ ok: true })
}
