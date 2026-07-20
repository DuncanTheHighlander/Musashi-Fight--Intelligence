import { getDb } from '@/lib/db'

export const AI_KILL_SWITCH_KEY = 'ai_kill_switch'

export async function getRuntimeSetting(key: string): Promise<string | null> {
  try {
    const db = getDb()
    const row = await db
      .prepare('SELECT value FROM musashi_runtime_settings WHERE key = ?')
      .bind(key)
      .first<{ value: string }>()
    return row?.value != null ? String(row.value) : null
  } catch {
    return null
  }
}

export async function setRuntimeSetting(
  key: string,
  value: string,
  updatedBy: string | null,
): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()
  await db
    .prepare(
      `INSERT INTO musashi_runtime_settings (key, value, updated_at, updated_by)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`,
    )
    .bind(key, value, now, updatedBy)
    .run()
}

/** True when AI should reject new analyzes (env OR runtime D1 flag). */
export async function isAiKillSwitchActive(): Promise<boolean> {
  if (process.env.MUSASHI_AI_KILL_SWITCH === '1') return true
  const runtime = await getRuntimeSetting(AI_KILL_SWITCH_KEY)
  return runtime === '1'
}

export async function writeAdminAudit(input: {
  adminUserId: string
  action: string
  targetType?: string | null
  targetId?: string | null
  reason?: string | null
  before?: unknown
  after?: unknown
  result?: string
}): Promise<void> {
  try {
    const db = getDb()
    const id = `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    await db
      .prepare(
        `INSERT INTO musashi_admin_audit_log
          (id, admin_user_id, action, target_type, target_id, reason, before_json, after_json, result, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.adminUserId,
        input.action,
        input.targetType ?? null,
        input.targetId ?? null,
        input.reason ?? null,
        input.before != null ? JSON.stringify(input.before) : null,
        input.after != null ? JSON.stringify(input.after) : null,
        input.result ?? 'ok',
        new Date().toISOString(),
      )
      .run()
  } catch {
    // Audit must never break the admin action path.
  }
}
