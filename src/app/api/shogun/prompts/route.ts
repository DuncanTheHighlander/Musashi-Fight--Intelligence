import { NextResponse } from 'next/server'
import { requireUser } from '@/lib/musashiAuth'
import {
  activatePromptVersion,
  getPromptBundleForKey,
  upsertPromptTemplateAndCreateVersion,
  validatePromptContent,
  getPromptAuditLogs,
} from '@/lib/musashiPrompts'

export async function GET(req: Request) {
  try {
    await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const url = new URL(req.url)
  const key = String(url.searchParams.get('key') || '').trim()
  if (!key) return NextResponse.json({ error: 'Missing key' }, { status: 400 })

  const bundle = await getPromptBundleForKey(key)

  // Append audit logs if requested
  const includeAudit = url.searchParams.get('audit') === '1'
  if (includeAudit && bundle.template?.id) {
    const auditLogs = await getPromptAuditLogs(bundle.template.id, 20)
    return NextResponse.json({ ...bundle, auditLogs }, { status: 200 })
  }

  return NextResponse.json(bundle, { status: 200 })
}

export async function POST(req: Request) {
  let user
  try {
    user = await requireUser(req, { role: 'shogun' })
  } catch (e) {
    const code = e instanceof Error ? e.message : 'UNKNOWN'
    if (code === 'UNAUTHORIZED') return NextResponse.json({ error: 'Login required' }, { status: 401 })
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = (await req.json()) as any
  const action = String(body?.action || '').trim()

  if (action === 'activate') {
    try {
      await activatePromptVersion({
        templateKey: String(body?.key || ''),
        versionId: String(body?.versionId || ''),
        userId: user.id,
        userEmail: user.email,
        reason: body?.reason ? String(body.reason) : undefined,
      })
      return NextResponse.json({ ok: true }, { status: 200 })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid request' }, { status: 400 })
    }
  }

  if (action === 'validate') {
    try {
      const key = String(body?.key || '').trim()
      const content = String(body?.content || '')
      if (!key || !content) {
        return NextResponse.json({ error: 'Missing key or content' }, { status: 400 })
      }
      const result = await validatePromptContent(key, content)
      return NextResponse.json(result, { status: 200 })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid request' }, { status: 400 })
    }
  }

  try {
    const key = String(body?.key || '').trim()
    const name = String(body?.name || '').trim()
    const description = body?.description != null ? String(body.description) : null
    const content = String(body?.content || '')

    const out = await upsertPromptTemplateAndCreateVersion({
      key,
      name,
      description,
      content,
      createdByUserId: user.id,
      createdByUserEmail: user.email,
      reason: body?.reason ? String(body.reason) : undefined,
    })

    return NextResponse.json(out, { status: 200 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Invalid request' }, { status: 400 })
  }
}
